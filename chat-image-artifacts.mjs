import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,realpathSync,lstatSync,renameSync,unlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';

const MAX_BYTES=32*1024*1024;
export const imageGenerationInstructions=`For image creation or editing, always use the native OpenAI image_gen/image_generation tool and its most capable available image model. Generate the image, not only a prompt or a description. Never substitute a text model, HTML, SVG, a stock image or a separately billed API. The native CLI controls its image model; do not claim a specific version or quality setting unless the tool actually exposes and confirms it. MainsAgents displays successful native image results automatically. If the tool is unavailable or fails, state the actual limitation rather than claiming an image was generated.`;

export function isImageGenerationItem(item){
  return item?.type==='imageGeneration'||item?.kind==='image_gen.generation';
}

function decodeImage(result){
  if(typeof result!=='string'||!result)throw new Error('The image tool returned no image.');
  const encoded=result.replace(/^data:image\/(?:png|jpeg|webp);base64,/,'').trim();
  if(encoded.length>Math.ceil(MAX_BYTES/3)*4||!(/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)))throw new Error('Invalid or oversized generated image.');
  const bytes=Buffer.from(encoded,'base64');
  if(bytes.length>MAX_BYTES)throw new Error('Generated image exceeds 32 MB.');
  let extension,mimeType;
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){extension='png';mimeType='image/png';}
  else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255){extension='jpg';mimeType='image/jpeg';}
  else if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'){extension='webp';mimeType='image/webp';}
  else throw new Error('The tool output is not a supported raster image.');
  return {bytes,extension,mimeType};
}

/** Durable, content-addressed media. Never reads a path supplied by a model. */
export function createChatImageArtifacts(directory){
  mkdirSync(directory,{recursive:true});
  const root=realpathSync(directory);
  function fileFor(name){
    if(!/^[a-f0-9]{64}\.(?:png|jpg|webp)$/.test(name))throw new Error('Invalid image identifier.');
    const path=join(root,name);
    const stat=lstatSync(path);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||dirname(realpathSync(path))!==root)throw new Error('Invalid image artifact.');
    return path;
  }
  return {
    pathForImage(image){const match=String(image?.url??'').match(/^\/api\/codex\/images\/([a-f0-9]{64}\.(?:png|jpg|webp))$/);if(!match)throw Error('Imagem gerada sem origem verificável.');const path=fileFor(match[1]);if(createHash('sha256').update(readFileSync(path)).digest('hex')!==match[1].split('.')[0])throw Error('A imagem gerada foi alterada no disco.');return path;},
    fromItem(item,executionId){
      if(!isImageGenerationItem(item))return null;
      if(item.status!=='completed'){
        if(['failed','error'].includes(item.status)||item.failure)return {type:'image.failed',executionId,callId:item.id,message:item.failure?.type==='usageLimitExceeded'?'Image generation limit reached. Try again after your image allowance resets.':'The image tool could not generate the image.'};
        return null;
      }
      try{
        if(item.failure)throw new Error('The image tool failed.');
        const {bytes,extension,mimeType}=decodeImage(item.result);
        const hash=createHash('sha256').update(bytes).digest('hex'),name=`${hash}.${extension}`;
        let alreadySaved=false;
        try{alreadySaved=readFileSync(fileFor(name)).equals(bytes);}catch(error){if(error.code!=='ENOENT')throw error;}
        if(!alreadySaved){
          const temporary=join(root,`.${randomUUID()}.tmp`);
          try{writeFileSync(temporary,bytes,{flag:'wx',mode:0o600,flush:true});renameSync(temporary,join(root,name));}
          finally{try{unlinkSync(temporary);}catch{/* Successful atomic rename removed the temporary file. */}}
        }
        return {type:'image.completed',executionId,image:{id:item.id,url:`/api/codex/images/${name}`,mimeType,filename:`mainsagents-${hash.slice(0,12)}.${extension}`,alt:'Generated image',prompt:typeof item.revisedPrompt==='string'?item.revisedPrompt:undefined}};
      }catch(error){return {type:'image.failed',executionId,callId:item.id,message:`Could not save the generated image: ${error.message}`};}
    },
    read(name){const path=fileFor(name);const {bytes,mimeType}=decodeImage(readFileSync(path).toString('base64'));return {bytes,mimeType};},
    handle(request,response,url){
      const match=url.pathname.match(/^\/api\/codex\/images\/([a-f0-9]{64}\.(?:png|jpg|webp))$/);
      if(request.method!=='GET'||!match)return false;
      try{const {bytes,mimeType}=this.read(match[1]);response.writeHead(200,{'content-type':mimeType,'content-length':bytes.length,'cache-control':'private, max-age=31536000, immutable','x-content-type-options':'nosniff','content-disposition':`inline; filename="mainsagents-${match[1].slice(0,12)}.${match[1].split('.').at(-1)}"`});response.end(bytes);}
      catch{response.writeHead(404,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify({error:'Generated image not found.'}));}
      return true;
    },
  };
}
