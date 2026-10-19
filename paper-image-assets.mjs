import {createHash} from 'node:crypto';
import {readFileSync,realpathSync,lstatSync,existsSync} from 'node:fs';
import {join,dirname,extname,isAbsolute,normalize,relative} from 'node:path';

/**
 * Native GPT images in Paper. Paper loads a local image only from `paper-asset:///<absolute path>` (its documented
 * write_html scheme), so a generated background travels as a bounded file reference, never as base64 or an app URL.
 * The host vouches only for images it saved itself from a native image result (sha256 content-addressed copy), and
 * records Paper exports only from the export tool's actual result.
 */
const MAX_IMAGE_BYTES=32*1024*1024;
const imageExtensions=new Set(['.png','.jpg','.jpeg','.webp']);
export const paperGeneratedLayerName='Fundo gerado (GPT)';

/** `paper-asset:///C:/dir/file.png` for an absolute local path; URI-reserved characters are percent-encoded. */
export function paperAssetUrl(path){
 if(typeof path!=='string'||!isAbsolute(path)||/[\0\r\n]/.test(path))throw Error('A Paper asset needs an absolute local path.');
 const slashed=normalize(path).replace(/\\/g,'/');
 return `paper-asset://${slashed.startsWith('/')?'':'/'}${slashed.split('/').map(part=>/^[A-Za-z]:$/.test(part)?part:encodeURIComponent(part)).join('/')}`;
}

const codePoint=(code,radix)=>{const value=Number.parseInt(code,radix);return Number.isInteger(value)&&value>0&&value<=0x10ffff?String.fromCodePoint(value):' ';};
// Same unescaping as the paper-gen:// check, so an encoded spelling cannot hide a reference.
const unescape=text=>text.replace(/\\u([0-9a-f]{4})/gi,(_,hex)=>codePoint(hex,16)).replace(/\\([0-9a-f]{1,6})\s?/gi,(_,hex)=>codePoint(hex,16)).replace(/&#(x?)([0-9a-f]+);?/gi,(_,x,code)=>codePoint(code,x?16:10));
const strings=(value,out=[],depth=0)=>{if(depth>20)return out;if(typeof value==='string')out.push(value);else if(value&&typeof value==='object')for(const item of Object.values(value))strings(item,out,depth+1);return out;};
const pathFromReference=reference=>{
 let decoded;try{decoded=decodeURIComponent(reference);}catch{return null;}
 decoded=decoded.replace(/\\/g,'/');
 if(/^\/[A-Za-z]:\//.test(decoded))decoded=decoded.slice(1);
 return isAbsolute(decoded)&&!/[\0\r\n]/.test(decoded)?normalize(decoded):null;
};

/**
 * Every local file a Paper call references through paper-asset://, decoded. `complete` is false when a mention of the
 * scheme could not be parsed into an absolute path; a policy must then treat the call as unverified.
 */
export function paperAssetReferences(args){
 const paths=[];let mentions=0;
 for(const raw of strings(args)){
  let text=unescape(raw);
  try{text=text.replace(/%([0-9a-f]{2})/gi,(match,hex)=>/^(?:3a|2f)$/i.test(hex)?String.fromCharCode(Number.parseInt(hex,16)):match);}catch{/* Keep the raw text. */}
  mentions+=(text.match(/paper[^a-z0-9]{0,3}asset/gi)??[]).length;
  for(const match of text.matchAll(/paper-asset:\/\/((?:\/|[A-Za-z]:)[^"'()\s<>]*)/gi)){const path=pathFromReference(match[1]);if(path)paths.push(path);}
 }
 return {paths:[...new Set(paths)],complete:paths.length>=mentions||mentions===0&&paths.length===0};
}

const within=(root,path)=>{const child=relative(root,path);return child&&!child.startsWith('..')&&!isAbsolute(child);};
const realDirectory=path=>{try{return existsSync(path)?realpathSync(path):null;}catch{return null;}};

/**
 * Generated images the host can vouch for: its own content-addressed copy (`<sha256>.<ext>` in imagesDirectory) or a
 * file the native image tool saved under a generated-images root whose bytes match such a copy. Synchronous so an
 * approval policy can call it; reads at most 32 MB per file.
 */
export function createVerifiedImageIndex({imagesDirectory,generatedRoots=[]}={}){
 const roots=()=>({images:imagesDirectory?realDirectory(imagesDirectory):null,generated:generatedRoots.map(realDirectory).filter(Boolean)});
 function verify(path){
  try{
   if(typeof path!=='string'||!isAbsolute(path))return {ok:false,reason:'Not an absolute local path.'};
   const {images,generated}=roots();if(!images)return {ok:false,reason:'The generated image library is unavailable.'};
   const extension=extname(path).toLowerCase();if(!imageExtensions.has(extension))return {ok:false,reason:'Only PNG, JPEG or WebP generated images are accepted.'};
   const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_IMAGE_BYTES)return {ok:false,reason:'Not a regular image file within the size limit.'};
   const real=realpathSync(path),bytes=readFileSync(real),sha256=createHash('sha256').update(bytes).digest('hex');
   const stored=['.png','.jpg','.webp'].map(ext=>join(images,`${sha256}${ext}`)).find(candidate=>existsSync(candidate));
   if(!stored)return {ok:false,reason:'This file is not an image the host saved from a native image result.'};
   if(dirname(real)===images)return real===realpathSync(stored)?{ok:true,path:real,sha256,hostPath:stored}:{ok:false,reason:'The host image name does not match its contents.'};
   if(!generated.some(root=>within(root,real)))return {ok:false,reason:'Generated images are referenced only from the host library or the native tool output folder.'};
   return readFileSync(stored).equals(bytes)?{ok:true,path:real,sha256,hostPath:stored}:{ok:false,reason:'The generated image differs from the host copy.'};
  }catch(error){return {ok:false,reason:error.code==='ENOENT'?'The generated image file no longer exists.':'The generated image could not be verified.'};}
 }
 /** All references in a Paper call must be verified generated images; anything else needs the person's review. */
 function check(args){
  const {paths,complete}=paperAssetReferences(args);
  if(!complete)return {ok:false,paths,reason:'A paper-asset reference could not be read.'};
  const results=paths.map(verify),failed=results.find(result=>!result.ok);
  return failed?{ok:false,paths,reason:failed.reason}:{ok:true,paths,images:results};
 }
 return {verify,check};
}

const exportExtensions=new Set(['.png','.jpg','.jpeg','.webp','.avif','.pdf','.svg']);
const controlCharacter=text=>[...text].some(character=>character.charCodeAt(0)<32);
const resultTexts=result=>{const content=typeof result==='string'?[{type:'text',text:result}]:Array.isArray(result?.content)?result.content:Array.isArray(result)?result:typeof result?.content==='string'?[{type:'text',text:result.content}]:[];return content.filter(item=>item?.type==='text'&&typeof item.text==='string').map(item=>item.text);};
/**
 * Files an actual Paper export result reports. Paper answers `{"exports":[{"nodeId","filePath"}]}` (verified with Paper
 * Desktop on 2026-10-13); only those structured entries count, never free text or a model message.
 */
export function paperExportFiles(result){
 const files=[];
 for(const text of resultTexts(result)){
  let parsed;try{parsed=JSON.parse(text);}catch{continue;}
  for(const entry of Array.isArray(parsed?.exports)?parsed.exports:[]){
   const path=typeof entry?.filePath==='string'?entry.filePath:'';
   if(typeof entry?.nodeId!=='string'||!entry.nodeId||entry.nodeId.length>200||!isAbsolute(path)||controlCharacter(path)||!exportExtensions.has(extname(path).toLowerCase()))continue;
   files.push({nodeId:entry.nodeId,path:normalize(path)});
  }
 }
 return files;
}

/**
 * Host ledger for generated images and Paper exports, kept as delivery receipts (path + size + sha256 inspected by
 * the host). Scheduling reads ordered, re-verifiable exports from here instead of trusting a final model message.
 */
export function createPaperAssetLedger({receipts,getCurrentProfile,index}={}){
 const sameProfile=binding=>!!binding&&(!getCurrentProfile||getCurrentProfile()===binding.profileId);
 const scope=binding=>({sessionId:binding.sessionId,workspaceId:binding.workspaceId,...(binding.session?.contentId?{contentId:binding.session.contentId}:{})});
 const producer=binding=>({agentName:binding.agentName,providerId:binding.agent?.providerId??binding.providerId,...(binding.agent?.modelId?{modelId:binding.agent.modelId}:{})});
 return {
  index,
  /** A native image the host already saved (content-addressed). Returns the receipt, or null without a session. */
  async recordGeneratedImage({binding,callId,path}){
   if(!receipts||!sameProfile(binding)||typeof callId!=='string'||!callId)return null;
   const verified=index?.verify(path);if(index&&!verified?.ok)throw Error(verified?.reason??'Unverified generated image.');
   return receipts.issue(binding.profileId,{source:{kind:'generated-image',id:callId.slice(0,200)},...scope(binding),path:verified?.hostPath??path,...(verified?{expectedSha256:verified.sha256}:{}),label:'Imagem nativa gerada (Codex)',producedBy:producer(binding)});
  },
  /**
   * The actual result of one successful Paper export call in the agent's selected file. Order follows the call's own
   * `nodes` keys (the order the agent asked for); a file for a node the call did not request is ignored.
   */
  async captureExport({binding,callId,arguments:args,result}){
   if(!receipts||!sameProfile(binding)||typeof callId!=='string'||!callId||result?.isError)return [];
   const fileId=binding.agent?.paperDesign?.fileId;
   if(!fileId||args?.fileId!==fileId||!args.nodes||typeof args.nodes!=='object'||Array.isArray(args.nodes))return [];
   const order=Object.keys(args.nodes);
   const files=paperExportFiles(result).filter(file=>order.includes(file.nodeId)).map((file,position)=>({...file,position})).sort((a,b)=>order.indexOf(a.nodeId)-order.indexOf(b.nodeId)||a.position-b.position);
   const issued=[];
   for(const [position,file] of files.entries())issued.push(await receipts.issue(binding.profileId,{source:{kind:'paper-export',id:callId.slice(0,200),step:String(position+1)},...scope(binding),path:file.path,assetId:file.nodeId,versionId:fileId,label:`Paper ${position+1}/${files.length}`,producedBy:producer(binding)}));
   return issued;
  },
  /** Latest verified Paper export of a session, in export order; older export calls stay in `previous`. */
  exports(profile,{sessionId}={}){
   if(!receipts||typeof sessionId!=='string'||!sessionId)return {latest:null,previous:[]};
   const batches=new Map();
   for(const receipt of receipts.list(profile,{sessionId}).filter(item=>item.source.kind==='paper-export')){const list=batches.get(receipt.source.id)??[];list.push(receipt);batches.set(receipt.source.id,list);}
   const ordered=[...batches.entries()].map(([callId,files])=>({callId,fileId:files[0]?.versionId,createdAt:files.reduce((latest,item)=>item.createdAt>latest?item.createdAt:latest,''),files:files.sort((a,b)=>Number(a.source.step)-Number(b.source.step))})).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
   return {latest:ordered[0]??null,previous:ordered.slice(1)};
  },
 };
}

/** Prompt block for a Codex session of an agent with Paper enabled: native images go to Paper as a file layer. */
export function paperImageInstructions(agent){
 const value=agent?.paperDesign;
 if((agent?.providerId??'codex')!=='codex'||!value||value.enabled!==true||!value.fileId)return '';
 return `\n\nNative images in Paper (this Codex session): when the user asks for generated backgrounds or images for a carousel, generate each one with the native image tool (included in the user's ChatGPT plan; never paper-gen://, fal or a paid API). The tool reports where it saved each file ("Generated images are saved to ... as <path>"). Insert that exact saved file into the target Paper artboard as its own bottom layer with write_html mode "insert-children": <img layer-name="${paperGeneratedLayerName}" src="paper-asset:///<that absolute path with forward slashes>" style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover">. Keep every text element a separate editable text layer above it, so the background stays replaceable. Never send base64, data: URIs or app URLs to Paper, and never invent or guess a path: if the tool returned no saved file or failed, say so and continue with typography. Inspect a screenshot after inserting it and keep text contrast legible.`;
}
