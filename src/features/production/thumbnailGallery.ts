// F04 — thumbnail gallery model. Pure helpers, no I/O, no FFmpeg. The gallery is controlled:
// the integrator owns the state and calls the F03 engine (renderThumbnailSet) only on explicit actions.
// Local types mirror the announced F03 contract; replace with editorial-thumbnails.d.mts when it exists.

export const CONCEPT_IDS=['product','person','benefit'] as const;
export type ThumbnailConceptId=typeof CONCEPT_IDS[number];
export interface ThumbnailFraming {focusX:number;focusY:number;zoom:number}
export interface ThumbnailConcept {id:ThumbnailConceptId;timestampSeconds:number;title:string;kicker:string;framing:ThumbnailFraming}
export interface ThumbnailSource {path?:string;assetId:string;versionId:string;sha256:string}
export interface ThumbnailFormat {id:string;label:string;width:number;height:number}

/** One exported cover as returned by the engine manifest. `previewRef` is resolved to a stream URL by the caller, never a file path. */
export interface ThumbnailArtifact {
 conceptId:ThumbnailConceptId;format:string;assetId:string;sha256:string;width:number;height:number;
 sourceVersionId:string;sourceSha256:string;
 /** Signature of the inputs that produced this file (see conceptSignature). */
 inputsSignature:string;
}
export type ThumbnailItemStatus={state:'idle'}|{state:'loading'}|{state:'error';message:string};

export interface ThumbnailGalleryState {
 sourceKey:string;
 concepts:ThumbnailConcept[];
 selectedId:ThumbnailConceptId|null;
 approvedId:ThumbnailConceptId|null;
 /** Latest generated artifact per `${conceptId}:${format}`. */
 artifacts:Record<string,ThumbnailArtifact>;
}

export const sourceKey=(s:Pick<ThumbnailSource,'assetId'|'versionId'|'sha256'>)=>`${s.assetId}@${s.versionId}#${s.sha256}`;
export const artifactKey=(conceptId:string,format:string)=>`${conceptId}:${format}`;
const clamp=(n:number,lo:number,hi:number)=>Number.isFinite(n)?Math.min(hi,Math.max(lo,n)):lo;
export const clampFraming=(f:ThumbnailFraming):ThumbnailFraming=>({focusX:clamp(f.focusX,0,1),focusY:clamp(f.focusY,0,1),zoom:clamp(f.zoom,1,3)});

/** Three visually distinct starting concepts; text is empty-safe and always editable. */
export function defaultConcepts(durationSeconds=0):ThumbnailConcept[]{
 const at=(p:number)=>durationSeconds>0?Math.round(durationSeconds*p*10)/10:0;
 return [
  {id:'product',timestampSeconds:at(0.5),title:'',kicker:'',framing:{focusX:0.5,focusY:0.55,zoom:1.6}},
  {id:'person',timestampSeconds:at(0.15),title:'',kicker:'',framing:{focusX:0.35,focusY:0.4,zoom:1.3}},
  {id:'benefit',timestampSeconds:at(0.85),title:'',kicker:'',framing:{focusX:0.65,focusY:0.5,zoom:1}},
 ];
}

export function createGalleryState(source:ThumbnailSource,concepts:ThumbnailConcept[]=defaultConcepts()):ThumbnailGalleryState{
 return {sourceKey:sourceKey(source),concepts,selectedId:null,approvedId:null,artifacts:{}};
}

export function conceptSignature(c:ThumbnailConcept,format:string,source:Pick<ThumbnailSource,'assetId'|'versionId'|'sha256'>):string{
 const f=clampFraming(c.framing);
 return JSON.stringify([sourceKey(source),format,c.id,c.timestampSeconds,c.title.trim(),c.kicker.trim(),f.focusX,f.focusY,f.zoom]);
}

export function conceptErrors(c:ThumbnailConcept,durationSeconds?:number):Array<'title'|'timestamp'>{
 const e:Array<'title'|'timestamp'>=[];
 if(!c.title.trim())e.push('title');
 if(!Number.isFinite(c.timestampSeconds)||c.timestampSeconds<0||(durationSeconds!=null&&durationSeconds>0&&c.timestampSeconds>durationSeconds))e.push('timestamp');
 return e;
}

/** Current artifact for concept+format, or null if absent. */
export const artifactFor=(s:ThumbnailGalleryState,conceptId:string,format:string)=>s.artifacts[artifactKey(conceptId,format)]??null;

/** An artifact is stale when any input (frame, text, framing, source version, format) differs from what produced it. */
export function isStale(s:ThumbnailGalleryState,source:ThumbnailSource,conceptId:ThumbnailConceptId,format:string):boolean{
 const a=artifactFor(s,conceptId,format),c=s.concepts.find(x=>x.id===conceptId);
 if(!a||!c)return true;
 return a.inputsSignature!==conceptSignature(c,format,source)||a.sourceVersionId!==source.versionId||a.sourceSha256!==source.sha256;
}

export function updateConcept(s:ThumbnailGalleryState,id:ThumbnailConceptId,patch:Partial<Omit<ThumbnailConcept,'id'>>):ThumbnailGalleryState{
 const concepts=s.concepts.map(c=>c.id===id?{...c,...patch,framing:patch.framing?clampFraming(patch.framing):c.framing}:c);
 // Editing inputs never deletes the file, it only makes it stale; an approval of a now-stale output is withdrawn.
 return {...s,concepts,approvedId:s.approvedId===id?null:s.approvedId};
}

/** New source version/hash invalidates selection, approval and every generated output. */
export function applySource(s:ThumbnailGalleryState,source:ThumbnailSource):ThumbnailGalleryState{
 const key=sourceKey(source);
 return key===s.sourceKey?s:{...s,sourceKey:key,selectedId:null,approvedId:null,artifacts:{}};
}

export function recordArtifact(s:ThumbnailGalleryState,source:ThumbnailSource,a:ThumbnailArtifact):ThumbnailGalleryState{
 if(a.sourceVersionId!==source.versionId||a.sourceSha256!==source.sha256||s.sourceKey!==sourceKey(source))return s; // late result for an old source
 return {...s,artifacts:{...s.artifacts,[artifactKey(a.conceptId,a.format)]:a}};
}

export const selectConcept=(s:ThumbnailGalleryState,id:ThumbnailConceptId|null):ThumbnailGalleryState=>({...s,selectedId:id,approvedId:id===s.approvedId?s.approvedId:null});

export function canGenerate(c:ThumbnailConcept,busy:boolean,durationSeconds?:number){return !busy&&conceptErrors(c,durationSeconds).length===0}

/** Approval needs the selected concept's current, non-stale exported artifact. */
export function canApprove(s:ThumbnailGalleryState,source:ThumbnailSource,format:string,busy:boolean):boolean{
 if(busy||!s.selectedId||s.sourceKey!==sourceKey(source))return false;
 return !!artifactFor(s,s.selectedId,format)&&!isStale(s,source,s.selectedId,format);
}
export function approve(s:ThumbnailGalleryState,source:ThumbnailSource,format:string):ThumbnailGalleryState{
 return canApprove(s,source,format,false)?{...s,approvedId:s.selectedId}:s;
}

/** Only stream-style URLs may reach <img>. Filesystem paths and file: URLs are rejected. */
export function isSafePreviewUrl(url:unknown):url is string{
 if(typeof url!=='string')return false;
 const u=url.trim();
 if(!u||/^[a-zA-Z]:[\\/]/.test(u)||u.startsWith('\\\\')||/^file:/i.test(u))return false;
 return /^(https?:\/\/|blob:|data:image\/)/i.test(u);
}
