import {artifactHash} from './editorial-jobs.mjs';
import {listThumbnailFormats,validateThumbnailRequest,CONCEPTS,LIMITS} from './editorial-thumbnails.mjs';

/**
 * Local cover gate (covers-review). The F03 engine renders three concepts per format with FFmpeg only; the user
 * compares, exports, selects and approves one exact exported file per destination. No AI call is involved.
 */
export const defaultPlatformFormats=Object.freeze({Instagram:'instagram-reels-cover',TikTok:'tiktok-cover',LinkedIn:'instagram-feed-4x5'});
/** Networks with a preset made for them. Others (LinkedIn) only get an approximate starting format the user must confirm. */
export const presetPlatforms=Object.freeze(['Instagram','TikTok']);
export const coverFormats=()=>listThumbnailFormats().map(({id,label,width,height})=>({id,label,width,height}));
const formatIds=()=>coverFormats().map(f=>f.id);
const clip=(text,max)=>[...String(text??'').replace(/\s+/g,' ').trim()].slice(0,max).join('');
const sourceOf=ref=>({assetId:ref.assetId,versionId:ref.versionId,sha256:ref.sha256});
export const sameSource=(a,b)=>!!a&&!!b&&a.assetId===b.assetId&&a.versionId===b.versionId&&a.sha256===b.sha256;

/** Starting point for a run whose video was approved: three distinct concepts, editable titles from the approved script. */
export function initialCovers(p){
 const duration=Number(p.editPlan?.outputDuration??p.videoMetadata?.duration??0),at=f=>duration>0?Math.round(duration*f*10)/10:0;
 const hook=clip(p.script?.hook||p.topic?.title,LIMITS.title),topic=clip(p.topic?.title||p.script?.hook,LIMITS.title),cta=clip(p.script?.cta||p.topic?.title,LIMITS.title);
 return {
  source:sourceOf(p.approvedVideo),durationSeconds:duration,
  concepts:[
   {id:'product',timestampSeconds:at(0.5),title:hook,kicker:'',framing:{focusX:0.5,focusY:0.55,zoom:1.6}},
   {id:'person',timestampSeconds:at(0.15),title:topic,kicker:'',framing:{focusX:0.5,focusY:0.4,zoom:1.3}},
   {id:'benefit',timestampSeconds:at(0.85),title:cta,kicker:'',framing:{focusX:0.5,focusY:0.5,zoom:1}},
  ],
  brand:{theme:'dark',accent:'#2f6bff'},
  destinations:(p.platforms??[]).map(platform=>({platform,format:defaultPlatformFormats[platform]??'instagram-reels-cover',confirmed:presetPlatforms.includes(platform)})),
  batches:{},
 };
}
/** Gallery concepts → engine concepts. Throws the engine's validation error (Portuguese) for invalid fields. */
export function engineConcepts(concepts){
 if(!Array.isArray(concepts)||concepts.length!==3)throw Error('Envie os três conceitos de capa.');
 return concepts.map(c=>({concept:c?.id,timestampSeconds:c?.timestampSeconds,title:c?.title,...(typeof c?.kicker==='string'&&c.kicker.trim()?{kicker:c.kicker}:{}),framing:c?.framing}));
}
export function galleryConcepts(concepts){
 return CONCEPTS.map(id=>{const c=concepts.find(x=>x?.id===id);return {id,timestampSeconds:Number(c.timestampSeconds),title:String(c.title).trim(),kicker:typeof c.kicker==='string'?c.kicker.trim():'',framing:{focusX:Number(c.framing?.focusX??0.5),focusY:Number(c.framing?.focusY??0.5),zoom:Number(c.framing?.zoom??1)}};});
}
export function validateBrandInput(raw){
 if(!raw||typeof raw!=='object')return {theme:'dark',accent:'#2f6bff'};
 const keys=Object.keys(raw);if(keys.some(k=>!['theme','accent','logoAssetId'].includes(k)))throw Error('Campo de marca não permitido.');
 if(!['dark','light'].includes(raw.theme??'dark'))throw Error('Escolha o tema claro ou escuro.');
 if(raw.accent!==undefined&&(typeof raw.accent!=='string'||!/^#[0-9a-fA-F]{6}$/.test(raw.accent)))throw Error('A cor de destaque deve ser #RRGGBB.');
 if(raw.logoAssetId!==undefined&&raw.logoAssetId!==null&&raw.logoAssetId!==''&&(typeof raw.logoAssetId!=='string'||raw.logoAssetId.length>200))throw Error('Escolha um logo da biblioteca deste conteúdo.');
 return {theme:raw.theme??'dark',accent:(raw.accent??'#2f6bff').toLowerCase(),...(raw.logoAssetId?{logoAssetId:raw.logoAssetId}:{})};
}
/** Normalized inputs used for staleness: two requests render the same files exactly when this hash matches. */
export function coverInputsHash({sourcePath,source,format,concepts,brand}){
 const spec=validateThumbnailRequest({source:{path:sourcePath,...sourceOf(source)},format,concepts:engineConcepts(concepts),brand:{theme:brand.theme,accent:brand.accent},safeAreaPreview:false});
 return artifactHash({source:sourceOf(source),format:spec.format,fileType:spec.fileType,concepts:spec.concepts,brand:{theme:spec.brand.theme,accent:spec.brand.accent,logoAssetId:brand.logoAssetId??null}});
}
export function validateFormat(format){if(!formatIds().includes(format))throw Error('Escolha um formato de capa conhecido.');return format;}
export function validateDestinations(input,platforms){
 if(!Array.isArray(input)||input.length!==platforms.length||new Set(input.map(d=>d?.platform)).size!==platforms.length||input.some(d=>!platforms.includes(d?.platform)))throw Error('Escolha um formato de capa para cada rede.');
 return platforms.map(platform=>{const d=input.find(x=>x.platform===platform),confirmed=presetPlatforms.includes(platform)||d.confirmed===true;if(!confirmed)throw Error(`${platform} não tem um modelo de capa próprio verificado. Escolha e confirme o formato que vai usar.`);return {platform,format:validateFormat(d.format),confirmed};});
}
/**
 * Productions created before the local cover gate. Runs still generating AI covers (or paused there) move to
 * covers-review and need an explicit selection; package-review/schedule/complete keep their covers untouched.
 */
export function migrateCoverGate(p){
 if(!p||p.coverGate)return p;
 p.coverGate=1;
 const at=['paused','blocked'].includes(p.stage)?p.resumeStage:p.stage;
 if(at==='generating-cover'&&p.approvedVideo&&p.package){
  p.stage='covers-review';delete p.resumeStage;delete p.error;delete p.coverIndex;delete p.step;p.covers=initialCovers(p);
  p.events=[...(p.events??[]),{action:'covers-legacy-review',detail:'Produção anterior às capas locais: exporte, compare e aprove uma capa por rede.',at:p.updatedAt??new Date().toISOString()}];
 }
 return p;
}
