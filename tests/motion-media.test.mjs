import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {runMediaProcess} from '../editorial-media.mjs';
import {inspectLocalAsset} from '../editorial-local-files.mjs';

const inspect=path=>inspectLocalAsset(path,{stabilityMs:0});
// Fala SINTÉTICA (tons harmônicos): palavras normais a 120 Hz; "tudo" (4,0–4,6 s) mais forte e aguda após pausa de 1,6 s.
const words=[['isso',1,1.4],['vai',1.5,1.9],['mudar',2,2.4],['tudo',4,4.6],['na',4.7,5.1],['sua',5.2,5.6],['rotina',5.7,6.3]];
const voice=words.map(([text,a,b])=>{const [amp,f0]=text==='tudo'?[0.5,180]:[0.15,120];return `between(t,${a},${b})*${amp}*(sin(2*PI*${f0}*t)+0.5*sin(4*PI*${f0}*t))`;}).join('+');
async function fixture({audio=true,animate}={}){
  const root=mkdtempSync(join(tmpdir(),'motion-media-')),dbPath=join(root,'state.sqlite'),input=join(root,'original.mp4');
  await runMediaProcess('ffmpeg',['-nostdin','-v','error','-n','-f','lavfi','-i','testsrc2=size=96x54:rate=25',...(audio?['-f','lavfi','-i',`aevalsrc='${voice}':s=48000`]:[]),'-t','8','-c:v','libx264','-pix_fmt','yuv420p',...(audio?['-c:a','aac']:[]),input]);
  const file=await inspect(input),at=new Date().toISOString();let transcribed=0;
  const transcriber={capabilities:async()=>({available:true}),transcribe:async()=>{transcribed++;return {engine:'whisper.cpp',model:'ggml-base',language:'pt',segments:[{start:1,end:2.4,text:'isso vai mudar'},{start:4,end:6.3,text:'tudo na sua rotina'}],words:words.map(([text,start,end])=>({start,end,text}))};}};
  const bridge=createContentWorkflowBridge({dbPath,getCurrentProfile:()=>'owner',mediaOptions:{inspect,transcriber,animate,animationCapabilities:async()=>({available:true})}});
  const db=new DatabaseSync(dbPath);
  db.prepare('INSERT INTO editorial_state VALUES (?,?,?,?)').run('owner',1,JSON.stringify({schemaVersion:1,topics:[{id:'topic',workspaceId:'space'}],contents:[{id:'content',workspaceId:'space',topicId:'topic',title:'Synthetic'}],runs:[],artifacts:[],approvals:[],assets:[{id:'source',workspaceId:'space',contentId:'content',role:'source',kind:'video',name:'original.mp4',versions:[{id:'v1',path:file.path,name:file.name,size:file.size,sha256:file.sha256,modifiedAt:file.modifiedAt,createdAt:at}],currentVersionId:'v1',status:'available',checkedAt:at,createdAt:at,updatedAt:at}],publications:[]}),at);
  const ref={contentId:'content',assetId:'source',versionId:'v1',sha256:file.sha256};
  return {bridge,db,ref,transcribed:()=>transcribed,close:async()=>{await bridge.close();db.close();}};
}

test('motion da mídia: ênfase MEDIDA no áudio vira aproximação no tempo editado; cortes remapeiam; exportação entrega o motion ao Remotion',async()=>{
  let received;const animate=async input=>{received=input;await copyFile(input.inputPath,input.outputPath);};
  const f=await fixture({animate});try{
    const segments=[{start:0,end:2.6},{start:3.8,end:8}];
    const {motion,summary}=await f.bridge.media.motion('owner',{...f.ref,segments,intensity:'balanced'});
    assert.equal(f.transcribed(),1);
    assert.equal(motion.analysis.voice,'measured');assert.equal(motion.analysis.wordTiming,'words');assert.deepEqual(motion.analysis.limitations,[]);
    const cue=motion.cues.find(item=>Math.abs(item.sourceStart-3.92)<0.05);
    assert(cue,JSON.stringify(motion.cues));assert.equal(cue.kind,'punchIn');assert.equal(cue.source,'measured');
    assert.deepEqual(cue.signals.map(item=>item.kind).sort(),['loudness','pauseBefore','pitch']);
    assert.ok(cue.signals.find(item=>item.kind==='loudness').value>=6);
    assert.equal(cue.start,Math.round((3.92-1.2)*1000)/1000,'1,2 s removidos antes da palavra');
    assert.match(summary,/aproxima/);
    // A mesma âncora com outro corte: o tempo editado acompanha.
    const preview=await f.bridge.media.plan('owner',{...f.ref,plan:{segments:[{start:0,end:2.4},{start:3.6,end:8}],motion}});
    assert.equal(preview.plan.motion.cues.find(item=>item.id===cue.id).start,Math.round((3.92-1.2)*1000)/1000);
    const shifted=await f.bridge.media.plan('owner',{...f.ref,plan:{segments:[{start:0,end:1},{start:3.6,end:8}],motion}});
    assert.equal(shifted.plan.motion.cues.find(item=>item.id===cue.id).start,Math.round((3.92-2.6)*1000)/1000);
    const revision=f.db.prepare('SELECT revision FROM editorial_state').get().revision;
    const job=f.bridge.media.enqueue('owner',{mode:'advanced',authorize:true,revision,requestKey:'motion-one',...f.ref,plan:preview.plan,planHash:preview.planHash}).job;
    const end=Date.now()+30000;while(Date.now()<end&&!['succeeded','failed'].includes(f.bridge.media.list('owner').find(item=>item.id===job.id).status))await new Promise(r=>setTimeout(r,50));
    const done=f.bridge.media.list('owner').find(item=>item.id===job.id);assert.equal(done.status,'succeeded',done.error);
    assert.equal(received.animations.motion.cues.length,preview.plan.motion.cues.length,'motion sem título/tarja/CTA também passa pelo Remotion');
    assert.deepEqual(received.animations.motion,preview.plan.motion);
    // Plano adulterado (texto em aproximação) não passa da validação.
    await assert.rejects(()=>f.bridge.media.plan('owner',{...f.ref,plan:{segments,motion:{...motion,cues:[{...cue,text:'oi'}]}}}),/plain text/);
    await assert.rejects(()=>f.bridge.media.motion('owner',{...f.ref,segments,intensity:'max'}),/subtle, balanced, intense/);
  }finally{await f.close();}
});

test('sem áudio: o plano declara que a voz não foi medida e não inventa ênfase',async()=>{
  const f=await fixture({audio:false});try{
    const {motion}=await f.bridge.media.motion('owner',{...f.ref,segments:[{start:0,end:8}],intensity:'intense'});
    assert.equal(motion.analysis.voice,'unavailable');assert.ok(motion.analysis.limitations.includes('voiceUnavailable'));assert.ok(motion.analysis.limitations.includes('transcriptUnavailable'));
    assert.equal(motion.cues.length,0);assert.equal(f.transcribed(),0,'sem áudio não há o que transcrever');
  }finally{await f.close();}
});
