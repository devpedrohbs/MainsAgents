import {randomUUID} from 'node:crypto';
import {productionRuntimeFor} from './production-runtime.mjs';
import {eventLimit} from './provider-limits.mjs';

/**
 * Radar daily synthesis: ONE text turn of a saved workspace agent (its Claude Code / Codex subscription login) over the
 * highlights the backend already measured. Evidence (numbers, links, snapshot ids) is attached by the backend; the model only
 * writes observation / hypothesis / idea, and only about items it was given. Before sending: the provider wait gate
 * (provider_waits, shared with production) and, for Claude, the account usage windows. A limit makes it wait; nothing
 * falls back to a paid API, and an interrupted turn is never re-sent automatically.
 */
export const SYNTHESIS_LIMITS=Object.freeze({youtube:8,news:8,recommendations:8,turnTimeoutMs:600_000,outputChars:200_000,dayAttempts:3,claudeFiveHourPercent:80,claudeWeeklyPercent:90});
const fail=(code,message,status=409)=>{throw Object.assign(Error(message),{code,status});};
const clip=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
const list=(value,maxItems,max)=>Array.isArray(value)?value.map(v=>clip(v,max)).filter(Boolean).slice(0,maxItems):[];

/** The highlights a synthesis may talk about, with the numbers the backend measured (null stays null). */
export function synthesisInput(items){
 const youtube=items.filter(i=>i.kind==='youtube'&&i.highlight).sort((a,b)=>(b.metrics?.logScore??0)-(a.metrics?.logScore??0)).slice(0,SYNTHESIS_LIMITS.youtube);
 const news=items.filter(i=>i.kind==='news'&&i.highlight).slice(0,SYNTHESIS_LIMITS.news);
 return [...youtube,...news].map(item=>{
  const m=item.metrics,latest=m?.latest??item.latestSnapshot??null;
  const numbers=item.kind==='youtube'
   ?{views:latest?.views??null,likes:latest?.likes??null,comments:latest?.comments??null,channelMedianViews:m?.baselineMedian??null,channelBaselineVideos:m?.baselineCount??null,ratioToChannelMedian:m?.ratio===null||m?.ratio===undefined?null:Math.round(m.ratio*100)/100,viewsPerHour:m?.growth?Math.round(m.growth.viewsPerHour):null,durationSeconds:item.durationSeconds??null}
   :{score:latest?.score??null,comments:latest?.comments??null};
  return {itemId:item.id,kind:item.kind,title:item.title,author:item.author,url:item.url,publishedAt:item.publishedAt,format:m?.format??null,maturity:m?.maturity??null,
   numbers,observedAt:latest?.collectedAt??item.lastSeenAt,snapshotIds:[...(m?.growth?[m.growth.fromSnapshotId]:[]),...(latest?.id?[latest.id]:[])],limitations:m?.limitations??['Notícia: só título, fonte e (no Hacker News) pontos e comentários; sem dados de alcance.']};
 });
}

export function synthesisPrompt(input){
 return [
  'Você é o analista editorial do Radar do MainsAgent. O criador produz vídeos próprios sobre tecnologia, IA, notícias e curiosidades e quer adaptar pautas, formatos e estruturas (abertura, narrativa, ritmo, motion) — nunca copiar.',
  'Você recebe SOMENTE os itens abaixo, com números coletados pelo app. Você NÃO assistiu aos vídeos nem leu as matérias: não descreva imagens, cortes, efeitos, edição, voz ou conteúdo que não esteja no título/números. Se algo dependeria de ver o vídeo, diga isso em "limitations".',
  'Separe evidência de hipótese: números altos não provam que um formato, corte ou efeito causou o desempenho. Toda hipótese precisa de pelo menos uma explicação alternativa (tema do momento, colaboração, canal grande, impulsionamento pago, horário, algoritmo).',
  'Não invente números. Cite apenas itemId da lista. Responda em português do Brasil.',
  `Escolha até ${SYNTHESIS_LIMITS.recommendations} itens mais úteis para o criador. Retorne SOMENTE JSON, sem texto fora dele:`,
  '{"recommendations":[{"itemId":"...","observation":"o que os dados e o título mostram","hypothesis":{"text":"por que pode ter funcionado","alternatives":["outra explicação"]},"idea":"como adaptar em um conteúdo próprio (pauta, ângulo, estrutura de abertura)","limitations":["..."]}]}',
  '',
  'ITENS:',
  JSON.stringify(input.map(({snapshotIds:_s,...item})=>item),null,1),
 ].join('\n');
}

/** Model output -> recommendations with backend evidence. Unknown items and malformed entries are dropped, never repaired. */
export function parseSynthesis(output,input){
 const text=String(output??''),start=text.indexOf('{'),end=text.lastIndexOf('}');
 if(start<0||end<=start)throw Object.assign(Error('A resposta da IA não trouxe JSON.'),{code:'invalid_output'});
 let body;try{body=JSON.parse(text.slice(start,end+1));}catch{throw Object.assign(Error('A resposta da IA não é um JSON válido.'),{code:'invalid_output'});}
 const byId=new Map(input.map(item=>[item.itemId,item])),seen=new Set(),out=[];
 for(const raw of Array.isArray(body?.recommendations)?body.recommendations:[]){
  const item=byId.get(raw?.itemId);if(!item||seen.has(item.itemId))continue;
  const observation=clip(raw.observation,1200),hypothesis=clip(raw.hypothesis?.text,1200),alternatives=list(raw.hypothesis?.alternatives,5,400),idea=clip(raw.idea,1200);
  if(!observation||!hypothesis||!alternatives.length||!idea)continue;
  seen.add(item.itemId);
  out.push({itemId:item.itemId,evidence:[{snapshotIds:item.snapshotIds,url:item.url,observedAt:item.observedAt,numbers:item.numbers}],observation,hypothesis:{text:hypothesis,alternatives},idea,
   limitations:[...new Set(['A IA recebeu só títulos e números; não assistiu aos vídeos.',...item.limitations,...list(raw.limitations,6,400)])]});
  if(out.length>=SYNTHESIS_LIMITS.recommendations)break;
 }
 if(!out.length)throw Object.assign(Error('A IA não devolveu nenhuma recomendação válida para os itens enviados.'),{code:'invalid_output'});
 return out;
}

export function createRadarSynthesis(db,{getAgents,getRuntime,getChatRuntime,getProviderStatus,readClaudeUsage,providerWaits,clock=()=>Date.now()}={}){
 db.exec(`CREATE TABLE IF NOT EXISTS radar_syntheses(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,workspace_id TEXT NOT NULL,day_key TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL,provider_id TEXT,agent_id TEXT,data_json TEXT NOT NULL,created_at TEXT NOT NULL,finished_at TEXT);
 CREATE INDEX IF NOT EXISTS radar_syntheses_scope ON radar_syntheses(profile_id,workspace_id,created_at);`);
 // An interrupted turn may or may not have reached the provider: it is history, never re-sent on its own.
 db.exec("UPDATE radar_syntheses SET status='interrupted',finished_at=created_at,data_json=json_set(data_json,'$.message','O app fechou durante a síntese; ela não é reenviada automaticamente.') WHERE status='running'");
 const now=()=>new Date(clock()).toISOString();
 const running=new Map(),controllers=new Set();
 const keyOf=scope=>`${scope.profile}\0${scope.workspaceId}`;
 const agentsOf=scope=>(getAgents?.(scope.profile)??[]).filter(a=>a?.workspaceId===scope.workspaceId).map(a=>({...a,providerId:a.providerId??'codex'})).filter(a=>['claude','codex'].includes(a.providerId));
 const rowOf=row=>{const data=JSON.parse(row.data_json);return {id:row.id,status:row.status,providerId:row.provider_id,agentId:row.agent_id,dayKey:row.day_key,createdAt:row.created_at,finishedAt:row.finished_at,waitingUntil:data.waitingUntil??null,message:data.message??null,recommendations:data.recommendations??[],gate:data.gate??null};};
 const latest=scope=>{const row=db.prepare('SELECT * FROM radar_syntheses WHERE profile_id=? AND workspace_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(scope.profile,scope.workspaceId);return row?rowOf(row):null;};
 const today=(scope,day)=>db.prepare('SELECT * FROM radar_syntheses WHERE profile_id=? AND workspace_id=? AND day_key=? ORDER BY created_at').all(scope.profile,scope.workspaceId,day).map(rowOf);
 const finish=(id,status,data)=>db.prepare('UPDATE radar_syntheses SET status=?,data_json=?,finished_at=? WHERE id=?').run(status,JSON.stringify(data),now(),id);

 /** Why this provider must not be called now (null = may send). Reads only local state and the free usage endpoint. */
 async function gate(scope,providerId){
  const wait=providerWaits?.get(scope.profile,providerId);
  if(wait)return {status:'waiting_limit',gate:'provider_wait',waitingUntil:wait.resetsAt??null,message:`${providerId==='claude'?'Claude Code':'Codex'} está em espera por limite de uso${wait.resetsAt?'':' (sem horário de reset informado; use "Retomar" no app quando o limite passar)'}.`};
  if(providerId!=='claude')return null;
  let status;try{status=await getProviderStatus?.('claude');}catch{}
  if(status?.state==='login-required')return {status:'blocked',gate:'login',waitingUntil:null,message:'Claude Code está sem login. Rode "claude auth login"; nada foi enviado.'};
  if(status?.state==='not-installed')return {status:'blocked',gate:'login',waitingUntil:null,message:'Claude Code CLI não encontrado; nada foi enviado.'};
  let usage;try{usage=await readClaudeUsage?.();}catch{}
  if(usage?.error==='api-billing')return {status:'blocked',gate:'billing',waitingUntil:null,message:'O Claude Code está configurado para API paga; o Radar só usa a assinatura. Nada foi enviado.'};
  const windows=[['fiveHours',SYNTHESIS_LIMITS.claudeFiveHourPercent,'5 horas'],['weekly',SYNTHESIS_LIMITS.claudeWeeklyPercent,'semanal']];
  for(const [key,max,label] of windows){const w=usage?.[key];if(w&&w.usedPercent>=max)return {status:'waiting_limit',gate:'usage',waitingUntil:w.resetsAt?new Date(w.resetsAt*1000).toISOString():null,message:`Uso do Claude em ${Math.round(w.usedPercent)}% da janela ${label} (limite do Radar: ${max}%); a síntese espera o reset para não disputar sua cota.`};}
  return null;
 }

 async function turn(agent,prompt,signal){
  const rt=productionRuntimeFor(agent.providerId,{getRuntime,getChatRuntime});
  if(!rt)throw Object.assign(Error(agent.providerId==='claude'?'Claude Code indisponível neste app; nada foi enviado.':'Codex não está conectado; nada foi enviado.'),{code:'unavailable'});
  const threadId=await rt.createSession(agent);if(signal.aborted)throw Error('Síntese cancelada.');
  const execution=await rt.send(threadId,prompt,agent);
  const stop=()=>void rt.cancel(threadId,execution.executionId).catch(()=>{});signal.addEventListener('abort',stop,{once:true});
  let output='',completed=false;
  try{for await(const event of rt.events(execution.executionId,signal)){
   if(event.type==='message.delta')output+=event.delta;if(event.type==='message.completed')output=event.content;
   if(output.length>SYNTHESIS_LIMITS.outputChars)throw Error('A resposta excedeu o limite.');
   if(event.type==='execution.failed'){const limit=eventLimit(event);throw Object.assign(Error(event.message??'A execução falhou.'),{code:limit?'provider_limit':event.code??'failed',limit});}
   if(event.type==='execution.cancelled')throw Error('Síntese cancelada.');if(event.type==='execution.completed')completed=true;
  }}finally{signal.removeEventListener('abort',stop);}
  if(!completed)throw Object.assign(Error('O turno terminou sem confirmação; não foi reenviado.'),{code:'uncertain'});
  return output;
 }

 /**
  * Starts a synthesis of the given items. Returns {synthesisId, status, task}. A gate that blocks is recorded as its own
  * synthesis row (waiting_limit / blocked) so the UI can explain it; nothing is sent then.
  */
 async function start(scope,{items,agentId,day,reason='manual'}){
  if(running.has(keyOf(scope)))fail('already_running','Já há uma síntese em andamento.');
  const agent=agentsOf(scope).find(a=>a.id===agentId);
  if(!agent)fail('no_agent','Escolha um agente Claude ou Codex salvo neste workspace para a síntese.');
  const input=synthesisInput(items);
  if(!input.length)fail('nothing_to_synthesize','Ainda não há destaques para sintetizar. Colete primeiro.');
  const id=randomUUID(),insert=(status,data)=>db.prepare('INSERT INTO radar_syntheses VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,scope.profile,scope.workspaceId,day,reason,status,agent.providerId,agent.id,JSON.stringify(data),now(),status==='running'?null:now());
  running.set(keyOf(scope),null);
  let blocked;try{blocked=await gate(scope,agent.providerId);}catch{blocked=null;}
  if(blocked){running.delete(keyOf(scope));insert(blocked.status,{...blocked,recommendations:[]});return {synthesisId:id,status:blocked.status,task:Promise.resolve(blocked.status)};}
  insert('running',{message:null,recommendations:[]});
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),SYNTHESIS_LIMITS.turnTimeoutMs);timer.unref?.();controllers.add(controller);
  const task=(async()=>{
   try{
    const recommendations=parseSynthesis(await turn(agent,synthesisPrompt(input),controller.signal),input);
    finish(id,'ready',{message:null,recommendations});return 'ready';
   }catch(error){
    if(error.code==='provider_limit'&&error.limit){providerWaits?.open(scope.profile,agent.providerId,error.limit);finish(id,'waiting_limit',{gate:'provider_wait',waitingUntil:error.limit.resetsAt??null,message:`${agent.providerId==='claude'?'Claude Code':'Codex'} atingiu o limite de uso; a síntese espera.`,recommendations:[]});return 'waiting_limit';}
    if(['login_required','provider_billing'].includes(error.code)){finish(id,'blocked',{gate:error.code==='provider_billing'?'billing':'login',message:error.message,recommendations:[]});return 'blocked';}
    finish(id,controller.signal.aborted?'interrupted':'failed',{message:controller.signal.aborted?'Síntese interrompida (tempo esgotado ou app fechando).':String(error.message??error).slice(0,400),recommendations:[]});return controller.signal.aborted?'interrupted':'failed';
   }finally{clearTimeout(timer);controllers.delete(controller);running.delete(keyOf(scope));}
  })();
  running.set(keyOf(scope),task);
  return {synthesisId:id,status:'running',task};
 }

 /**
  * Whether today's automatic synthesis should (re)start: none yet, or a usage/provider wait whose reset passed
  * (or whose provider wait was released by the person), within the daily attempt limit.
  */
 function due(scope,day){
  if(running.has(keyOf(scope)))return false;
  const rows=today(scope,day).filter(r=>r.dayKey===day);
  if(!rows.length)return true;
  const last=rows.at(-1);if(last.status!=='waiting_limit'||rows.length>=SYNTHESIS_LIMITS.dayAttempts)return false;
  if(last.gate==='provider_wait')return !providerWaits?.get(scope.profile,last.providerId);
  return Boolean(last.waitingUntil)&&Date.parse(last.waitingUntil)<=clock();
 }
 const publicOf=row=>row?(({gate:_g,...rest})=>rest)(row):{id:null,status:'none',providerId:null,agentId:null,dayKey:null,createdAt:null,finishedAt:null,waitingUntil:null,message:null,recommendations:[]};
 return {
  start,due,agents:scope=>agentsOf(scope).map(a=>({id:a.id,name:a.name??a.id,providerId:a.providerId})),
  latest:scope=>publicOf(latest(scope)),
  running:scope=>running.has(keyOf(scope)),
  pending:scope=>running.get(keyOf(scope))??null,
  async close(){for(const c of controllers)c.abort();await Promise.allSettled([...running.values()].filter(Boolean));},
 };
}
