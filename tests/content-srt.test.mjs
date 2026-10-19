import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,mkdtempSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {blocksFromTranscript,blocksToSrt,groupTokens,parseSrtDocument,sameWords,splitCues,srtBlocksHash,unitsFromBlocks,validateSrtBlocks} from '../editorial-srt.mjs';
import {createContentSrt} from '../content-srt.mjs';
import {validateCaptionSegments} from '../editorial-captions.mjs';
import {inspectLocalAsset} from '../editorial-local-files.mjs';
import {splitRow,formatClock} from '../src/features/content/srtRows.ts';

const capcut=['1','00:00:01,000 --> 00:00:03,500','Eu hoje entrei pela porta do carro','','2','00:00:04,000 --> 00:00:07,000','E aí, você viu? A promoção custa R$ 1.500,00 — "sério"!','','3','00:00:07,200 --> 00:00:08,000','Use {"modo":"json"} em C:\\pasta\\saída','','4','00:00:08,000 --> 00:00:09,000','API A --> B',''].join('\r\n');
const texts=blocks=>blocks.map(b=>b.text);
const noOverlap=blocks=>blocks.every((b,i)=>b.end>b.start&&(i===0||b.start>=blocks[i-1].end));
const BOM=Buffer.from([0xef,0xbb,0xbf]);

test('the user example splits naturally: 3/2/2, never ending on "pela"/"do"', ()=>{
 const {cues}=parseSrtDocument(capcut);
 const {blocks,warnings}=splitCues(cues.slice(0,1),{maxWords:3});
 assert.deepEqual(texts(blocks),['Eu hoje entrei','pela porta','do carro']);
 assert.ok(warnings.includes('estimated-timing'),'times without audio are flagged as estimates');
 assert.ok(blocks.every(b=>b.timing==='estimated'));
 assert.equal(blocks[0].start,1);assert.equal(blocks.at(-1).end,3.5,'stays inside the original sentence');
 assert.deepEqual(texts(splitCues(cues.slice(0,1),{maxWords:2}).blocks),['Eu hoje','entrei','pela porta','do carro']);
 assert.deepEqual(texts(splitCues(cues.slice(0,1),{maxWords:4}).blocks),['Eu hoje entrei','pela porta do carro']);
 assert.throws(()=>splitCues(cues,{maxWords:5}),/2 a 4/);assert.throws(()=>splitCues(cues,{maxWords:1}),/2 a 4/);
});

test('text, accents, punctuation, "-->" inside text and technical literals survive exactly and in order', ()=>{
 const {cues}=parseSrtDocument(capcut);
 assert.equal(cues.length,4);assert.equal(cues[3].text,'API A --> B','a body line with "-->" is text, not a timestamp');
 for(const maxWords of [2,3,4]){
  const {blocks}=splitCues(cues,{maxWords});
  assert.ok(sameWords(cues,blocks),`maxWords ${maxWords}`);
  assert.ok(blocks.every(b=>b.text.split(' ').length<=maxWords));
  assert.ok(noOverlap(blocks));
 }
 const {blocks}=splitCues(cues,{maxWords:3});
 assert.ok(texts(blocks).includes('E aí,')&&texts(blocks).includes('você viu?'),'breaks after comma and question mark');
 assert.ok(texts(blocks).some(t=>t.includes('{"modo":"json"}'))&&texts(blocks).some(t=>t.includes('C:\\pasta\\saída')),'braces and backslashes are data, not stripped as in the burn validator');
 const back=parseSrtDocument(blocksToSrt(blocks)).cues;
 assert.deepEqual(texts(back),texts(blocks),'export → import keeps "API A --> B" and every literal');
 assert.throws(()=>validateCaptionSegments([{start:7.2,end:8,text:'{"modo":"json"}'}],10),/não são aceitos/,'the libass validator stays strict and separate');
 assert.throws(()=>validateSrtBlocks([{start:0,end:1,text:'00:00:01,000 --> 00:00:02,000'}]),/linha de tempo/,'a block line equal to a full timestamp would corrupt the file');
});

test('long sentences, a very long word and a tight cue keep every word with valid ≥1 ms times', ()=>{
 const long=Array.from({length:45},(_,i)=>`palavra${i}`).join(' ');
 const mega='Pneumoultramicroscopicossilicovulcanoconiótico'.repeat(5);
 const srt=`1\n00:00:00,000 --> 00:00:20,000\n${long}\n\n2\n00:00:20,000 --> 00:00:21,000\n${mega} fim.\n\n3\n00:00:21,000 --> 00:00:21,001\num dois três quatro\n`;
 const {cues}=parseSrtDocument(srt);
 assert.equal(cues[0].end-cues[0].start,20,'a 20 s sentence (over the 12 s burn limit) imports before splitting');
 const {blocks,warnings}=splitCues(cues,{maxWords:3});
 assert.ok(sameWords(cues,blocks));assert.ok(noOverlap(blocks));
 assert.ok(blocks.some(b=>b.text.startsWith(mega)),'the long word is neither dropped nor truncated');
 assert.ok(blocks.every(b=>Math.round((b.end-b.start)*1000)>=1));
 assert.ok(warnings.includes('cue-too-short'),'a 1 ms cue with 4 words keeps them together and says so');
 assert.equal(blocks.at(-1).text,'um dois três quatro');
 validateSrtBlocks(blocks);
});

test('SRT parsing accepts BOM/LF/CRLF and positions, is strict about time; export is UTF-8 WITHOUT BOM + CRLF', ()=>{
 assert.throws(()=>parseSrtDocument('1\n00:00:02,000 --> 00:00:01,000\nx\n'),/fim precisa vir depois/);
 assert.throws(()=>parseSrtDocument('1\n00:00:00,000 --> 00:00:02,000\na\n\n2\n00:00:01,000 --> 00:00:03,000\nb\n'),/sobreposição/);
 assert.throws(()=>parseSrtDocument('1\nsem tempo\ntexto\n'),/linha de tempo/);
 assert.throws(()=>parseSrtDocument('1\nA --> B\ntexto\n'),/linha de tempo/,'"A --> B" is not a timestamp line');
 assert.throws(()=>parseSrtDocument(''),/vazio/);
 const plain='1\n00:00:00,500 --> 00:00:01,250\nAção já\n';
 for(const variant of ['\ufeff'+plain,plain,plain.replace(/\n/g,'\r\n'),'\ufeff'+plain.replace(/\n/g,'\r\n')])
  assert.deepEqual(parseSrtDocument(variant).cues,[{start:0.5,end:1.25,text:'Ação já'}]);
 assert.deepEqual(parseSrtDocument('1\n00:00:00,500 --> 00:00:01,250 X1:10 X2:20\nposição\n').cues[0].text,'posição');
 const parsed=parseSrtDocument('\ufeff00:00:00.5 --> 00:00:01.25\n<i>Ação</i> já\nsegunda linha\n\n\n\n2\n00:00:01,300 --> 00:00:02,000\n\n');
 assert.deepEqual(parsed.cues,[{start:0.5,end:1.25,text:'Ação já\nsegunda linha'}]);assert.deepEqual(parsed.warnings,['formatting-removed','empty-cue-skipped']);
 const {cues}=parseSrtDocument(capcut),{blocks}=splitCues(cues,{maxWords:3}),srt=blocksToSrt(blocks),bytes=Buffer.from(srt,'utf8');
 assert.ok(!bytes.subarray(0,3).equals(BOM),'no UTF-8 BOM (CapCut recommends UTF-8 without BOM)');
 assert.ok(srt.startsWith('1\r\n00:00:01,000 --> '));assert.ok(!/[^\r]\n/.test(srt),'every line break is CRLF');
 const back=parseSrtDocument(srt).cues;
 assert.deepEqual(texts(back),texts(blocks));assert.deepEqual(back.map(b=>[b.start,b.end]),blocks.map(b=>[b.start,b.end]));
 assert.equal(srtBlocksHash(blocks),srtBlocksHash(structuredClone(blocks)));
});

test('alignment with Whisper words of the same video lends times, never text; low match falls back to estimates', ()=>{
 const {cues}=parseSrtDocument('1\n00:00:01,000 --> 00:00:03,500\nEu hoje entrei pela porta do carro\n');
 const w=(start,end,text)=>({start,end,text});
 const words=[w(1.05,1.2,'eu'),w(1.25,1.5,'hoje'),w(1.55,1.9,'entrei'),w(2.4,2.6,'pela'),w(2.62,2.9,'porta'),w(2.95,3.05,'du'),w(3.1,3.4,'carro')];
 const aligned=splitCues(cues,{maxWords:3,words});
 assert.deepEqual(texts(aligned.blocks),['Eu hoje entrei','pela porta','do carro'],'SRT text kept even where Whisper heard "du"');
 assert.equal(aligned.blocks[0].timing,'aligned');assert.equal(aligned.blocks[0].start,1.05);assert.equal(aligned.blocks[1].start,2.4,'pause after "entrei" is a real boundary');
 assert.equal(aligned.blocks[2].timing,'estimated','"do" did not match, so that block is labelled estimated');
 assert.ok(aligned.alignment.used);
 const unrelated=splitCues(cues,{maxWords:3,words:[w(1,2,'outra'),w(2,3,'fala')]});
 assert.equal(unrelated.alignment.used,false);assert.ok(unrelated.warnings.includes('alignment-low'));assert.ok(unrelated.blocks.every(b=>b.timing==='estimated'));
});

test('direct generation from Whisper words keeps recognized words and their own times; units allow re-splitting', ()=>{
 const w=(start,end,text)=>({start,end,text});
 const words=[w(0.1,0.4,'Hoje'),w(0.42,0.7,'vamos'),w(0.72,1.0,'falar'),w(1.02,1.3,'de'),w(1.32,1.9,'edição.'),w(2.6,2.9,'Corte'),w(2.95,3.05,'é'),w(3.1,3.6,'90%'),w(3.62,4.0,'mais'),w(4.02,4.5,'rápido!')];
 const {blocks,warnings}=blocksFromTranscript({words},{maxWords:3,durationSeconds:5});
 assert.deepEqual(warnings,['whisper-approximate','word-timing']);
 assert.equal(blocks.map(b=>b.text).join(' '),words.map(x=>x.text).join(' '));
 assert.ok(blocks.every(b=>b.timing==='words'&&b.text.split(' ').length<=3));assert.ok(noOverlap(blocks));
 assert.ok(!blocks.some(b=>/ de$/.test(b.text)),'does not end a block on "de"');
 assert.equal(blocks.find(b=>b.text.startsWith('Corte')).start,2.6);
 assert.deepEqual(unitsFromBlocks(blocks).map(u=>u.text),['Hoje vamos falar de edição.','Corte é 90% mais rápido!'],'sentences rebuilt from blocks');
 assert.deepEqual(groupTokens([]),[]);
 assert.deepEqual(blocksFromTranscript({segments:[]},{maxWords:3}),{blocks:[],warnings:['no-speech']});
});

test('splitRow cuts at whole ms inside [start+1, end-1] and never leaves an empty half', ()=>{
 const row=(start,end,text)=>({key:'k',start,end,text,timing:'manual'});
 const tight=splitRow(row('0:01.000','0:01.002','a b'));
 assert.deepEqual(tight.map(r=>[r.start,r.end,r.text]),[['0:01.000','0:01.001','a'],['0:01.001','0:01.002','b']]);
 const mega=splitRow(row('0:00.000','0:00.010',`${'x'.repeat(500)} y`));
 assert.deepEqual(mega.map(r=>r.text),['x'.repeat(500),'y']);assert.equal(mega[0].end,'0:00.009','clamped to end-1 ms, the second half keeps ≥1 ms');
 assert.equal(splitRow(row('0:01.000','0:01.001','a b')),null,'1 ms cannot be split');
 assert.equal(splitRow(row('0:00.000','0:02.000','palavragigante')),null,'one word is never split into an empty half');
 assert.equal(formatClock(75.25),'1:15.250');
});

// ---- serviço: versões, CAS, exportação sem encode, recusas e mudanças durante await ---------------------------------
const sha=text=>createHash('sha256').update(text).digest('hex');
function fixture({transcribe,inspect,readBytes}={}){
 const root=mkdtempSync(join(tmpdir(),'content-srt-')),db=new DatabaseSync(':memory:');let profile='p1';
 db.exec('CREATE TABLE editorial_state (profile_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state_json TEXT NOT NULL, updated_at TEXT NOT NULL)');
 const video={id:'asset-video',contentId:'c1',workspaceId:'w1',kind:'video',role:'output',name:'editado.mp4',currentVersionId:'v1',versions:[{id:'v1',path:join(root,'editado.mp4'),sha256:sha('video-v1'),size:10}],status:'available'};
 writeFileSync(video.versions[0].path,'video-v1');// bytes reais com o sha registrado
 const state={schemaVersion:1,contents:[{id:'c1',workspaceId:'w1',title:'Carro'},{id:'c2',workspaceId:'w1',title:'Outro'}],assets:[video]};
 db.prepare('INSERT INTO editorial_state VALUES (?,?,?,?)').run('p1',1,JSON.stringify(state),'now');
 const calls=[];const w=(start,end,text)=>({start,end,text});
 const editorial=()=>JSON.parse(db.prepare('SELECT state_json FROM editorial_state WHERE profile_id=?').get('p1').state_json);
 const mutate=fn=>{const value=editorial();fn(value);db.prepare('UPDATE editorial_state SET state_json=?,revision=revision+1 WHERE profile_id=?').run(JSON.stringify(value),'p1');};
 const newVideoVersion=()=>mutate(value=>{const asset=value.assets.find(a=>a.id==='asset-video');asset.versions.push({id:`v${asset.versions.length+1}`,path:'x',sha256:sha(`video-v${asset.versions.length+1}`)});asset.currentVersionId=asset.versions.at(-1).id;});
 const words=[w(1.05,1.2,'Eu'),w(1.25,1.5,'hoje'),w(1.55,1.9,'entrei'),w(2.4,2.6,'pela'),w(2.62,2.9,'porta'),w(2.95,3.05,'do'),w(3.1,3.4,'carro')];
 const ctx={};
 const media={async transcribe(p,input){calls.push(input);if(transcribe)await transcribe(ctx);await new Promise(r=>setTimeout(r,5));return {transcript:{engine:'whisper.cpp',model:'ggml-base',segments:[{start:1,end:3.5,text:'Eu hoje entrei pela porta do carro'}],words}};}};
 const service=createContentSrt(db,{directory:join(root,'srt'),media,getCurrentProfile:()=>profile,inspect:async path=>{if(inspect)await inspect(ctx,path);return inspectLocalAsset(path,{stabilityMs:1});},readBytes:async path=>{const bytes=await readFile(path);return readBytes?readBytes(ctx,path,bytes):bytes;}});
 const waitJob=async docId=>{for(let i=0;i<400;i++){const doc=service.list('p1','c1').find(d=>d.id===docId);if(doc.job?.status!=='running')return doc;await new Promise(r=>setTimeout(r,5));}throw Error('job did not finish');};
 Object.assign(ctx,{root,db,service,calls,editorial,mutate,newVideoVersion,waitJob,video,setProfile:value=>{profile=value;}});
 return ctx;
}
const latest=doc=>doc.versions.at(-1);
const cas=doc=>({baseVersion:latest(doc).version,baseHash:latest(doc).hash});
const files=f=>{try{return readdirSync(join(f.root,'srt','p1','c1','srt'));}catch{return [];}};

test('correct a word → download directly (save+export in one action) → re-split 3→2 keeps the correction and limits', async()=>{
 const f=fixture(),before=JSON.stringify(f.editorial().assets[0]);
 const doc=await f.service.command('p1',{action:'import',contentId:'c1',name:'capcut.srt',srt:capcut});
 assert.equal(latest(doc).maxWords,3);assert.deepEqual(texts(latest(doc).blocks).slice(0,3),['Eu hoje entrei','pela porta','do carro']);
 // Usuário corrige "carro" → "carrão!" e puxa o fim da frase para 3,4 s, sem salvar: Baixar envia o rascunho.
 const draft=structuredClone(latest(doc).blocks);draft[2]={...draft[2],text:'do carrão!',end:3.4,timing:'manual'};
 const out=await f.service.command('p1',{action:'export',contentId:'c1',docId:doc.id,...cas(doc),blocks:draft});
 assert.equal(latest(out.document).origin,'edit');assert.equal(latest(out.document).version,2);
 const bytes=readFileSync(out.export.path),text=bytes.toString('utf8');
 assert.ok(!bytes.subarray(0,3).equals(BOM),'UTF-8 without BOM');assert.ok(!/[^\r]\n/.test(text),'CRLF only');
 assert.match(text,/\r\ndo carrão!\r\n/);assert.match(text,/00:00:02,\d{3} --> 00:00:03,400\r\ndo carrão!/);
 assert.equal(out.export.sha256,createHash('sha256').update(bytes).digest('hex'));
 // Redividir em 2: parte da versão corrigida (não da fonte original), mantendo os limites atuais da frase.
 const two=await f.service.command('p1',{action:'split',contentId:'c1',docId:doc.id,...cas(out.document),maxWords:2});
 const blocks=latest(two).blocks;
 assert.deepEqual(texts(blocks).slice(0,4),['Eu hoje','entrei','pela porta','do carrão!'],'the correction survives re-splitting');
 assert.equal(blocks[3].end,3.4,'the user-set end of the sentence is kept');assert.equal(blocks[0].start,1);
 assert.equal(latest(two).basedOn,2,'provenance: based on the corrected version');assert.equal(two.source.cues[0].text,'Eu hoje entrei pela porta do carro','original source kept intact');
 assert.ok(texts(blocks).some(t=>t.includes('-->')),'"-->" text survives re-splitting');
 const second=await f.service.command('p1',{action:'export',contentId:'c1',docId:doc.id,...cas(two)});
 const secondText=readFileSync(second.export.path,'utf8');
 assert.match(secondText,/do carrão!/);assert.doesNotMatch(secondText,/carro\b/,'old words never come back');
 assert.deepEqual(parseSrtDocument(secondText).cues.flatMap(c=>c.text.split(/\s+/)).slice(-4),['API','A','-->','B'],'"-->" inside text survives export/import as words');
 // Volta para 3: ainda corrigido.
 const three=await f.service.command('p1',{action:'split',contentId:'c1',docId:doc.id,...cas(second.document),maxWords:3});
 assert.deepEqual(texts(latest(three).blocks).slice(0,3),['Eu hoje entrei','pela porta','do carrão!']);
 assert.deepEqual(readFileSync(out.export.path),bytes,'previous export immutable');
 assert.equal(JSON.stringify(f.editorial().assets[0]),before,'video asset (sha/version) untouched');assert.equal(f.calls.length,0,'no transcription, render or encode');
});

test('export is idempotent per hash, registers one document, refuses stale versions and never overwrites external files', async()=>{
 const f=fixture();
 const doc=await f.service.command('p1',{action:'import',contentId:'c1',name:'capcut.srt',srt:capcut});
 const out=await f.service.command('p1',{action:'export',contentId:'c1',docId:doc.id,...cas(doc)});
 const again=await f.service.command('p1',{action:'export',contentId:'c1',docId:doc.id,...cas(doc)});
 assert.equal(out.reused,false);assert.equal(again.reused,true);assert.equal(again.export.path,out.export.path);
 assert.equal(files(f).length,1,'no partials or duplicates left');assert.equal(f.editorial().assets.filter(a=>a.kind==='document').length,1);
 const saved=await f.service.command('p1',{action:'save',contentId:'c1',docId:doc.id,...cas(doc),blocks:latest(doc).blocks.map((b,i)=>i===0?{...b,text:'Eu, hoje, entrei'}:b)});
 await assert.rejects(f.service.command('p1',{action:'export',contentId:'c1',docId:doc.id,...cas(doc)}),/mudou desde que você abriu/,'obsolete version cannot be exported');
 await assert.rejects(f.service.command('p1',{action:'save',contentId:'c1',docId:doc.id,...cas(doc),blocks:latest(doc).blocks}),/mudou desde que você abriu/);
 // Um arquivo divergente com o mesmo nome (editado fora do app) nunca é sobrescrito.
 const name=`capcut-v2-${latest(saved).hash.slice(0,8)}.srt`,path=join(f.root,'srt','p1','c1','srt',name);
 writeFileSync(path,'editado no bloco de notas');
 await assert.rejects(f.service.command('p1',{action:'export',contentId:'c1',docId:doc.id,...cas(saved)}),/arquivo diferente/);
 assert.equal(readFileSync(path,'utf8'),'editado no bloco de notas');assert.equal(files(f).filter(n=>n.endsWith('.partial')).length,0);
 assert.equal(f.service.list('p1','c1')[0].exports.length,1,'nothing recorded for the refused export');
});

test('export re-checks the bytes it published, not only the size', async()=>{
 const f=fixture({readBytes:(ctx,path,bytes)=>ctx.tamper&&path.endsWith('.srt')?Buffer.from(bytes.toString('utf8').replace('Eu','Tu')):bytes});
 const doc=await f.service.command('p1',{action:'import',contentId:'c1',name:'a.srt',srt:capcut});
 f.tamper=true;
 await assert.rejects(f.service.command('p1',{action:'export',contentId:'c1',docId:doc.id,...cas(doc)}),/não confere/);
 assert.equal(f.service.list('p1','c1')[0].exports.length,0);assert.equal(f.editorial().assets.filter(a=>a.kind==='document').length,0);
});

test('profile, content, workspace or linked video changing DURING the export await is refused (also on the idempotent path)', async()=>{
 for(const [label,change,pattern] of [
  ['profile',f=>f.setProfile('p2'),/perfil ativo mudou/],
  ['content removed',f=>f.mutate(v=>{v.contents=v.contents.filter(c=>c.id!=='c1');}),/não existe mais/],
  ['workspace',f=>f.mutate(v=>{v.contents[0].workspaceId='w9';}),/espaço de trabalho/],
 ]){
  const f=fixture({inspect:ctx=>{if(ctx.arm){ctx.arm=false;change(ctx);}}});
  const doc=await f.service.command('p1',{action:'import',contentId:'c1',name:'a.srt',srt:capcut});
  f.arm=true;
  await assert.rejects(f.service.command('p1',{action:'export',contentId:'c1',docId:doc.id,...cas(doc)}),pattern,label);
  f.setProfile('p1');
  assert.equal(JSON.parse(f.db.prepare('SELECT data_json FROM content_srt_documents').get().data_json).exports.length,0,`${label}: nothing recorded`);
  assert.equal(f.editorial().assets.filter(a=>a.kind==='document').length,0,`${label}: no document registered`);
 }
 // Caminho idempotente: a mudança acontece durante a releitura do arquivo já exportado.
 const f=fixture({readBytes:(ctx,path,bytes)=>{if(ctx.arm){ctx.arm=false;ctx.setProfile('p2');}return bytes;}});
 const doc=await f.service.command('p1',{action:'import',contentId:'c1',name:'a.srt',srt:capcut});
 await f.service.command('p1',{action:'export',contentId:'c1',docId:doc.id,...cas(doc)});
 f.arm=true;
 await assert.rejects(f.service.command('p1',{action:'export',contentId:'c1',docId:doc.id,...cas(doc)}),/perfil ativo mudou/);
 // Download: escopo revalidado depois da leitura.
 f.setProfile('p1');const exported=f.service.list('p1','c1')[0].exports[0];
 f.arm=true;await assert.rejects(f.service.file('p1',{contentId:'c1',docId:doc.id,sha256:exported.sha256}),/perfil ativo mudou/);
 f.setProfile('p1');
 const g=fixture({readBytes:(ctx,path,bytes)=>{if(ctx.arm){ctx.arm=false;ctx.mutate(v=>{v.contents=v.contents.filter(c=>c.id!=='c1');});}return bytes;}});
 const d2=await g.service.command('p1',{action:'import',contentId:'c1',name:'a.srt',srt:capcut}),e2=await g.service.command('p1',{action:'export',contentId:'c1',docId:d2.id,...cas(d2)});
 g.arm=true;await assert.rejects(g.service.file('p1',{contentId:'c1',docId:d2.id,sha256:e2.export.sha256}),/não existe mais/);
});

test('generate from the edited video: a video or profile change during the Whisper job is never applied; stale source blocks export', async()=>{
 const ref=f=>({assetId:'asset-video',versionId:'v1',sha256:f.video.versions[0].sha256});
 const ok=fixture();
 const started=await ok.service.command('p1',{action:'generate',contentId:'c1',...ref(ok),maxWords:3});
 assert.equal(started.job.status,'running');assert.equal(started.versions.length,0);
 const doc=await ok.waitJob(started.id);
 assert.equal(doc.job.status,'done');assert.deepEqual(ok.calls[0],{contentId:'c1',...ref(ok),language:'pt'});
 assert.deepEqual(texts(latest(doc).blocks),['Eu hoje entrei','pela porta','do carro']);
 assert.ok(latest(doc).blocks.every(b=>b.timing==='words'));assert.ok(latest(doc).warnings.includes('whisper-approximate'));
 assert.equal(latest(doc).blocks[0].start,1.05);assert.equal(doc.source.words,undefined,'raw words stay server-side');
 // Correção + redivisão no vídeo gerado: texto do usuário mantido; palavra corrigida sem casar com o áudio = estimada.
 const fixed=structuredClone(latest(doc).blocks);fixed[2]={...fixed[2],text:'do carrão'};
 const two=await ok.service.command('p1',{action:'split',contentId:'c1',docId:doc.id,...cas(doc),blocks:fixed,maxWords:2});
 assert.deepEqual(texts(latest(two).blocks),['Eu hoje','entrei','pela porta','do carrão']);assert.equal(latest(two).blocks[0].timing,'words');
 ok.newVideoVersion();
 await assert.rejects(ok.service.command('p1',{action:'export',contentId:'c1',docId:doc.id,...cas(two)}),/vídeo de origem mudou/);
 await assert.rejects(ok.service.command('p1',{action:'split',contentId:'c1',docId:doc.id,...cas(two),maxWords:3}),/vídeo de origem mudou/);

 const moved=fixture({transcribe:ctx=>ctx.newVideoVersion()});
 const m=await moved.service.command('p1',{action:'generate',contentId:'c1',...ref(moved)});
 const mdoc=await moved.waitJob(m.id);
 assert.equal(mdoc.job.status,'failed');assert.match(mdoc.job.error,/vídeo mudou durante a transcrição/);assert.equal(mdoc.versions.length,0);

 const swapped=fixture({transcribe:ctx=>ctx.setProfile('p2')});
 const s=await swapped.service.command('p1',{action:'generate',contentId:'c1',...ref(swapped)});
 await new Promise(r=>setTimeout(r,60));swapped.setProfile('p1');
 const sdoc=swapped.service.list('p1','c1')[0];
 assert.equal(sdoc.versions.length,0,'nothing applied under another profile');assert.notEqual(sdoc.job.status,'done');void s;
});

test('an imported SRT borrows word times from the same video (keeping the user draft); a changed video blocks split/export until re-sync or unsync', async()=>{
 const f=fixture(),ref={assetId:'asset-video',versionId:'v1',sha256:f.video.versions[0].sha256};
 const doc=await f.service.command('p1',{action:'import',contentId:'c1',name:'a.srt',srt:'1\n00:00:01,000 --> 00:00:03,500\nEu hoje entrei pela porta do carro\n'});
 const independent=await f.service.command('p1',{action:'import',contentId:'c1',name:'b.srt',srt:'1\n00:00:00,000 --> 00:00:01,000\nSó texto\n'});
 const draft=structuredClone(latest(doc).blocks);draft[0]={...draft[0],text:'Eu, hoje, entrei'};
 const running=await f.service.command('p1',{action:'align',contentId:'c1',docId:doc.id,...cas(doc),blocks:draft,...ref});
 assert.equal(running.job.status,'running');assert.equal(latest(running).origin,'edit','the valid draft is saved before syncing');
 await assert.rejects(f.service.command('p1',{action:'split',contentId:'c1',docId:doc.id,...cas(running),maxWords:2}),/Aguarde/);
 const done=await f.waitJob(doc.id);
 assert.equal(latest(done).origin,'align');assert.ok(latest(done).alignment.used);
 assert.equal(texts(latest(done).blocks).join(' '),'Eu, hoje, entrei pela porta do carro','user correction kept while aligning');
 const porta=latest(done).blocks.find(b=>b.text==='pela porta');assert.equal(porta.timing,'aligned');assert.equal(porta.start,2.4);
 f.newVideoVersion();
 await assert.rejects(f.service.command('p1',{action:'split',contentId:'c1',docId:doc.id,...cas(done),maxWords:2}),/vídeo usado para sincronizar/);
 await assert.rejects(f.service.command('p1',{action:'export',contentId:'c1',docId:doc.id,...cas(done)}),/vídeo usado para sincronizar/);
 const unsynced=await f.service.command('p1',{action:'unalign',contentId:'c1',docId:doc.id,...cas(done)});
 assert.equal(unsynced.alignment,undefined);assert.ok(latest(unsynced).blocks.every(b=>b.timing!=='aligned'));assert.ok(latest(unsynced).warnings.includes('alignment-removed'));
 const out=await f.service.command('p1',{action:'export',contentId:'c1',docId:doc.id,...cas(unsynced)});
 assert.equal(parseSrtDocument(readFileSync(out.export.path,'utf8')).cues.map(c=>c.text).join(' '),'Eu, hoje, entrei pela porta do carro');
 // SRT que nunca foi ligado a vídeo não depende de vídeo nenhum.
 const free=await f.service.command('p1',{action:'export',contentId:'c1',docId:independent.id,...cas(independent)});
 assert.equal(free.reused,false);
});

test('profile and content binding are refused before any work', async()=>{
 const f=fixture();
 const doc=await f.service.command('p1',{action:'import',contentId:'c1',name:'a.srt',srt:capcut});
 await assert.rejects(f.service.command('p1',{action:'split',contentId:'c2',docId:doc.id,...cas(doc),maxWords:2}),/não pertence a este conteúdo/);
 assert.throws(()=>f.service.list('p1','c-missing'),/não existe mais/);
 f.setProfile('p2');
 await assert.rejects(f.service.command('p1',{action:'export',contentId:'c1',docId:doc.id,...cas(doc)}),/perfil ativo mudou/);
 f.setProfile('p1');
 await assert.rejects(f.service.command('p1',{action:'import',contentId:'c1',srt:'1\n00:00:02,000 --> 00:00:01,000\nx\n'}),/fim precisa vir depois/);
 await assert.rejects(f.service.command('p1',{action:'generate',contentId:'c1',assetId:'asset-video',versionId:'v0',sha256:f.video.versions[0].sha256}),/mudou ou não é mais deste conteúdo/);
 await assert.rejects(f.service.command('p1',{action:'export',contentId:'c1',docId:doc.id,...cas(doc),blocks:[{start:2,end:1,text:'x'}]}),/fim precisa vir depois/,'invalid draft is never saved or exported');
 assert.equal(f.service.list('p1','c1')[0].versions.length,1);
 mkdirSync(join(f.root,'unused'),{recursive:true});
});

test('same bytes, new metadata: re-downloading after unsync reuses the file but the receipt describes the CURRENT version', async()=>{
 const f=fixture(),ref={assetId:'asset-video',versionId:'v1',sha256:f.video.versions[0].sha256};
 const doc=await f.service.command('p1',{action:'import',contentId:'c1',name:'a.srt',srt:'1\n00:00:01,000 --> 00:00:03,500\nEu hoje entrei pela porta do carro\n'});
 await f.service.command('p1',{action:'align',contentId:'c1',docId:doc.id,...cas(doc),...ref});
 const aligned=await f.waitJob(doc.id);
 assert.ok(latest(aligned).blocks.every(b=>b.timing==='aligned'));
 const first=await f.service.command('p1',{action:'export',contentId:'c1',docId:doc.id,...cas(aligned)});
 assert.equal(first.export.estimated,false);
 const unsynced=await f.service.command('p1',{action:'unalign',contentId:'c1',docId:doc.id,...cas(aligned)});
 assert.equal(latest(unsynced).version,latest(aligned).version+1,'a metadata-only change is a new version');
 assert.equal(latest(unsynced).hash,latest(aligned).hash,'same exportable bytes');
 assert.ok(latest(unsynced).blocks.every(b=>b.timing==='estimated'));
 const again=await f.service.command('p1',{action:'export',contentId:'c1',docId:doc.id,...cas(unsynced)});
 assert.equal(again.reused,true);assert.equal(again.export.path,first.export.path,'same file, no duplicate');
 assert.equal(again.export.version,latest(unsynced).version);assert.equal(again.export.estimated,true,'receipt no longer claims audio-aligned times');
 assert.equal(files(f).length,1);
});

test('a linked video overwritten on disk with stale metadata blocks the export; an independent SRT does not care', async()=>{
 const f=fixture(),ref={assetId:'asset-video',versionId:'v1',sha256:f.video.versions[0].sha256};
 const started=await f.service.command('p1',{action:'generate',contentId:'c1',...ref});
 const doc=await f.waitJob(started.id);
 const ok=await f.service.command('p1',{action:'export',contentId:'c1',docId:doc.id,...cas(doc)});
 assert.equal(ok.reused,false);
 writeFileSync(f.video.versions[0].path,'novo export do CapCut no mesmo caminho');
 assert.equal(f.editorial().assets[0].versions[0].sha256,ref.sha256,'metadata still says v1');
 await assert.rejects(f.service.command('p1',{action:'export',contentId:'c1',docId:doc.id,...cas(doc)}),/mudou no disco/);
 const free=await f.service.command('p1',{action:'import',contentId:'c1',name:'b.srt',srt:'1\n00:00:00,000 --> 00:00:01,000\nSó texto\n'});
 assert.equal((await f.service.command('p1',{action:'export',contentId:'c1',docId:free.id,...cas(free)})).reused,false);
});
