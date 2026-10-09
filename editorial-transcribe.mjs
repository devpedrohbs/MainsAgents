import {createHash} from 'node:crypto';
import {createReadStream,existsSync} from 'node:fs';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runMediaProcess} from './editorial-media.mjs';

/** Official whisper.cpp ggml models accepted for local transcription (sha256 of the file). */
export const whisperModels=Object.freeze({
  '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe':'ggml-base',
});
export const whisperLanguages=Object.freeze(['auto','pt','en','es','fr','de','it']);
const maxSegments=5000;

/** Finds whisper-cli and a model in explicit, env or project tool directories. Never downloads. */
export function resolveWhisper({directories=[],cli,model}={}){
  const roots=[...directories,process.env.MAINSAGENTS_WHISPER_DIR,join(process.cwd(),'.mainsagents-workspaces','tooling','whispercpp')].filter(Boolean);
  for(const root of roots){
    const binary=cli??['bin/Release/whisper-cli.exe','Release/whisper-cli.exe','whisper-cli.exe','bin/whisper-cli','whisper-cli'].map(item=>join(root,item)).find(existsSync);
    const weights=model??['ggml-base.bin'].map(item=>join(root,item)).find(existsSync);
    if(binary&&weights)return {cli:binary,model:weights,root};
  }
  return cli&&model?{cli,model}:null;
}

const sha256=path=>new Promise((resolve,reject)=>{const hash=createHash('sha256');createReadStream(path).on('data',chunk=>hash.update(chunk)).on('error',reject).on('end',()=>resolve(hash.digest('hex')));});
// Whisper writes these markers for music/noise/silence; they are not speech and must not drive edits.
const nonSpeech=/^[\s[\](){}*♪♫.,!?-]*$|^\s*[[(].{0,40}[\])]\s*$/;

const ms=value=>Math.round(value)/1000;
/** Word tokens (letters/digits, not punctuation or [_special_] markers) of a full whisper.cpp JSON segment. */
const wordTokens=item=>(Array.isArray(item?.tokens)?item.tokens:[]).filter(token=>/[\p{L}\p{N}]/u.test(String(token?.text??''))&&!/^\s*\[_/.test(String(token.text))&&Number.isFinite(Number(token?.offsets?.from))&&Number.isFinite(Number(token?.offsets?.to)));

const maxWords=30000;
/**
 * Whole words with their own timestamps (whisper.cpp tokens are sub-word pieces: a piece that starts with a space opens a
 * new word, the others extend it). Used by the motion plan; punctuation stays attached so emphasis marks are kept.
 */
function spokenWords(item){
  const result=[],tokens=Array.isArray(item?.tokens)?item.tokens:[];
  // With -dtw every token carries t_dtw (10 ms units): aligned by cross-attention, far closer to the audio around pauses
  // than the default offsets, which drift up to ~1.5 s early after a pause. Words then start at their first token's DTW time.
  const dtw=tokens.some(token=>Number(token?.t_dtw)>=0);
  for(const token of tokens){
    const text=String(token?.text??''),aligned=Number(token?.t_dtw)*10,from=dtw&&aligned>=0?aligned:Number(token?.offsets?.from),to=dtw&&aligned>=0?aligned+50:Number(token?.offsets?.to);
    if(/^\s*\[_/.test(text)||!Number.isFinite(from)||!Number.isFinite(to))continue;
    const last=result.at(-1);
    if(!last||/^\s/.test(text)){if(/[\p{L}\p{N}]/u.test(text))result.push({start:ms(from),end:Math.max(ms(from)+0.05,ms(to)),text:text.trim()});}
    else{last.text+=text.trim();if(/[\p{L}\p{N}]/u.test(text))last.end=Math.max(last.end,ms(to));}
  }
  const words=result.filter(word=>word.text&&!nonSpeech.test(word.text));
  // DTW gives one instant per token: a word lasts until the next word starts (at most 0.9 s, never past the segment).
  if(dtw){const end=ms(Number(item?.offsets?.to));words.forEach((word,index)=>{const next=words[index+1]?.start??Math.max(word.start+0.2,end);word.end=Math.max(word.start+0.08,Math.min(next,word.start+0.9));});}
  return words.map(word=>({start:Math.round(word.start*1000)/1000,end:Math.round(word.end*1000)/1000,text:word.text.slice(0,40)}));
}
/**
 * Sentence segments for captions plus merged speech spans from word tokens. Whisper sentence timestamps run across
 * pauses (each sentence ends where the next starts), so bounds are tightened to the first/last spoken word when tokens exist.
 */
export function parseWhisperJson(raw,duration){
  const data=typeof raw==='string'?JSON.parse(raw):raw,list=Array.isArray(data?.transcription)?data.transcription:[];
  const segments=[],spans=[],wordList=[];
  for(const item of list){
    let start=Number(item?.offsets?.from)/1000,end=Number(item?.offsets?.to)/1000;const text=String(item?.text??'').replace(/\s+/g,' ').trim();
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||start>=duration||!text||nonSpeech.test(text))continue;
    const words=wordTokens(item);
    if(words.length){start=Math.max(start,ms(Number(words[0].offsets.from)));end=Math.min(end,ms(Math.max(...words.map(token=>Number(token.offsets.to))))+0.15);
      for(const token of words){const from=ms(Number(token.offsets.from)),to=Math.max(from+0.05,ms(Number(token.offsets.to))),last=spans.at(-1);if(last&&from-last.end<=0.3)last.end=Math.max(last.end,to);else spans.push({start:from,end:to});}
      for(const word of spokenWords(item))if(word.start<duration&&wordList.length<maxWords)wordList.push({...word,end:Math.min(word.end,duration)});}
    if(end<=start)continue;
    segments.push({start:Math.round(start*1000)/1000,end:Math.round(Math.min(end,duration)*1000)/1000,text:text.slice(0,500)});
    if(segments.length>=maxSegments)break;
  }
  segments.sort((a,b)=>a.start-b.start);spans.sort((a,b)=>a.start-b.start);
  wordList.sort((a,b)=>a.start-b.start);
  return {language:typeof data?.result?.language==='string'?data.result.language.slice(0,12):undefined,segments,words:wordList,speech:spans.filter(item=>item.start<duration).slice(0,20000).map(item=>({start:Math.round(item.start*1000)/1000,end:Math.round(Math.min(item.end,duration)*1000)/1000}))};
}

/** Local speech-to-text with whisper.cpp. Audio is extracted to a private temp WAV; nothing leaves the machine. */
export function createWhisperTranscriber({cli,model,directories,ffmpeg='ffmpeg',run=runMediaProcess,threads=4}={}){
  let resolved,verified;
  const locate=()=>resolved??=resolveWhisper({directories,cli,model});
  const check=async()=>{
    const found=locate();if(!found)return {available:false,reasons:['whisper-cli e o modelo ggml não foram encontrados. Coloque-os em .mainsagents-workspaces/tooling/whispercpp ou defina MAINSAGENTS_WHISPER_DIR.']};
    try{
      verified??=sha256(found.model).then(hash=>({hash,name:whisperModels[hash]}));const {hash,name}=await verified;
      if(!name){verified=undefined;return {available:false,reasons:[`Modelo não reconhecido (sha256 ${hash.slice(0,12)}…). Use um modelo oficial do whisper.cpp.`]};}
      await stat(found.cli);return {available:true,reasons:[],model:name,modelSha256:hash};
    }catch(error){verified=undefined;return {available:false,reasons:[error.message]};}
  };
  return {
    capabilities:check,
    async transcribe({inputPath,duration,language='pt',signal}){
      if(!whisperLanguages.includes(language))throw new Error('Unsupported transcription language.');
      if(!Number.isFinite(duration)||duration<=0||duration>3600)throw new Error('Local transcription accepts videos up to one hour.');
      const ready=await check();if(!ready.available)throw new Error(`Local transcription unavailable: ${ready.reasons.join(' ')}`);
      const found=locate(),folder=await mkdtemp(join(tmpdir(),'mainsagents-whisper-'));
      try{
        const wav=join(folder,'audio.wav'),out=join(folder,'transcript');
        await run(ffmpeg,['-nostdin','-hide_banner','-v','error','-n','-protocol_whitelist','file,pipe','-i',inputPath,'-map','0:a:0','-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',wav],{signal,timeoutMs:600000});
        // -dtw: token-level timestamps aligned to the audio (preset of the verified official model).
        await run(found.cli,['-m',found.model,'-f',wav,'-l',language,'-ojf','-of',out,'-np','-ml','80','-sow','-t',String(threads),...(ready.model==='ggml-base'?['-dtw','base']:[])],{signal,timeoutMs:Math.max(600000,duration*4000)});
        const parsed=parseWhisperJson(await readFile(`${out}.json`,'utf8'),duration);
        return {origin:'local-whisper',engine:'whisper.cpp',model:ready.model,modelSha256:ready.modelSha256,language:parsed.language??language,segments:parsed.segments,speech:parsed.speech,words:parsed.words};
      }finally{await rm(folder,{recursive:true,force:true});}
    },
  };
}
