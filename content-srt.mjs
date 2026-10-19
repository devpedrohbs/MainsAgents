// SRT editável por conteúdo do Estúdio, separado do MP4. Importa o SRT do CapCut (ou gera do Whisper local de um vídeo
// do conteúdo), divide em blocos curtos, guarda versões imutáveis (CAS por versão+hash) e exporta um .srt UTF-8 sem BOM
// com CRLF, novo e idempotente por hash, registrado como documento na biblioteca do conteúdo. Nunca renderiza,
// recodifica, grava legenda na imagem, cria produção ou altera vídeos/outputVideo/approvedVideo.
// Todo efeito depois de um await (transcrição, escrita, leitura) revalida perfil, conteúdo, workspace, versão e vídeo.
import {createHash, randomUUID} from 'node:crypto';
import {link, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {inspectLocalAsset} from './editorial-local-files.mjs';
import {SRT_SCHEMA, SRT_SPLIT, SrtError, blocksFromTranscript, blocksToSrt, parseSrtDocument, sameWords, splitCues, srtBlocksHash, unitsFromBlocks, validateSrtBlocks, wordBlocks} from './editorial-srt.mjs';

const stamp = () => new Date().toISOString();
const MAX_VERSIONS = 30, MAX_EXPORTS = 50, MAX_DOCS_PER_CONTENT = 20;
const LANGUAGES = ['pt', 'en', 'es', 'fr', 'de', 'it'];
const TIMING_WARNINGS = ['estimated-timing', 'aligned-whisper', 'alignment-low', 'word-timing', 'no-word-timing', 'cue-too-short', 'alignment-removed'];
const id = (value) => typeof value === 'string' && /^[\w:.-]{1,200}$/.test(value);
const sha = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const statusError = (status, message) => Object.assign(new Error(message), {status});
const refOf = (ref) => ({assetId: ref.assetId, versionId: ref.versionId, sha256: ref.sha256});
const safeName = (value) => String(value || 'legendas').replace(/\.srt$/i, '').normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'legendas';
const asSrtError = (error) => { if (error instanceof SrtError) throw statusError(422, error.message); throw error; };

/** Vista pública (sem as palavras do Whisper, que só servem para redividir no servidor). */
export function srtDocumentView(doc) {
  const {words: _w, ...source} = doc.source;
  void _w;
  const alignment = doc.alignment ? (({words: _a, ...rest}) => (void _a, {...rest, wordCount: doc.alignment.words?.length ?? 0}))(doc.alignment) : undefined;
  return {...doc, source: {...source, ...(doc.source.words ? {wordCount: doc.source.words.length} : {})}, ...(alignment ? {alignment} : {})};
}
/** Vídeo cujos tempos o documento usa: a fonte (gerado) ou o da sincronização (importado alinhado). */
export const linkedVideo = (doc) => doc.source.kind === 'video' ? refOf(doc.source) : doc.alignment ? refOf(doc.alignment) : null;

export function createContentSrt(db, {directory, inspect = inspectLocalAsset, readBytes = readFile, media, getCurrentProfile} = {}) {
  db.exec('CREATE TABLE IF NOT EXISTS content_srt_documents(profile_id TEXT NOT NULL,id TEXT NOT NULL,content_id TEXT NOT NULL,data_json TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(profile_id,id))');
  const jobs = new Map();
  let closed = false;
  const transact = (fn) => { db.exec('BEGIN IMMEDIATE'); try { const value = fn(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  const profileCheck = (profile) => { if (closed) throw statusError(409, 'O app está fechando.'); if (getCurrentProfile && getCurrentProfile() !== profile) throw statusError(409, 'O perfil ativo mudou. Reabra o conteúdo.'); };
  const editorial = (profile) => { const row = db.prepare('SELECT revision,state_json FROM editorial_state WHERE profile_id=?').get(profile); if (!row) throw statusError(404, 'Abra um conteúdo no Estúdio.'); return {revision: row.revision, state: JSON.parse(row.state_json)}; };
  const contentOf = (profile, contentId) => { const value = editorial(profile), content = value.state.contents?.find((item) => item.id === contentId); if (!content) throw statusError(404, 'O conteúdo não existe mais neste perfil.'); return {value, content}; };
  const read = (profile, docId) => { const row = db.prepare('SELECT data_json FROM content_srt_documents WHERE profile_id=? AND id=?').get(profile, docId); return row ? JSON.parse(row.data_json) : null; };
  const write = (profile, doc) => { doc.updatedAt = stamp(); db.prepare('INSERT OR REPLACE INTO content_srt_documents VALUES(?,?,?,?,?)').run(profile, doc.id, doc.contentId, JSON.stringify(doc), doc.updatedAt); };
  const videoOf = (value, contentId, ref) => {
    const asset = value.state.assets?.find((item) => item.id === ref?.assetId && item.contentId === contentId && item.kind === 'video'), version = asset?.versions?.find((item) => item.id === asset.currentVersionId);
    if (!asset || asset.status === 'missing' || version?.id !== ref.versionId || version.sha256 !== ref.sha256) return null;
    return {asset, version};
  };
  /**
   * Vínculo completo, chamado antes E depois de cada await: perfil ativo, documento deste conteúdo, mesmo workspace e,
   * se os tempos vêm de um vídeo (gerado ou sincronizado), esse vídeo ainda na mesma versão. SRT nunca ligado a vídeo
   * não depende de vídeo nenhum.
   */
  const bound = (profile, input, {video = true} = {}) => {
    profileCheck(profile);
    if (!id(input.docId) || !id(input.contentId)) throw statusError(400, 'Documento SRT inválido.');
    const doc = read(profile, input.docId);
    if (!doc || doc.contentId !== input.contentId) throw statusError(404, 'Este SRT não pertence a este conteúdo.');
    const {value, content} = contentOf(profile, doc.contentId);
    if (content.workspaceId !== doc.workspaceId) throw statusError(409, 'O conteúdo mudou de espaço de trabalho. Crie um novo SRT.');
    const linked = linkedVideo(doc);
    if (video && linked && !videoOf(value, doc.contentId, linked)) throw statusError(409, doc.source.kind === 'video'
      ? 'O vídeo de origem mudou depois da geração; os tempos podem não bater. Gere o SRT de novo da versão atual.'
      : 'O vídeo usado para sincronizar os tempos mudou. Sincronize de novo com a versão atual ou desfaça a sincronização.');
    return doc;
  };
  /** CAS: só a versão mais recente, com o mesmo hash, serve de base. */
  const latestOf = (doc, input) => {
    const latest = doc.versions.at(-1);
    if (!latest || input.baseVersion !== latest.version || input.baseHash !== latest.hash) throw statusError(409, 'Este SRT mudou desde que você abriu. Recarregue a versão atual.');
    return latest;
  };
  const pushVersion = (doc, blocks, {origin, maxWords, warnings = [], alignment, basedOn}) => {
    const clean = validateSrtBlocks(blocks), hash = srtBlocksHash(clean), latest = doc.versions.at(-1);
    // Mesmo conteúdo exportável, mesmo alvo de palavras e mesma proveniência de tempo/unidade = nada novo.
    const sameLabels = latest?.blocks.length === clean.length && latest.blocks.every((b, i) => b.timing === clean[i].timing && b.unit === clean[i].unit);
    if (latest?.hash === hash && latest.maxWords === maxWords && sameLabels) return latest;
    const version = {version: (latest?.version ?? 0) + 1, hash, maxWords, origin, blocks: clean, warnings: [...new Set(warnings)].slice(0, 10), ...(alignment ? {alignment} : {}), ...(basedOn ? {basedOn} : {}), createdAt: stamp()};
    doc.versions = [...doc.versions, version].slice(-MAX_VERSIONS);
    return version;
  };
  /** Rascunho válido enviado junto (Baixar/Redividir/Sincronizar) vira uma versão "editada" antes da ação; sem etapa de aprovação. */
  const applyDraft = (doc, base, blocks) => {
    if (blocks === undefined) return base;
    let clean;
    try { clean = validateSrtBlocks(blocks); } catch (error) { asSrtError(error); }
    return pushVersion(doc, clean, {origin: 'edit', maxWords: base.maxWords, warnings: base.warnings.filter((w) => w !== 'no-speech'), alignment: base.alignment, basedOn: base.version});
  };
  const maxWordsOf = (value) => { const n = value === undefined ? SRT_SPLIT.defaultWords : Number(value); if (!Number.isInteger(n) || n < SRT_SPLIT.minWords || n > SRT_SPLIT.maxWords) throw statusError(400, `Escolha de ${SRT_SPLIT.minWords} a ${SRT_SPLIT.maxWords} palavras por bloco.`); return n; };
  /**
   * Redivide a partir da versão-base (com as correções de texto e os limites atuais do usuário), nunca da fonte
   * original: cada frase de origem (unidade) junta seus blocos e é dividida de novo. A fonte continua guardada
   * (proveniência) e a versão registra em que versão se baseou.
   */
  const resplit = (doc, base, maxWords) => {
    const cues = unitsFromBlocks(base.blocks);
    const words = doc.source.kind === 'video' ? doc.source.words : doc.alignment?.words;
    let result;
    if (doc.source.kind === 'video' && words?.length) result = wordBlocks(cues, words, maxWords);
    else {
      const split = splitCues(cues, {maxWords, words});
      result = {blocks: split.blocks, warnings: [...(doc.source.kind === 'video' ? ['whisper-approximate', 'no-word-timing'] : []), ...split.warnings], alignment: split.alignment ?? undefined};
    }
    if (!sameWords(cues, result.blocks)) throw statusError(500, 'A divisão alteraria o texto; nada foi salvo.');
    const kept = base.warnings.filter((w) => !TIMING_WARNINGS.includes(w) && w !== 'whisper-approximate');
    return {blocks: result.blocks, warnings: [...kept, ...result.warnings], alignment: result.alignment};
  };
  const countFor = (profile, contentId) => db.prepare('SELECT COUNT(*) AS n FROM content_srt_documents WHERE profile_id=? AND content_id=?').get(profile, contentId).n;
  const busy = (doc) => doc.job?.status === 'running';

  /** Whisper local (em cache por versão do vídeo) em segundo plano; o resultado só vale se nada mudou durante o job. */
  async function transcribeJob(profile, docId, jobId) {
    const abort = new AbortController();
    jobs.set(docId, abort);
    const settle = (patch) => { if (closed) return; try { transact(() => { const doc = read(profile, docId); if (doc?.job?.id !== jobId || doc.job.status !== 'running') return; doc.job = {...doc.job, ...patch, finishedAt: stamp()}; write(profile, doc); }); } catch { /* documento removido */ } };
    try {
      const doc = read(profile, docId), target = doc.job.target;
      const {transcript} = await media.transcribe(profile, {contentId: doc.contentId, ...target, language: doc.job.language}, {signal: abort.signal});
      if (closed || abort.signal.aborted) throw new Error('Transcrição cancelada.');
      transact(() => {
        const latest = read(profile, docId);
        if (latest?.job?.id !== jobId || latest.job.status !== 'running') return;
        // Revalida depois do await: perfil, conteúdo/workspace e o MESMO vídeo-alvo; senão o resultado é descartado.
        bound(profile, {docId, contentId: latest.contentId}, {video: false});
        if (!videoOf(editorial(profile), latest.contentId, target)) throw statusError(409, 'O vídeo mudou durante a transcrição; nada foi aplicado. Tente de novo com a versão atual.');
        const words = (transcript.noSpeech ? [] : transcript.words ?? []).map((w) => ({start: w.start, end: w.end, text: w.text}));
        const engine = `${transcript.engine ?? 'whisper.cpp'} ${transcript.model ?? ''}`.trim();
        if (latest.source.kind === 'video') {
          latest.source = {...latest.source, words, segments: transcript.noSpeech ? [] : (transcript.segments ?? []).map(({start, end, text}) => ({start, end, text})), engine, language: transcript.language ?? latest.job.language};
          const next = blocksFromTranscript({words, segments: latest.source.segments}, {maxWords: latest.job.maxWords});
          if (!next.blocks.length) throw statusError(422, 'Nenhuma fala reconhecida neste vídeo.');
          pushVersion(latest, next.blocks, {origin: 'generate', maxWords: latest.job.maxWords, warnings: next.warnings});
        } else {
          const base = latest.versions.at(-1);
          if (base?.version !== latest.job.baseVersion || base.hash !== latest.job.baseHash) throw statusError(409, 'O SRT mudou durante a sincronização; nada foi aplicado.');
          latest.alignment = {...refOf(target), words, engine};
          const next = resplit(latest, base, latest.job.maxWords);
          pushVersion(latest, next.blocks, {origin: 'align', maxWords: latest.job.maxWords, warnings: next.warnings, alignment: next.alignment, basedOn: base.version});
        }
        latest.job = {...latest.job, status: 'done', engine, finishedAt: stamp()};
        write(profile, latest);
      });
    } catch (error) {
      settle(abort.signal.aborted ? {status: 'canceled'} : {status: 'failed', error: String(error?.message ?? error).slice(0, 1000)});
    } finally { if (jobs.get(docId) === abort) jobs.delete(docId); }
  }

  /**
   * Publica o arquivo sem nunca sobrescrever: grava um .partial exclusivo e cria o nome final com hard link (falha se
   * já existir). Um arquivo que apareceu no meio do caminho só é aceito se tiver exatamente os mesmos bytes; no fim,
   * os bytes e o sha256 publicados são relidos e comparados com o que foi escrito.
   */
  async function exportFile(profile, doc, version) {
    const bytes = Buffer.from(blocksToSrt(version.blocks), 'utf8'), digest = sha256(bytes);
    const folder = join(directory, profile, doc.contentId, 'srt'), name = `${safeName(doc.title)}-v${version.version}-${version.hash.slice(0, 8)}.srt`, path = join(folder, name);
    await mkdir(folder, {recursive: true});
    const partial = `${path}.${randomUUID().slice(0, 8)}.partial`;
    try {
      await writeFile(partial, bytes, {flag: 'wx'});
      try { await link(partial, path); } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        const existing = await readBytes(path);
        if (!existing.equals(bytes)) throw statusError(409, 'Já existe um arquivo diferente com este nome (talvez editado fora do app); nada foi sobrescrito.');
      }
    } finally { await rm(partial, {force: true}); }
    const written = await readBytes(path), file = await inspect(path);
    if (!written.equals(bytes) || sha256(written) !== digest || file.status !== 'available' || file.sha256 !== digest) throw statusError(409, 'O arquivo SRT no disco não confere com o que foi exportado; nada foi registrado.');
    return file;
  }
  const registerAsset = (profile, doc, file) => {
    const value = editorial(profile), content = value.state.contents?.find((item) => item.id === doc.contentId);
    if (!content || content.workspaceId !== doc.workspaceId) throw statusError(409, 'O conteúdo mudou durante a exportação.');
    value.state.assets ??= [];
    let asset = value.state.assets.find((item) => item.contentId === doc.contentId && item.versions?.some((v) => v.sha256 === file.sha256));
    if (!asset) {
      const at = stamp(), v = {id: randomUUID(), path: file.path, name: file.name, size: file.size, sha256: file.sha256, modifiedAt: file.modifiedAt, createdAt: at};
      const source = linkedVideo(doc);
      asset = {id: `asset-${randomUUID()}`, workspaceId: doc.workspaceId, contentId: doc.contentId, kind: 'document', role: 'output', name: file.name, ...(source ? {sourceAssetId: source.assetId} : {}), currentVersionId: v.id, versions: [v], status: 'available', checkedAt: file.checkedAt, createdAt: at, updatedAt: at};
      value.state.assets.push(asset);
      const result = db.prepare('UPDATE editorial_state SET revision=?,state_json=?,updated_at=? WHERE profile_id=? AND revision=?').run(value.revision + 1, JSON.stringify(value.state), stamp(), profile, value.revision);
      if (result.changes !== 1) throw statusError(409, 'O Estúdio salvou outra mudança ao mesmo tempo. Exporte de novo.');
    }
    return asset.id;
  };
  /**
   * Vídeo ligado conferido NO DISCO (sha256 real), não só no estado: um MP4 sobrescrito no mesmo caminho (ex.: novo
   * export do CapCut) com metadados antigos não pode validar tempos. Depois do await, o vínculo é revalidado.
   */
  const verifyLinkedFile = async (profile, doc) => {
    const linked = linkedVideo(doc);
    if (!linked) return;
    const found = videoOf(editorial(profile), doc.contentId, linked);
    const actual = found ? await inspect(found.version.path).catch(() => null) : null;
    bound(profile, {docId: doc.id, contentId: doc.contentId});
    if (!found || actual?.status !== 'available' || actual.sha256 !== linked.sha256) throw statusError(409, 'O arquivo do vídeo ligado a este SRT mudou no disco (ou sumiu); os tempos podem não bater. Gere ou sincronize de novo com o vídeo atual.');
  };
  /** Mesma versão (número+hash) ainda é a mais recente e todo o vínculo continua válido. */
  const stillLatest = (profile, docId, contentId, version) => {
    const doc = bound(profile, {docId, contentId});
    const latest = doc.versions.at(-1);
    if (latest?.version !== version.version || latest.hash !== version.hash) throw statusError(409, 'Este SRT mudou durante a exportação. Exporte a versão atual.');
    return doc;
  };

  const recover = () => {
    for (const row of db.prepare('SELECT profile_id,data_json FROM content_srt_documents').all()) {
      const doc = JSON.parse(row.data_json);
      if (doc.job?.status === 'running' && !jobs.has(doc.id)) { doc.job = {...doc.job, status: 'interrupted', finishedAt: stamp()}; write(row.profile_id, doc); }
    }
  };
  recover();

  return {
    /** True while a local transcription of this document is still running in this process. */
    isRunning: (docId) => jobs.has(docId),
    list(profile, contentId) {
      profileCheck(profile);
      if (!id(contentId)) throw statusError(400, 'Conteúdo inválido.');
      contentOf(profile, contentId);
      return db.prepare('SELECT data_json FROM content_srt_documents WHERE profile_id=? AND content_id=? ORDER BY updated_at DESC').all(profile, contentId).map((row) => srtDocumentView(JSON.parse(row.data_json)));
    },
    async command(profile, input = {}) {
      profileCheck(profile);
      const action = input.action;
      if (action === 'import') {
        if (!id(input.contentId) || typeof input.srt !== 'string') throw statusError(400, 'Envie o arquivo SRT deste conteúdo.');
        const maxWords = maxWordsOf(input.maxWords);
        let parsed;
        try { parsed = parseSrtDocument(input.srt); } catch (error) { asSrtError(error); }
        return transact(() => {
          profileCheck(profile);
          const {content} = contentOf(profile, input.contentId);
          if (countFor(profile, content.id) >= MAX_DOCS_PER_CONTENT) throw statusError(409, `Este conteúdo já tem ${MAX_DOCS_PER_CONTENT} SRTs. Use um dos existentes.`);
          const title = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 120) : 'legendas.srt';
          const doc = {id: `srt-${randomUUID()}`, schema: SRT_SCHEMA, contentId: content.id, workspaceId: content.workspaceId, title, source: {kind: 'srt', name: title, sha256: srtBlocksHash(parsed.cues), cues: parsed.cues, warnings: parsed.warnings}, versions: [], exports: [], createdAt: stamp()};
          const original = {version: 0, blocks: parsed.cues.map((cue, unit) => ({...cue, timing: 'imported', unit})), warnings: parsed.warnings};
          const next = resplit(doc, original, maxWords);
          pushVersion(doc, next.blocks, {origin: 'split', maxWords, warnings: next.warnings});
          write(profile, doc);
          return srtDocumentView(doc);
        });
      }
      if (action === 'generate') {
        if (!id(input.contentId) || !id(input.assetId) || !id(input.versionId) || !sha(input.sha256)) throw statusError(400, 'Escolha um vídeo deste conteúdo.');
        if (!media?.transcribe) throw statusError(503, 'Transcrição local indisponível.');
        const maxWords = maxWordsOf(input.maxWords), language = LANGUAGES.includes(input.language) ? input.language : 'pt';
        const doc = transact(() => {
          profileCheck(profile);
          const {value, content} = contentOf(profile, input.contentId), video = videoOf(value, content.id, input);
          if (!video) throw statusError(409, 'Este vídeo mudou ou não é mais deste conteúdo. Escolha a versão atual.');
          if (countFor(profile, content.id) >= MAX_DOCS_PER_CONTENT) throw statusError(409, `Este conteúdo já tem ${MAX_DOCS_PER_CONTENT} SRTs. Use um dos existentes.`);
          const created = {id: `srt-${randomUUID()}`, schema: SRT_SCHEMA, contentId: content.id, workspaceId: content.workspaceId, title: `${video.asset.name.replace(/\.[^.]+$/, '')}.srt`, source: {kind: 'video', ...refOf(input), name: video.asset.name, words: [], segments: []}, versions: [], exports: [], createdAt: stamp(),
            job: {id: randomUUID(), kind: 'transcribe', status: 'running', target: refOf(input), maxWords, language, startedAt: stamp()}};
          write(profile, created);
          return created;
        });
        void transcribeJob(profile, doc.id, doc.job.id);
        return srtDocumentView(doc);
      }
      if (action === 'cancel') {
        const doc = bound(profile, input, {video: false});
        if (!busy(doc)) throw statusError(409, 'Não há transcrição em andamento.');
        jobs.get(doc.id)?.abort();
        return transact(() => { const latest = read(profile, doc.id); if (latest.job?.status === 'running') latest.job = {...latest.job, status: 'canceled', finishedAt: stamp()}; write(profile, latest); return srtDocumentView(latest); });
      }
      if (action === 'align') {
        // Tempos do SRT por frase → por palavra do Whisper do vídeo escolhido; o texto continua o da versão atual.
        if (!id(input.assetId) || !id(input.versionId) || !sha(input.sha256)) throw statusError(400, 'Escolha um vídeo deste conteúdo.');
        if (!media?.transcribe) throw statusError(503, 'Transcrição local indisponível.');
        const language = LANGUAGES.includes(input.language) ? input.language : 'pt';
        const started = transact(() => {
          // Sincronizar substitui um vínculo antigo; por isso o vídeo anterior não precisa estar válido.
          const latest = bound(profile, input, {video: false});
          if (latest.source.kind !== 'srt') throw statusError(400, 'Só um SRT importado pode ser sincronizado com o áudio.');
          if (busy(latest)) throw statusError(409, 'Aguarde a transcrição em andamento ou cancele.');
          const base = applyDraft(latest, latestOf(latest, input), input.blocks);
          if (!videoOf(editorial(profile), latest.contentId, input)) throw statusError(409, 'Este vídeo mudou ou não é mais deste conteúdo. Escolha a versão atual.');
          const maxWords = maxWordsOf(input.maxWords ?? base.maxWords);
          latest.job = {id: randomUUID(), kind: 'transcribe', status: 'running', target: refOf(input), maxWords, language, baseVersion: base.version, baseHash: base.hash, startedAt: stamp()};
          write(profile, latest);
          return latest;
        });
        void transcribeJob(profile, started.id, started.job.id);
        return srtDocumentView(started);
      }
      if (action === 'unalign') {
        // Desfaz a sincronização (ex.: o vídeo mudou): mantém texto e limites, tempos voltam a ser estimados.
        return transact(() => {
          const latest = bound(profile, input, {video: false});
          if (busy(latest)) throw statusError(409, 'Aguarde a transcrição em andamento ou cancele.');
          if (latest.source.kind !== 'srt' || !latest.alignment) throw statusError(400, 'Este SRT não está sincronizado com um vídeo.');
          const base = latestOf(latest, input);
          delete latest.alignment;
          pushVersion(latest, base.blocks.map((block) => block.timing === 'aligned' ? {...block, timing: 'estimated'} : block), {origin: 'edit', maxWords: base.maxWords, warnings: [...base.warnings.filter((w) => w !== 'aligned-whisper'), 'alignment-removed'], basedOn: base.version});
          write(profile, latest);
          return srtDocumentView(latest);
        });
      }
      if (action === 'split') {
        const maxWords = maxWordsOf(input.maxWords);
        return transact(() => {
          const latest = bound(profile, input);
          if (busy(latest)) throw statusError(409, 'Aguarde a transcrição em andamento ou cancele.');
          const base = applyDraft(latest, latestOf(latest, input), input.blocks);
          const next = resplit(latest, base, maxWords);
          pushVersion(latest, next.blocks, {origin: 'split', maxWords, warnings: next.warnings, alignment: next.alignment, basedOn: base.version});
          write(profile, latest);
          return srtDocumentView(latest);
        });
      }
      if (action === 'save') {
        return transact(() => {
          const latest = bound(profile, input, {video: false});
          if (busy(latest)) throw statusError(409, 'Aguarde a transcrição em andamento ou cancele.');
          if (input.blocks === undefined) throw statusError(400, 'Envie os blocos editados.');
          applyDraft(latest, latestOf(latest, input), input.blocks);
          write(profile, latest);
          return srtDocumentView(latest);
        });
      }
      if (action === 'export') {
        // Uma ação só: salva o rascunho válido (se houver), exporta e devolve o recibo. Sem aprovação de texto/estilo.
        const cas = {baseVersion: input.baseVersion ?? input.version, baseHash: input.baseHash ?? input.hash};
        if (!Number.isInteger(cas.baseVersion) || !sha(cas.baseHash)) throw statusError(400, 'Informe a versão e o hash revisados.');
        const {doc, version} = transact(() => {
          const latest = bound(profile, input);
          if (busy(latest)) throw statusError(409, 'Aguarde a transcrição em andamento ou cancele.');
          const base = latestOf(latest, cas), target = applyDraft(latest, base, input.blocks);
          if (target !== base) write(profile, latest);
          return {doc: latest, version: target};
        });
        await verifyLinkedFile(profile, doc);
        const estimated = version.blocks.some((b) => b.timing === 'estimated');
        const prior = doc.exports.find((item) => item.hash === version.hash);
        if (prior) {
          const bytes = await readBytes(prior.path).catch(() => null);
          if (bytes && sha256(bytes) === prior.sha256) {
            // Revalida depois do await, inclusive no caminho idempotente. Os bytes são os mesmos, mas o recibo descreve a
            // versão ATUAL (ex.: depois de desfazer a sincronização, os tempos passam a contar como estimados).
            return transact(() => {
              const latest = stillLatest(profile, doc.id, doc.contentId, version);
              const entry = {...latest.exports.find((item) => item.sha256 === prior.sha256) ?? prior, version: version.version, estimated, reusedAt: stamp()};
              latest.exports = [...latest.exports.filter((item) => item.sha256 !== prior.sha256), entry].slice(-MAX_EXPORTS);
              write(profile, latest);
              return {document: srtDocumentView(latest), export: entry, reused: true};
            });
          }
          stillLatest(profile, doc.id, doc.contentId, version);
        }
        const file = await exportFile(profile, doc, version);
        return transact(() => {
          const latest = stillLatest(profile, doc.id, doc.contentId, version);
          const assetId = registerAsset(profile, latest, file);
          const entry = {version: version.version, hash: version.hash, name: file.name, path: file.path, size: file.size, sha256: file.sha256, assetId, estimated, createdAt: stamp()};
          latest.exports = [...latest.exports.filter((item) => item.sha256 !== file.sha256), entry].slice(-MAX_EXPORTS);
          write(profile, latest);
          return {document: srtDocumentView(latest), export: entry, reused: false};
        });
      }
      throw statusError(400, 'Ação de SRT desconhecida.');
    },
    /** Bytes de um SRT exportado, conferidos por sha256 (para o botão Baixar); o escopo é revalidado depois da leitura. */
    async file(profile, {contentId, docId, sha256: wanted} = {}) {
      const doc = bound(profile, {contentId, docId}, {video: false}), entry = doc.exports.find((item) => item.sha256 === wanted);
      if (!entry) throw statusError(404, 'Exportação não encontrada.');
      const bytes = await readBytes(entry.path).catch(() => null);
      const again = bound(profile, {contentId, docId}, {video: false});
      if (!again.exports.some((item) => item.sha256 === wanted && item.path === entry.path)) throw statusError(404, 'Exportação não encontrada.');
      if (!bytes) throw statusError(410, 'O arquivo exportado não está mais no disco. Exporte de novo.');
      if (sha256(bytes) !== entry.sha256) throw statusError(409, 'O arquivo exportado foi alterado fora do app. Exporte de novo.');
      return {name: entry.name, bytes};
    },
    close() { closed = true; for (const abort of jobs.values()) abort.abort(); },
  };
}
