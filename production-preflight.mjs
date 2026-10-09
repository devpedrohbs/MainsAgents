import {validateBudgetLimits} from './production-budget.mjs';

/**
 * Side-effect-free production preflight. It only reads the snapshot it is given: no runtime turns,
 * Notion/provider requests, files or processes. Facts the caller did not verify stay `unverified`.
 * Levels: `blocker` (verified, start refused), `warning` (verified, a later stage will stop),
 * `unverified` (not checked now; checked again when that stage runs), `ok`.
 */
export const preflightStages=['script','notion','recording','edit','package','schedule'];
import {productionProviders,providerOf,providerLabel,providerCapabilities} from './production-runtime.mjs';
const supported=agent=>productionProviders.includes(providerOf(agent));
// Staleness token only (not security): FNV-1a over a fixed-shape JSON, identical in renderer and main process.
function fnv(text){let a=0x811c9dc5,b=0x01000193;for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);a=Math.imul(a^c,0x01000193)>>>0;b=Math.imul(b^c,0x811c9dc5)>>>0;}return a.toString(16).padStart(8,'0')+b.toString(16).padStart(8,'0');}
// Every agent field that changes what a run executes. Credentials never live on agents; only these keys are read.
const executionFields=['id','name','role','instructions','workspaceId','providerId','modelId','tools','skillsDirectory','skills','skillFiles','disabledSkills','mcpPermissions','notionAutomation'];
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])])):value;
const ref=agent=>agent?canonical({...Object.fromEntries(executionFields.map(key=>[key,agent[key]])),providerId:agent.providerId??'codex'}):null;

export function productionPreflight({workspaceId,flow,agents=[],topic,topicCurrent=true,notion,notionDestination,scriptMode='notion',runtime,providers={},media,budget,entry}={},{locale='pt-BR'}={}){
 // Content sessions: a video already recorded enters at editing with a chosen card (read-only) or pasted context.
 const recorded=entry?.kind==='recorded',local=scriptMode==='local'||recorded;
 const pt=locale!=='en-US',checks=[],add=(id,stage,level,ptText,enText)=>checks.push({id,stage,level,message:pt?ptText:enText});
 const space=flow?.workspaceId??workspaceId,find=id=>id?agents.find(a=>a.id===id&&a.workspaceId===space):undefined;
 const sourceId=flow?.nodes?.find(n=>n.kind==='content-agent')?.agentId,editorId=flow?.nodes?.find(n=>n.kind==='video-agent')?.agentId,publisherId=flow?.nodes?.find(n=>n.kind==='publishing-agent')?.agentId??sourceId;
 const source=find(sourceId),editor=find(editorId),publisher=find(publisherId);
 if(!flow||workspaceId&&flow.workspaceId!==workspaceId)add('flow','script','blocker','Escolha um fluxo de produção deste espaço.','Choose a production flow from this workspace.');
 else add('flow','script','ok',`Fluxo: ${flow.name??flow.id}.`,`Flow: ${flow.name??flow.id}.`);
 const role=(id,stage,agent,label,missingPt,missingEn)=>{
  const name=providerLabel(providerOf(agent)),model=agent?.modelId?` · ${agent.modelId}`:'';
  if(!agent)add(id,stage,'blocker',missingPt,missingEn);
  else if(!supported(agent))add(id,stage,'blocker',`${label.pt} “${agent.name}” usa ${name}; a produção semiautomática executa agentes Codex ou Claude Code.`,`${label.en} “${agent.name}” uses ${name}; semi-automatic production runs Codex or Claude Code agents.`);
  else add(id,stage,'ok',`${label.pt}: ${agent.name} (${name}${model}).`,`${label.en}: ${agent.name} (${name}${model}).`);
 };
 // Recorded entry: the entry agent only keeps the conversation (no script turn); it runs AI only when it is also the publisher.
 const sourceRuns=!recorded||publisher?.id===source?.id;
 if(sourceRuns)role('source-agent','script',source,{pt:'Agente de conteúdo',en:'Content agent'},'Configure os agentes de conteúdo e vídeo neste fluxo.','Configure content and video agents in this flow.');
 else if(!source)add('source-agent','script','blocker','Configure o agente de entrada deste fluxo.','Configure this flow’s entry agent.');
 else add('source-agent','script','ok',`Agente de entrada: ${source.name} (mantém a conversa do conteúdo; nenhum roteiro é gerado).`,`Entry agent: ${source.name} (keeps the content conversation; no script is generated).`);
 // Each provider used by a role is checked separately: a process/CLI being present (availability) is not a sign-in (authentication).
 const status=id=>providers[id]??(id==='codex'&&runtime!==undefined?{available:runtime.connected,auth:'unverified',imageGeneration:true,reconcile:true,imageFile:runtime.imageFile}:undefined);
 const used=[...new Set([sourceRuns?source:undefined,editor,publisher].filter(agent=>agent&&supported(agent)).map(providerOf))];
 for(const id of used){
  const value=status(id),name=providerLabel(id),key=id==='codex'?'runtime':`runtime-${id}`,authKey=id==='codex'?'runtime-account':`auth-${id}`;
  if(value===undefined)add(key,'script','unverified',`A disponibilidade do runtime ${name} é verificada ao iniciar.`,`${name} runtime availability is checked when you start.`);
  else if(!value.available)add(key,'script','blocker',id==='claude'?(value.auth==='not-installed'?'Claude Code CLI não encontrado neste PC. Instale-o e reinicie o app; nenhuma etapa será executada por outro provedor.':'Runtime Claude Code indisponível neste app. Nenhuma etapa será executada por outro provedor.'):'Runtime Codex indisponível neste app. Conecte o Codex CLI antes de iniciar a produção.',id==='claude'?(value.auth==='not-installed'?'Claude Code CLI was not found on this PC. Install it and restart the app; no stage will run on another provider.':'The Claude Code runtime is unavailable in this app. No stage will run on another provider.'):'The Codex runtime is unavailable in this app. Connect the Codex CLI before starting the production.');
  else add(key,'script','ok',`Runtime ${name} ativo neste app (processo local).`,`${name} runtime active in this app (local process).`);
  const auth=value?.auth??'unverified';
  if(auth==='connected')add(authKey,'script','ok',`Login do ${name} confirmado localmente, sem chamada de IA. Limites e acesso ao modelo só aparecem no primeiro envio.`,`${name} sign-in confirmed locally without an AI call. Limits and model access only show on the first send.`);
  else if(auth==='login-required')add(authKey,'script','blocker',`${name} está instalado, mas sem login. Rode “claude auth login” e verifique novamente.`,`${name} is installed but not signed in. Run “claude auth login” and check again.`);
  else if(auth!=='not-installed')add(authKey,'script','unverified',id==='codex'?'Login, limites e acesso ao modelo do Codex não são confirmados aqui; só aparecem no primeiro envio.':`Login do ${name} não confirmado agora${auth==='error'?' (a consulta local falhou)':''}; aparece no primeiro envio.`,id==='codex'?'Codex sign-in, limits and model access are not confirmed here; they only show on the first send.':`${name} sign-in not confirmed now${auth==='error'?' (the local check failed)':''}; it shows on the first send.`);
  if(!providerCapabilities(id).reconcile)add(`reconcile-${id}`,'script','unverified',`${name} não permite conferir um turno interrompido após fechar o app; retomar pedirá sua autorização para reenviar.`,`${name} cannot verify an interrupted turn after the app closes; resuming will ask before resending.`);
 }
 if(recorded){if(!topic||topic.workspaceId!==space)add('topic','script','blocker','Abra a sessão de um conteúdo deste espaço.','Open a content session from this workspace.');else add('topic','script','ok',`Conteúdo: ${topic.title}. Vídeo já gravado: nenhuma ideia ou roteiro será gerado.`,`Content: ${topic.title}. Already recorded: no idea or script will be generated.`);}
 else if(!topic||topic.workspaceId!==space||!['review','approved'].includes(topic.status)||!topicCurrent)add('topic','script','blocker','Revise uma ideia estruturada atual antes de iniciar.','Review a current structured idea before starting.');
 else add('topic','script','ok',`Ideia: ${topic.title}.`,`Idea: ${topic.title}.`);
 if(budget!==undefined)try{validateBudgetLimits(budget);add('budget','script','ok','Limite de chamadas de IA válido.','AI call limit is valid.');}catch(error){add('budget','script','blocker',error.message,error.message);}
 // B07: local mode is an explicit choice; Notion is then neither read nor required (and never a silent fallback).
 if(recorded&&entry.context==='notion')add('notion-destination','notion',notion?.dataSourceId?'ok':'blocker',notion?.dataSourceId?`Card escolhido lido só como referência (base ${notion.dataSourceId}); nenhum card é criado ou alterado.`:'Nenhuma base Notion autorizada neste espaço para ler o card. Cole o contexto como texto.',notion?.dataSourceId?`Chosen card read for reference only (database ${notion.dataSourceId}); no card is created or changed.`:'No authorized Notion database in this workspace to read the card. Paste the context as text.');
 else if(recorded)add('notion-destination','notion','ok','Contexto colado por você; o Notion não é lido nem alterado.','Context pasted by you; Notion is neither read nor changed.');
 else if(local)add('notion-destination','notion','ok','Modo local: o roteiro aprovado libera a gravação sem card no Notion. Você pode ativar o Notion depois.','Local mode: the approved script releases recording without a Notion card. You can enable Notion later.');
 else if(notion===undefined)add('notion-destination','notion','unverified','O destino Notion configurado ainda não foi consultado.','The configured Notion destination has not been read yet.');
 else if(!notion?.autoSync||!notion.dataSourceId||notionDestination!==notion.dataSourceId)add('notion-destination','notion','blocker','Confira e habilite o destino Notion autorizado.','Check and enable the authorized Notion destination.');
 else add('notion-destination','notion','ok',`Destino Notion: ${notion.dataSourceId}.`,`Notion destination: ${notion.dataSourceId}.`);
 if(!local)add('notion-access','notion','unverified','O acesso de escrita à base Notion só é confirmado ao criar o card; esta verificação não consulta o Notion.','Write access to the Notion database is only confirmed when the card is created; this check does not contact Notion.');
 if(recorded)add('recording','recording',entry.video?'ok':'blocker',entry.video?'Vídeo já gravado associado: a edição começa direto, sem nova gravação.':'Associe o vídeo já gravado deste conteúdo.',entry.video?'Recorded video attached: editing starts directly, no new recording.':'Attach this content’s recorded video.');
 else add('recording','recording','ok',local?'A gravação não é necessária agora: adicione o vídeo depois de aprovar o roteiro.':'A gravação não é necessária agora: adicione o vídeo depois do card.',local?'No recording is needed now: add the video after approving the script.':'No recording is needed now: add the video after the card.');
 role('editor-agent','edit',editor,{pt:'Editor de vídeo',en:'Video editor'},'Configure os agentes de conteúdo e vídeo neste fluxo.','Configure content and video agents in this flow.');
 if(media===undefined)add('ffmpeg','edit','unverified','FFmpeg/ffprobe não verificados; são necessários na edição e nas capas.','FFmpeg/ffprobe not checked; they are needed for editing and covers.');
 else if(!media.ffmpeg||!media.ffprobe)add('ffmpeg','edit','warning','FFmpeg/ffprobe indisponível neste PC: roteiro e card funcionam, mas a edição vai parar até a instalação.','FFmpeg/ffprobe unavailable on this PC: script and card work, but editing will stop until installed.');
 else add('ffmpeg','edit','ok','FFmpeg e ffprobe disponíveis.','FFmpeg and ffprobe available.');
 role('publisher-agent','package',publisher,{pt:'Agente de publicação',en:'Publishing agent'},'Configure um agente para preparar a publicação.','Configure an agent to prepare publishing.');
 // Covers are local by default for every provider (FFmpeg, three concepts per format); image AI is never required or called automatically.
 if(media===undefined)add('cover-generation','package','unverified','Capas locais (FFmpeg, sem IA) usam o mesmo FFmpeg da edição; ele ainda não foi verificado.','Local covers (FFmpeg, no AI) use the same FFmpeg as editing; it has not been checked yet.');
 else if(!media.ffmpeg||!media.ffprobe)add('cover-generation','package','warning','Capas locais precisam de FFmpeg/ffprobe neste PC; a etapa de capas vai parar até a instalação.','Local covers need FFmpeg/ffprobe on this PC; the cover stage will stop until installed.');
 else if(media.thumbnails===false)add('cover-generation','package','warning',`O motor local de capas não está disponível: ${media.thumbnailReasons?.join('; ')||'filtros ou fonte ausentes'}.`,`The local cover engine is unavailable: ${media.thumbnailReasons?.join('; ')||'missing filters or font'}.`);
 else add('cover-generation','package','ok','Capas locais: três alternativas por formato com FFmpeg, sem IA nem quota.','Local covers: three alternatives per format with FFmpeg, no AI or quota.');
 add('publishing-accounts','schedule','unverified','Contas Zernio/Publora são consultadas somente quando você pedir, na etapa de agendamento.','Zernio/Publora accounts are only checked when you ask, at the scheduling stage.');
 const by=level=>checks.filter(c=>c.level===level);
 const fingerprint=fnv(JSON.stringify(canonical({flow:flow?.id??null,workspace:space??null,source:ref(source),editor:ref(editor),publisher:ref(publisher),topic:topic?{id:topic.id,status:topic.status,updatedAt:topic.updatedAt??null}:null,providers:Object.fromEntries(used.map(id=>[id,status(id)?{available:!!status(id).available,auth:status(id).auth??'unverified'}:'unread'])),...(recorded?{entry:canonical(entry)}:{}),...(local?{mode:'local'}:{}),notion:local?'local':{destination:notionDestination??null,config:notion===undefined?'unread':canonical({autoSync:!!notion?.autoSync,dataSourceId:notion?.dataSourceId??null})}})));
 return {ready:!by('blocker').length,fingerprint,checks,blockers:by('blocker'),warnings:by('warning'),unverified:by('unverified')};
}
