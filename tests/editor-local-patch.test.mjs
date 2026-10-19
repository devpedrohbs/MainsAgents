import test from 'node:test';
import assert from 'node:assert/strict';
import {validateWindow,patchWindowInfo,localPatchProblems,crossingMessage} from '../editor-local-patch.mjs';
import {validateStoryboard,segmentsHash} from '../editorial-storyboard.mjs';

const segments=[{start:0.5,end:20.5}];
const scene=(id,start,end,extra={})=>({id,name:id,start,end,camera:{layout:'full'},background:{kind:'none',tone:'bg'},layers:[{id:`${id}-t`,type:'text',text:`Texto ${id}`,role:'title',slot:'top',start:0.1,end:Math.min(1.5,end-start-0.1),source:'design'}],...extra});
const storyboard=scenes=>validateStoryboard({version:1,timeline:{basis:'output',segmentsHash:segmentsHash(segments)},style:{treatment:'creator'},scenes,sfx:[{kind:'pop',at:1}]},{outputDuration:20,segments});
const plan=scenes=>({segments,animations:[],format:'original',normalizeAudio:true,theme:'dark',storyboard:storyboard(scenes)});
const base=plan([scene('abre',0,4),scene('meio',4,10),scene('dados',12,18),scene('fim',18,20)]);
const opts={fps:30,outputDuration:20};

test('the window is validated on the edited timeline; nothing is clamped silently',()=>{
 assert.deepEqual(validateWindow({start:12,end:18},20),{start:12,end:18});
 assert.throws(()=>validateWindow({start:18,end:12},20),/depois do início/);
 assert.throws(()=>validateWindow({start:15,end:25},20),/tem 20,0s.*passa do fim/);
 assert.throws(()=>validateWindow({start:21,end:22},20),/começa depois do fim/);
 assert.throws(()=>validateWindow({start:1,end:1.2},20),/ao menos/);
 assert.throws(()=>validateWindow({start:0,end:90},120),/até 60s/);
 assert.throws(()=>validateWindow({start:18,end:20.01},20),/passa do fim/);
 assert.deepEqual(validateWindow({start:12.001,end:18.009},20),{start:12.001,end:18.009},'no silent rounding');
});

test('a window that cuts a scene in half is refused with the exact supported intervals (expand or shrink), never widened',()=>{
 const info=patchWindowInfo(base,{start:8,end:16},opts);
 assert.deepEqual(info.crossing.map(item=>[item.id,item.edge]),[['meio','start'],['dados','end']]);
 assert.deepEqual(info.options.map(item=>[item.kind,item.start,item.end]),[['expand',4,18],['shrink',10,12]]);
 assert.match(crossingMessage(info),/corta ao meio a cena “meio” \(4,0–10,0 s\), “dados” \(12,0–18,0 s\).*Ajustar 4,0–18,0 s.*ou Ajustar só 10,0–12,0 s.*Nada foi alterado/);
 const one=patchWindowInfo(base,{start:11,end:15},opts);assert.deepEqual(one.options.map(item=>[item.kind,item.start,item.end]),[['expand',11,18],['shrink',11,12]]);
 const shrink=patchWindowInfo(base,{start:2,end:12},opts);assert.deepEqual(shrink.options.map(item=>[item.kind,item.start,item.end]),[['expand',0,12],['shrink',4,12]]);
 const clean=patchWindowInfo(base,{start:12,end:18},opts);assert.deepEqual(clean.crossing,[]);assert.deepEqual(clean.inside.map(item=>item.id),['dados']);
 const fractional=patchWindowInfo(base,{start:12.001,end:18},opts);assert.deepEqual(fractional.crossing.map(item=>item.id),['dados'],'frame rounding cannot silently expand the requested interval');
});

test('only scenes inside the window may change; cuts, audio, SFX, style and every outside scene stay identical',()=>{
 const window={start:12,end:18};
 const compare=plan([scene('abre',0,4),scene('meio',4,10),{...scene('dados',12,18),layers:[{id:'cmp',type:'compare',slot:'center',start:0.2,end:5,before:{label:'Antes',text:'manual'},after:{label:'Depois',text:'com app'},source:'design'}]},scene('fim',18,20)]);
 const okay=localPatchProblems(base,compare,window,opts);assert.deepEqual(okay.errors,[]);assert.deepEqual(okay.changedScenes,['dados']);assert.equal(okay.proof.outsideScenesCompared,3);
 // New scenes may be added inside the window (the empty 10-12 gap is outside: refused).
 assert.deepEqual(localPatchProblems(base,plan([scene('abre',0,4),scene('meio',4,10),scene('dados',12,15),scene('extra',15,18),scene('fim',18,20)]),window,opts).errors,[]);
 assert.match(localPatchProblems(base,plan([scene('abre',0,4),scene('meio',4,10),scene('novo',10.5,11.5),scene('dados',12,18),scene('fim',18,20)]),window,opts).errors[0],/sai do trecho/);
 // Outside changes are refused with the scene and its bounds.
 const outside=plan([scene('abre',0,4),{...scene('meio',4,10),layers:[]},scene('dados',12,18),scene('fim',18,20)]);
 assert.match(localPatchProblems(base,outside,window,opts).errors[0],/A cena “meio” \(4.00–10.00s\) aparece fora do trecho e mudou/);
 // Cuts, audio and SFX are frozen.
 assert.match(localPatchProblems(base,{...compare,segments:[{start:0.5,end:19.5}]},window,opts).errors[0],/cortes não podem mudar/);
 assert.match(localPatchProblems(base,{...compare,normalizeAudio:false},window,opts).errors[0],/áudio não pode mudar/);
 assert.match(localPatchProblems(base,{...compare,storyboard:{...compare.storyboard,sfx:[]}},window,opts).errors[0],/efeitos sonoros/);
 assert.match(localPatchProblems(base,base,window,opts).errors[0],/Nada mudou dentro do trecho/);
});

test('the camera a neighbour scene inherits counts as outside: a layout change at the border is refused with the reason',()=>{
 const joined=plan([scene('abre',0,4),scene('meio',4,12),scene('dados',12,18),scene('fim',18,20)]);
 const split=plan([scene('abre',0,4),scene('meio',4,12),{...scene('dados',12,18),camera:{layout:'split-left'}},scene('fim',18,20)]);
 const result=localPatchProblems(joined,split,{start:12,end:18},opts);
 assert.match(result.errors.join(' '),/“fim”.*(enquadramento|ligação)/);
});
