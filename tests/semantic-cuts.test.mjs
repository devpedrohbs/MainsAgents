import test from 'node:test';
import assert from 'node:assert/strict';
import {chatEditFixture,fullEditScript} from './chat-edit-fixture.mjs';
import {mergeProductionSessions} from '../src/features/production/model.ts';

/**
 * Semantic cuts on the REAL host path, from the transcription's word timings to the delivered message. Simulated: the
 * transcriber returns fixed words (a known speech with a restart and a corrected number), the model is a script (its
 * decisions here are written by the test, so nothing about the quality of a real model's decision is claimed), and the
 * motion renderer is the FFmpeg stub. Real: candidate detection + cache, MCP context, decision validation against the
 * written cuts, the retained-speech fact proof, the export and the message the person reads.
 */
const speech=text=>{let t=0.1;const words=[];for(const token of text.split(' ')){if(token.startsWith('|')){t+=Number(token.slice(1));continue;}words.push({start:Math.round(t*100)/100,end:Math.round((t+0.2)*100)/100,text:token});t+=0.25;}return words;};
const words=speech('hoje eu vou |0.3 hoje eu vou mostrar |0.3 custa 30 reais |0.2 não 13 reais');
const transcriber={capabilities:async()=>({available:true}),transcribe:async()=>({engine:'whisper.cpp',model:'ggml-base',language:'pt',segments:[{start:0.1,end:4.1,text:'hoje eu vou hoje eu vou mostrar custa 30 reais não 13 reais'}],speech:[{start:0.1,end:4.1}],words})};

test('retakes and a corrected number: evidence reaches Claude, its decisions must match the cuts, a cut-out number cannot be shown',{timeout:240000},async()=>{
 const f=await chatEditFixture({transcriber});try{
  f.chat('chat','editor-de-video-1');const seen={};
  const counter=value=>out=>({version:1,title:'Preço',timeline:{basis:'output'},style:{treatment:'creator'},scenes:[{id:'abre',name:'Abre',start:0,end:1.5,camera:{layout:'full'},layers:[{id:'t',type:'text',text:'Como editar',role:'title',slot:'top',start:0.1,end:1.3,source:'design'}]},{id:'preco',name:'Preço',start:1.5,end:out,camera:{layout:'full'},layers:[{id:'n',type:'counter',value,label:'reais',slot:'center',start:0.1,end:1.2,source:'speech'}]}]});
  let plan;
  f.scripts.push(async call=>{
   const script=fullEditScript(f.log,{
    before:async(call2,context)=>{
     seen.retakes=context.retakes;seen.words=(await call2('get_transcript_words',{start:0,end:6})).structuredContent;
     const [repeat,correction]=context.retakes.candidates;
     plan={segments:[{start:repeat.remove.end,end:correction.remove.start},{start:correction.remove.end,end:context.metadata.duration}],decisions:[{candidateId:repeat.id,start:repeat.remove.start,end:repeat.remove.end,decision:'cut',reason:'primeira tomada interrompida; a segunda é completa'},{candidateId:correction.id,start:correction.remove.start,end:correction.remove.end,decision:'cut',reason:'30 foi corrigido para 13 na mesma frase'}]};
     const lie=await call2('write_plan',{baseRevision:0,plan:{segments:[{start:0,end:context.metadata.duration}],storyboard:counter(13)(context.metadata.duration)},cutDecisions:plan.decisions});seen.lie=lie.content[0].text;
     const out=plan.segments.reduce((sum,item)=>sum+item.end-item.start,0);
     const wrongFact=await call2('write_plan',{baseRevision:0,plan:{segments:plan.segments,storyboard:counter(30)(out)},cutDecisions:plan.decisions});seen.wrongFact=wrongFact.content[0].text;
    }});
   // Segments/decisions are computed in `before` from the candidates the host handed over.
   return script(async(name,args)=>name==='write_plan'&&plan&&!args.cutDecisions?call('write_plan',{...args,plan:{segments:plan.segments,storyboard:counter(13)(plan.segments.reduce((sum,item)=>sum+item.end-item.start,0))},cutDecisions:plan.decisions}):call(name,args));
  });
  const view=await f.admit('chat',f.say('chat','Edite este vídeo e remova os erros e retomadas',[f.input]));
  const p=await f.delivered(view.runId);
  // Evidence handed to the editor: real words, approximate timings, the restart and the correction (never a decision).
  assert.match(seen.retakes.note,/Evidence only.*Decide by meaning/);
  assert.deepEqual(seen.retakes.candidates.map(item=>[item.kind,item.suggestion]),[['false-start','cut'],['correction','cut']]);
  assert.equal(seen.retakes.candidates[0].evidence.removed,'hoje eu vou');assert.match(seen.retakes.candidates[0].evidence.kept,/^hoje eu vou mostrar/);
  assert.deepEqual(seen.retakes.candidates[1].evidence.numbers,[30,13]);assert.equal(seen.words.timing,'words');
  assert.match(seen.lie,/declared as cut, but the segments keep/);
  assert.match(seen.wrongFact,/número 30 não aparece na fala/,'30 survives only in the cut take: not a source for the screen');
  // Cached per source + transcription + detector version.
  assert.equal(p.retakes.version,1);assert.equal(p.retakes.candidates.length,2);assert.match(p.events.find(event=>event.action==='retake-candidates').detail,/2 candidato/);
  assert.deepEqual(p.editPlan.cutDecisions.map(item=>item.decision),['cut','cut']);
  const shown=mergeProductionSessions(f.sessions.map(item=>({...item})),f.runs(),f.agents).find(item=>item.id==='chat');
  const delivery=shown.messages.find(item=>item.receipts?.length);
  assert.match(delivery.content,/Cortes de retomada\/erro \(decisão do editor\): .*primeira tomada interrompida.*30 foi corrigido para 13/s);
 }finally{await f.close();}
});

test('a contrastive denial is kept and flagged; a low-confidence candidate the editor did not decide is listed to check, never hidden',{timeout:240000},async()=>{
 const local=speech('não são 30 são 13 pessoas |0.5 nunca |0.5 nunca desista');
 const f=await chatEditFixture({transcriber:{...transcriber,transcribe:async()=>({engine:'whisper.cpp',language:'pt',segments:[{start:0.1,end:3.5,text:'não são 30 são 13 pessoas nunca nunca desista'}],speech:[{start:0.1,end:3.5}],words:local})}});try{
  f.chat('chat','editor-de-video-1');const seen={};
  f.scripts.push(fullEditScript(f.log,{before:async(call,context)=>{seen.retakes=context.retakes.candidates;},storyboard:out=>({version:1,timeline:{basis:'output'},style:{treatment:'creator'},scenes:[{id:'n',name:'Número',start:0,end:out,camera:{layout:'full'},layers:[{id:'c',type:'counter',value:30,label:'pessoas',slot:'center',start:0.1,end:1.2,source:'speech'}]}]})}));
  const p=await f.delivered((await f.admit('chat',f.say('chat','Edite este vídeo',[f.input]))).runId);
  assert.deepEqual(seen.retakes.map(item=>[item.kind,item.suggestion]),[['negated-number','keep'],['false-start','review']]);
  const write=f.log.find(item=>item.tool==='write_plan').result;assert.match(write.warnings.join(' '),/30 is DENIED in the speech.*show it only as the denied value/);
  assert.equal(p.editPlan.reviewPoints.length,1);assert.match(p.editPlan.reviewPoints[0].text,/possível falso começo mantida/);
  const delivery=p.editorSession.messages.find(item=>item.receipts?.length);assert.match(delivery.content,/Pontos para você conferir \(tempos aproximados da gravação\): .*falso começo/);
 }finally{await f.close();}
});
