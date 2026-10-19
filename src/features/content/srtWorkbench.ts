// SRT editável separado do MP4 (para o CapCut). Tipos e chamadas HTTP; as regras de linha ficam em srtRows.ts.
// O servidor (content-srt.mjs + editorial-srt.mjs) é a autoridade e revalida tudo. Sem limites de legenda gravada (libass).
import {storageProfile} from '../../data/IndexedDbStateStore';
import type {SrtBlock} from './srtRows.ts';
export * from './srtRows.ts';

export interface SrtVersion {version:number;hash:string;maxWords:number;origin:'split'|'generate'|'align'|'edit';blocks:SrtBlock[];warnings:string[];alignment?:{ratio:number;used:boolean};basedOn?:number;createdAt:string}
export interface SrtExport {version:number;hash:string;name:string;path:string;size:number;sha256:string;assetId?:string;estimated:boolean;createdAt:string}
export interface SrtVideoRef {assetId:string;versionId:string;sha256:string}
export interface SrtDocument {
 id:string;contentId:string;workspaceId:string;title:string;
 source:{kind:'srt';name:string;sha256:string;cues:{start:number;end:number;text:string}[];warnings?:string[]}|({kind:'video';name:string;wordCount?:number;engine?:string}&SrtVideoRef);
 versions:SrtVersion[];exports:SrtExport[];
 job?:{id:string;kind:'transcribe';status:'running'|'done'|'failed'|'canceled'|'interrupted';error?:string;target:SrtVideoRef;maxWords:number};
 alignment?:SrtVideoRef&{engine?:string;wordCount?:number};
 createdAt:string;updatedAt:string;
}

const url=(path:string,query:Record<string,string>={})=>`/api/content/srt${path}?${new URLSearchParams({profile:storageProfile(),...query})}`;
async function call<T>(response:Promise<Response>):Promise<T>{
 const value=await response,body=await value.json().catch(()=>({}));
 if(!value.ok)throw new Error(body.error??`HTTP ${value.status}`);
 return body as T;
}
export const listSrt=(contentId:string,signal?:AbortSignal)=>call<{documents:SrtDocument[]}>(fetch(url('',{contentId}),{cache:'no-store',signal})).then(body=>body.documents);
export const srtCommand=<T=SrtDocument>(input:Record<string,unknown>,signal?:AbortSignal)=>call<T>(fetch(url(''),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input),signal}));
export const srtFileUrl=(contentId:string,docId:string,sha256:string)=>url('/file',{contentId,docId,sha256});
