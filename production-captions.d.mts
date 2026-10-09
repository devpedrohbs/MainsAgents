import type {CaptionSegment,CaptionStyleId} from './editorial-captions.mjs';
export type CaptionRef={assetId:string;versionId:string;sha256:string};
export type CaptionVersion={version:number;hash:string;segments:CaptionSegment[];origin:'transcript'|'user'|'srt';timing:string;warnings:string[];createdAt:string};
/** Persisted on the production run (`run.captions`). Contract for B07/B09/B10 consumers: read-only outside the coordinator. */
export type ProductionCaptions={
 base:CaptionRef;durationSeconds:number;language:string;versions:CaptionVersion[];
 transcription?:{id:string;status:'running'|'done'|'failed'|'canceled'|'interrupted';mode?:'words';error?:string;startedAt:string;finishedAt?:string};
 approved?:{version:number;hash:string;style:CaptionStyleId;approvedAt:string};
 render?:{id:string;status:'running'|'done'|'failed'|'canceled'|'interrupted';version:number;hash:string;style:CaptionStyleId;progress?:number;error?:string;startedAt:string;finishedAt?:string};
 output?:CaptionRef&{version:number;hash:string;style:CaptionStyleId;srtAssetId?:string;audio:'copied'|'reencoded'|'none';font:string;engine:string;createdAt:string};
};
export const captionStyles:()=>Array<{id:CaptionStyleId;label:string}>;
export function sameRef(a:CaptionRef|null|undefined,b:CaptionRef|null|undefined):boolean;
export function captionBase(p:{outputVideo?:CaptionRef;captions?:ProductionCaptions}):CaptionRef|null;
export function captionsCurrent(p:{outputVideo?:CaptionRef;captions?:ProductionCaptions}):boolean;
export function coverVideo(p:{approvedVideo?:CaptionRef;captions?:ProductionCaptions}):CaptionRef|null;
export function initialCaptions(base:CaptionRef,durationSeconds:number,language:string):ProductionCaptions;
export function captionVersion(captions:ProductionCaptions,segments:unknown,info:{origin:CaptionVersion['origin'];timing:string;warnings?:string[]},at:string):CaptionVersion|null;
export function captionInput(input:{segments?:unknown;srt?:unknown},durationSeconds:number):{segments:CaptionSegment[];origin:'user'|'srt';timing:string};
export function captionLanguage(language:unknown):string;
export function validateCaptionStyle(id:unknown):CaptionStyleId;
