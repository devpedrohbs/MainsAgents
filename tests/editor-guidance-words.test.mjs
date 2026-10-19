import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {APP_GUIDE_NAME,GUIDANCE_LIMITS,loadEditorGuidance} from '../editor-guidance.mjs';
import {createEditorHost,hostTranscript} from '../editor-host.mjs';
import {createEditorAuthoring,EDITOR_LIMITS} from '../editor-authoring.mjs';

function skillsFolder(){
 const root=mkdtempSync(join(tmpdir(),'editor-guidance-')),skills=join(root,'skills'),outside=join(root,'outside');
 mkdirSync(join(skills,'edicao'),{recursive:true});mkdirSync(outside);
 writeFileSync(join(skills,'edicao','SKILL.md'),'# Edição\nUse acento laranja. Veja https://exemplo.com/guia e C:/Users/criador/marca.png.');
 writeFileSync(join(skills,'contexto.md'),'# Contexto\nVoz direta.');
 writeFileSync(join(skills,'desligada.md'),'# Desligada\nNÃO deve aparecer.');
 writeFileSync(join(skills,'notas.txt'),'texto');
 writeFileSync(join(skills,'grande.md'),`# Grande\n${'á'.repeat(20_000)}`);
 writeFileSync(join(outside,'fora.md'),'# Fora\nNÃO deve aparecer.');
 const agent={skillsDirectory:skills,skills:['edicao','contexto','desligada','fora','notas','grande','ausente'],disabledSkills:['desligada'],
  skillFiles:{edicao:join(skills,'edicao','SKILL.md'),contexto:join(skills,'contexto.md'),desligada:join(skills,'desligada.md'),fora:join(outside,'fora.md'),notas:join(skills,'notas.txt'),grande:join(skills,'grande.md'),ausente:join(skills,'ausente.md')}};
 return {root,skills,agent};
}

test('guidance: app guide first, only enabled .md skills inside the configured folder, bounded, URLs/paths in text kept as text',()=>{
 const {agent}=skillsFolder(),g=loadEditorGuidance(agent);
 assert.deepEqual(g.items.map(item=>item.name),[APP_GUIDE_NAME,'edicao','contexto','grande']);
 assert.equal(g.items[0].origin,'app-guide');assert.ok(g.items.slice(1).every(item=>item.origin==='agent-skill'));
 assert.match(g.items[1].text,/https:\/\/exemplo\.com\/guia/,'a legitimate URL in a guide is reference text, not refused');
 const skipped=Object.fromEntries(g.skipped.map(item=>[item.name,item.reason]));
 assert.ok(!('desligada' in skipped)&&!g.items.some(item=>item.name==='desligada'),'disabled skills are never read');
 assert.match(skipped.fora,/fora da pasta/);assert.match(skipped.notas,/\.md/);assert.match(skipped.ausente,/não encontrado/);
 const big=g.items.find(item=>item.name==='grande');assert.equal(big.truncated,true);assert.ok(Buffer.byteLength(big.text)<=GUIDANCE_LIMITS.maxFileBytes);assert.ok(!big.text.includes('\uFFFD'));
 assert.ok(g.items.reduce((sum,item)=>sum+Buffer.byteLength(item.text),0)<=GUIDANCE_LIMITS.maxTotalBytes);
 assert.doesNotMatch(JSON.stringify(g),/editor-guidance-|[\\/]skills[\\/]/,'no skill file path in the payload');
 assert.equal(loadEditorGuidance(agent).hash,g.hash,'same files, same guidance hash');
 assert.deepEqual(loadEditorGuidance({}).items.map(item=>item.name),[APP_GUIDE_NAME]);
});

test('host transcript keeps only real word timings and never estimates them',()=>{
 const sentences=hostTranscript([{start:0,end:2,text:'Olá mundo'}]);
 assert.equal(sentences.timing,'sentences');assert.deepEqual(sentences.words,[]);
 const heard=hostTranscript({origin:'local-whisper',engine:'whisper.cpp',model:'ggml-base',language:'pt',segments:[{start:0,end:2,text:'Olá mundo'}],words:[{start:0.9,end:1.4,text:'mundo'},{start:0.1,end:0.5,text:' Olá '},{start:1,end:1,text:'zero'},{start:'x',end:2,text:'bad'}]});
 assert.equal(heard.timing,'words');assert.deepEqual(heard.words.map(word=>word.text),['Olá','mundo']);assert.equal(heard.engine,'whisper.cpp');
});

/** Host with the media calls stubbed (no render): enough for get_context and get_transcript_words. */
function hostFor(runId,transcript,guidance){
 const binding={runId,epoch:1,profileId:'owner',workspaceId:'space',agentId:'editor',contentId:`content-${runId}`,authorityHash:`auth-${runId}`,source:{assetId:`asset-${runId}`,versionId:'v1',sha256:(runId==='a'?'a':'b').repeat(64)}};
 const media={authoring:async(_profile,input)=>{assert.equal(input.contentId,`content-${runId}`);return {metadata:{duration:60,width:1080,height:1920,fps:30,hasAudio:true},outputDuration:60,assets:[]};}};
 const host=createEditorHost({profile:'owner',binding,read:()=>({epoch:1}),update:()=>{},guard:()=>{},media,ref:{contentId:`content-${runId}`},base:{segments:[{start:0,end:60}],format:'portrait'},brief:'Briefing.',transcript,guidance,planSchema:{type:'object'},finalExport:async()=>({}),exportStatus:async()=>({})});
 return {binding,host,grant:{scope:'edit-local',authorityHash:binding.authorityHash}};
}
const words=count=>Array.from({length:count},(_,i)=>({start:i*0.25,end:i*0.25+0.2,text:`p${i}`}));

test('MCP: get_context carries guidance and transcript info; get_transcript_words returns real words by window with explicit truncation',async()=>{
 const {agent}=skillsFolder(),guidance=loadEditorGuidance(agent),authoring=createEditorAuthoring();
 const a=hostFor('a',{origin:'local-whisper',engine:'whisper.cpp',model:'ggml-base',language:'pt',segments:[{start:0,end:240,text:'fala longa'}],words:words(960)},guidance);
 const {sessionId}=authoring.open(a),token=authoring.attach(sessionId,'exec-a');
 const context=(await authoring.call(token,'get_context')).structuredContent;
 assert.equal(context.transcriptInfo.timing,'words');assert.equal(context.transcriptInfo.words,960);assert.equal(context.transcriptInfo.wordTool,'get_transcript_words');assert.equal(context.transcriptInfo.engine,'whisper.cpp');
 assert.deepEqual(context.guidance.items.map(item=>item.name),guidance.items.map(item=>item.name));assert.match(context.guidance.note,/no tools or permissions/);
 assert.ok(context.guidance.skipped.some(item=>item.name==='fora'));
 const first=await authoring.call(token,'get_transcript_words',{start:0,end:240});
 assert.notEqual(first.isError,true);const s=first.structuredContent;
 assert.equal(s.timeline,'source');assert.equal(s.count,EDITOR_LIMITS.maxWordsPerCall);assert.equal(s.truncated,true);assert.equal(s.nextStart,words(960)[EDITOR_LIMITS.maxWordsPerCall].start);
 assert.match(first.content[0].text,/^800 word\(s\).*Truncated: continue with start 200 and offset 0\./s);assert.match(first.content[0].text,/\n0\.00 0\.20 p0\n/);
 const rest=(await authoring.call(token,'get_transcript_words',{start:s.nextStart,end:240})).structuredContent;
 assert.equal(rest.count,160);assert.equal(rest.truncated,false);assert.match(rest.lines,/^200\.00 200\.20 p800/);
 const window=(await authoring.call(token,'get_transcript_words',{start:10,end:1000})).structuredContent;
 assert.deepEqual(window.window,{start:10,end:10+EDITOR_LIMITS.maxWordWindowSeconds});
 assert.equal((await authoring.call(token,'get_transcript_words',{start:5,end:2})).structuredContent.code,'invalid_input');
 assert.ok(authoring.checkpoint(sessionId).actions.some(item=>item.tool==='get_transcript_words'));
});

test('MCP: without word timings nothing is estimated; each session only reads its own content',async()=>{
 const authoring=createEditorAuthoring();
 const a=hostFor('a',{segments:[{start:0,end:2,text:'só frases'}]},undefined),b=hostFor('b',{segments:[{start:0,end:2,text:'outro conteúdo'}],words:[{start:0,end:0.4,text:'segredo'}]},undefined);
 const ta=authoring.attach(authoring.open(a).sessionId,'exec-a'),tb=authoring.attach(authoring.open(b).sessionId,'exec-b');
 const context=(await authoring.call(ta,'get_context')).structuredContent;
 assert.equal(context.transcriptInfo.timing,'sentences');assert.equal(context.transcriptInfo.wordTool,null);assert.equal(context.guidance,undefined);
 const none=await authoring.call(ta,'get_transcript_words',{start:0,end:60});
 assert.equal(none.structuredContent.timing,'sentences');assert.equal(none.structuredContent.count,0);assert.equal(none.structuredContent.lines,'');assert.match(none.content[0].text,/nothing is estimated/);
 assert.doesNotMatch(JSON.stringify(none),/segredo/);
 assert.match((await authoring.call(tb,'get_transcript_words',{start:0,end:60})).structuredContent.lines,/segredo/);
 assert.equal((await authoring.call('forged','get_transcript_words',{start:0,end:1})).structuredContent.code,'unbound');
});

test('guidance byte limits are exact, marker included, in the loader and again in the MCP payload',async()=>{
 const {agent}=skillsFolder(),limits={maxFileBytes:300,maxTotalBytes:450,maxFiles:8,maxReadBytes:1_000_000};
 const g=loadEditorGuidance(agent,{limits});
 assert.ok(g.items.every(item=>Buffer.byteLength(item.text)<=300));assert.ok(g.items.reduce((sum,item)=>sum+Buffer.byteLength(item.text),0)<=450);
 assert.ok(g.skipped.some(item=>/limite total/.test(item.reason)),'what no longer fits is skipped, not cut to a bare marker');
 const many={items:Array.from({length:12},(_,i)=>({name:`skill-${i}`,origin:'agent-skill',text:`# ${i}\n${'x'.repeat(16_000)}`})),skipped:[]};
 const authoring=createEditorAuthoring(),a=hostFor('a',{segments:[]},many),token=authoring.attach(authoring.open(a).sessionId,'exec');
 const guidance=(await authoring.call(token,'get_context')).structuredContent.guidance;
 assert.ok(guidance.items.reduce((sum,item)=>sum+Buffer.byteLength(item.text),0)<=EDITOR_LIMITS.maxGuidanceBytes);
 assert.equal(guidance.items.length+guidance.skipped.length,12);assert.ok(guidance.skipped.every(item=>item.reason==='guidance byte limit'));
});

test('long recording: paging get_transcript_words over the whole source returns every word exactly once (overlaps and equal starts included)',async()=>{
 // 1 200 s, ~4 900 words: far beyond the 24k-char sentence transcript of get_context. Overlapping ends and equal starts on purpose.
 const all=[];for(let t=0,i=0;t<1200;i++){all.push({start:Math.round(t*1000)/1000,end:Math.round((t+0.45)*1000)/1000,text:`w${i}`});if(i%7===0)all.push({start:Math.round(t*1000)/1000,end:Math.round((t+0.2)*1000)/1000,text:`eq${i}`});t+=i%5===0?0.3:0.21;}
 const authoring=createEditorAuthoring(),a=hostFor('a',{segments:[{start:0,end:1200,text:'fala'}],words:all},undefined),token=authoring.attach(authoring.open(a).sessionId,'exec');
 const seen=[];let start=0,calls=0;
 let offset=0;
 while(start!==null&&start!==undefined&&calls<40){const r=(await authoring.call(token,'get_transcript_words',{start,end:1200,offset})).structuredContent;assert.equal(r.ok,true,JSON.stringify(r));calls++;offset=r.nextOffset??0;if(r.lines)seen.push(...r.lines.split('\n').map(line=>line.split(' ')[2]));start=r.nextStart??null;}
 assert.ok(calls>EDITOR_LIMITS.maxWordsPerCall/1000+4,'several pages were needed');
 assert.equal(seen.length,all.length);assert.deepEqual(new Set(seen),new Set(all.map(word=>word.text)));
});

test('an equal-start group larger than a page is paged with an explicit offset: never repeated, never skipped, never looping',async()=>{
 const limit=EDITOR_LIMITS.maxWordsPerCall,group=limit*2+3,all=[];
 all.push({start:4.9,end:5.6,text:'antes'});
 for(let i=0;i<group;i++)all.push({start:5,end:5.2+(i%3)*0.4,text:`g${i}`});
 for(let i=0;i<40;i++)all.push({start:5+i*0.05,end:6+i*0.05,text:`o${i}`}); // overlapping, one more at start 5
 for(let i=0;i<30;i++)all.push({start:400+i,end:400.5+i,text:`late${i}`}); // past the 300 s window of a call
 const authoring=createEditorAuthoring(),a=hostFor('a',{segments:[{start:0,end:500,text:'fala'}],words:all},undefined),token=authoring.attach(authoring.open(a).sessionId,'exec');
 const seen=[],pages=[];let start=0,offset=0;
 for(let calls=0;start!==null&&calls<20;calls++){
  const r=(await authoring.call(token,'get_transcript_words',{start,end:500,offset})).structuredContent;assert.equal(r.ok,true,JSON.stringify(r));
  assert.ok(r.count<=limit);pages.push([start,offset,r.count]);if(r.lines)seen.push(...r.lines.split('\n').map(line=>line.split(' ')[2]));
  start=r.nextStart??null;offset=r.nextOffset??0;
 }
 assert.equal(start,null,`paging ended: ${JSON.stringify(pages)}`);
 assert.equal(seen.length,all.length);assert.deepEqual([...seen].sort(),all.map(word=>word.text).sort());
 assert.deepEqual(pages.slice(0,3).map(([s,o])=>[s,o]),[[0,0],[5,limit-1],[5,limit*2-1]],'the equal-start group is continued by offset, not restarted');
 const bad=await authoring.call(token,'get_transcript_words',{start:5,end:10,offset:group+50});
 assert.equal(bad.structuredContent.code,'invalid_input');
 assert.equal((await authoring.call(token,'get_transcript_words',{start:0,end:1,offset:-1})).structuredContent.code,'invalid_input');
});
