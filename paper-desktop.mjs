import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {paperFileIdPattern} from './paper-design.mjs';

const unavailable='Abra o Paper Desktop e um arquivo para usar a conexão.';
const textOf=result=>Array.isArray(result?.content)?result.content.filter(item=>item?.type==='text'&&typeof item.text==='string').map(item=>item.text).join('\n'):'';
const parsed=text=>{try{return JSON.parse(text);}catch{const start=text.indexOf('{'),end=text.lastIndexOf('}');if(start>=0&&end>start)try{return JSON.parse(text.slice(start,end+1));}catch{}return undefined;}};
const cleanName=value=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,300):'';
const validId=value=>typeof value==='string'&&paperFileIdPattern.test(value)?value:undefined;

/** File identity from get_basic_info, which has no declared output schema: structured content, JSON text or labelled text. */
export function basicInfoFile(result){
 const info=result?.structuredContent??parsed(textOf(result));
 if(info&&typeof info==='object'){
  const file=info.file&&typeof info.file==='object'?info.file:{};
  return {fileId:validId(info.fileId??file.id??file.fileId),fileName:cleanName(info.fileName??file.name)};
 }
 const text=textOf(result);
 return {fileId:validId(/\bfile\s*id\s*[:=]\s*["'`]?([A-Za-z0-9_:.-]{1,200})/i.exec(text)?.[1]),fileName:cleanName(/\bfile(?:\s*name)?\s*[:=]\s*["'`]?([^"'`\n]{1,300})/i.exec(text)?.[1])};
}

/** The foreground desktop tab from list_resources (documented fields: type, open, active). */
export function activeResourceFile(result){
 const data=result?.structuredContent??parsed(textOf(result));
 const items=Array.isArray(data)?data:Array.isArray(data?.items)?data.items:Array.isArray(data?.resources)?data.resources:[];
 const active=items.filter(item=>item&&typeof item==='object'&&item.type==='file'&&item.active===true);
 if(active.length!==1)return undefined;
 const fileId=validId(active[0].id??active[0].fileId);
 return fileId?{fileId,fileName:cleanName(active[0].name)}:undefined;
}

/**
 * Read-only inspection of the installed Paper CLI over stdio, without an AI turn, account data or config output:
 * get_guide, get_basic_info of the open file and, when its ID is not in that answer, the active tab from list_resources,
 * confirmed with get_basic_info({fileId}). Every step shares one bounded timeout; the process is always stopped.
 */
export async function inspectPaperDesktop({command=join(homedir(),'.paper','bin',process.platform==='win32'?'paper.exe':'paper'),spawnImpl=spawn,timeoutMs=15_000,maxOutput=2_000_000}={}){
 if(spawnImpl===spawn&&!existsSync(command))throw Error('Paper CLI não encontrado. Abra o Paper Desktop para instalar a conexão local.');
 let child;
 try{child=spawnImpl(command,['mcp'],{stdio:['pipe','pipe','pipe'],windowsHide:true});}catch{throw Error('Não foi possível iniciar a conexão local com o Paper.');}
 const pending=new Map();let buffer='',sequence=0,failure;
 const fail=error=>{failure??=error;for(const task of pending.values())task.reject(failure);pending.clear();};
 child.on('error',()=>fail(Error('Não foi possível iniciar a conexão local com o Paper.')));
 child.on('close',()=>fail(Error('A conexão local com o Paper foi encerrada.')));
 child.stdin.on('error',()=>fail(Error('A conexão local com o Paper foi encerrada.')));
 child.stdout.on('data',chunk=>{
  buffer+=chunk.toString();
  for(let end;(end=buffer.indexOf('\n'))>=0;){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let value;try{value=JSON.parse(line);}catch{continue;}
   const task=pending.get(value?.id);if(!task)continue;pending.delete(value.id);value.error?task.reject(Error('O Paper recusou a consulta.')):task.resolve(value.result);
  }
  if(buffer.length>maxOutput){fail(Error('O Paper retornou uma resposta grande demais.'));child.kill();}
 });
 // Diagnostics are consumed and never shown: they may contain paths or account details.
 child.stderr?.on('data',()=>{});
 const request=(method,params)=>new Promise((resolve,reject)=>{if(failure)return reject(failure);const id=++sequence;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
 const call=async(name,args)=>{
  const result=await request('tools/call',{name,arguments:args});
  if(result?.isError)throw Error(/isn't running|not running|no (?:open )?file|open (?:it|paper|a file)/i.test(textOf(result))?unavailable:'O Paper não conseguiu consultar o arquivo. Confira a conexão no Desktop.');
  return result;
 };
 const timer=setTimeout(()=>{fail(Error('O Paper não respondeu a tempo. Abra o Desktop e tente conectar novamente.'));child.kill();},timeoutMs);timer.unref?.();
 try{
  await request('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'MainsAgents Paper inspection',version:'1'}});
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized',params:{}})+'\n');
  await call('get_guide',{topic:'paper-mcp-instructions'});
  const open=basicInfoFile(await call('get_basic_info',{}));
  let file=open.fileId?open:undefined;
  if(!file){
   const active=activeResourceFile(await call('list_resources',{limit:50}));
   if(!active)throw Error('Não foi possível identificar o arquivo aberto no Paper. Deixe somente o arquivo desejado em primeiro plano e tente novamente.');
   const confirmed=basicInfoFile(await call('get_basic_info',{fileId:active.fileId}));
   if(confirmed.fileId&&confirmed.fileId!==active.fileId)throw Error('O Paper informou arquivos diferentes durante a conexão. Tente novamente.');
   file={fileId:active.fileId,fileName:active.fileName||confirmed.fileName||open.fileName};
  }
  return {fileId:file.fileId,fileName:file.fileName||'Arquivo do Paper',checkedAt:new Date().toISOString()};
 }finally{clearTimeout(timer);fail(Error('Consulta encerrada.'));child.kill();}
}
