import {captionsHash,validateCaptionSegments,validateCaptionStyle,listCaptionStyles,parseSrt} from './editorial-captions.mjs';

/**
 * Speech captions burned into the production video (B05). The user reviews immutable caption versions (text and
 * timing) of one base video, approves version+style, and only then the local engine renders a NEW MP4. The base
 * (uncaptioned) video stays in the library; the burned file becomes the output video that still needs approval.
 */
export const captionStyles=listCaptionStyles;
export const sameRef=(a,b)=>!!a&&!!b&&a.assetId===b.assetId&&a.versionId===b.versionId&&a.sha256===b.sha256;
const refOf=ref=>({assetId:ref.assetId,versionId:ref.versionId,sha256:ref.sha256});
/** Output video is the burned file of the current captions → its base; otherwise the output video itself. */
export function captionBase(p){
 if(!p.outputVideo)return null;
 return p.captions?.output&&sameRef(p.captions.output,p.outputVideo)?refOf(p.captions.base):refOf(p.outputVideo);
}
/** Captions belong to one base video; a new edit (or a foreign output) makes them unusable. */
export const captionsCurrent=p=>!!p.captions&&!!p.outputVideo&&sameRef(p.captions.base,captionBase(p));
/** Covers use frames WITHOUT burned captions: the base of an approved captioned video, else the approved video. */
export function coverVideo(p){
 if(!p.approvedVideo)return null;
 return p.captions?.output&&sameRef(p.captions.output,p.approvedVideo)?refOf(p.captions.base):refOf(p.approvedVideo);
}
export function initialCaptions(base,durationSeconds,language){return {base:refOf(base),durationSeconds,language,versions:[]};}
/** Immutable version; identical content is a no-op (returns null). */
export function captionVersion(captions,segments,{origin,timing,warnings=[]},at){
 const clean=validateCaptionSegments(segments,captions.durationSeconds),hash=captionsHash(clean),latest=captions.versions.at(-1);
 if(latest?.hash===hash)return null;
 return {version:(latest?.version??0)+1,hash,segments:clean,origin,timing,warnings:[...new Set(warnings)].slice(0,8),createdAt:at};
}
/** Input of `captions-save`: edited segments or an SRT text (e.g. corrected in CapCut). Never both. */
export function captionInput(input,durationSeconds){
 if(typeof input.srt==='string'&&input.segments===undefined)return {segments:parseSrt(input.srt,durationSeconds),origin:'srt',timing:'imported'};
 if(Array.isArray(input.segments)&&input.srt===undefined)return {segments:validateCaptionSegments(input.segments,durationSeconds),origin:'user',timing:'manual'};
 throw Error('Envie as legendas editadas ou um arquivo SRT.');
}
export const captionLanguage=language=>['pt','en','es','fr','de','it'].includes(language)?language:'pt';
export {validateCaptionStyle};
