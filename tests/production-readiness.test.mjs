import test from 'node:test';
import assert from 'node:assert/strict';
import {claudeRow,codexRow,mcpRows,mediaRow} from '../src/features/chat/runtimeDiagnosticsView.ts';
import {productionReadiness} from '../src/features/chat/productionReadiness.ts';

const at='2026-10-08T12:00:00.000Z';
const diag=(extra={})=>({checkedAt:at,runtime:'running',account:'authenticated',modelCheck:'completed',models:[{id:'m',name:'M'}],discovery:'completed',servers:[],agents:[{id:'a1',name:'Editor'}],...extra});
const media=(extra={})=>({ffmpeg:true,ffprobe:true,transcribe:true,animate:true,...extra});
const rows=({codex=diag(),claude={state:'connected',mcp:'approval-gated'},m=media(),checked=true}={})=>[codexRow(codex,'',true),claudeRow(checked?claude:null,true),...(codex?mcpRows(codex,true,'pt-BR'):[]),mediaRow(checked?m:null,checked,true)];
const byId=view=>Object.fromEntries(view.items.map(item=>[item.id,item]));

test('nothing is ready before a manual check',()=>{
 const view=productionReadiness([codexRow(null,'',true),claudeRow(null,true),mediaRow(null,false,true)],true);
 assert.ok(view.items.every(item=>item.state==='unchecked'));
 assert.match(view.summary,/Nada verificado/);
 assert.equal(view.allChecked,false);
});

test('local tools report real reasons and never invent ready',()=>{
 const view=productionReadiness(rows({m:media({ffmpeg:false,transcribe:false,transcribeReasons:['modelo ausente'],animate:false,animateReasons:['navegador não encontrado']})}),true),items=byId(view);
 assert.equal(items.ffmpeg.state,'blocked');assert.equal(items.whisper.state,'blocked');assert.equal(items.remotion.state,'blocked');
 assert.match(items.whisper.next,/modelo ausente/);assert.match(items.remotion.next,/navegador não encontrado/);
 assert.match(view.summary,/1 item\(ns\) obrigatório/,'only FFmpeg is required');
});

test('a media answer without Whisper/Remotion fields is unchecked for them, not ready',()=>{
 const items=byId(productionReadiness(rows({m:{ffmpeg:true,ffprobe:true}}),true));
 assert.equal(items.ffmpeg.state,'ready');assert.equal(items.whisper.state,'unchecked');assert.equal(items.remotion.state,'unchecked');
});

test('provider: login required blocks, one ready provider is enough, unknown login is not proven',()=>{
 assert.equal(byId(productionReadiness(rows({codex:diag({account:'login-required'}),claude:{state:'login-required'}}),true)).provider.state,'blocked');
 assert.equal(byId(productionReadiness(rows({codex:diag({account:'login-required'})}),true)).provider.state,'ready');
 const unknown=byId(productionReadiness(rows({codex:diag({account:'unknown'}),claude:{state:'check-failed'}}),true)).provider;
 assert.equal(unknown.state,'unverified');assert.ok(unknown.next);
});

test('integrations: catalog without a real read is not proven; a receipt makes it ready; absence is explained',()=>{
 const servers=[{name:'zernio',status:'discovered',tools:['accounts_list']}];
 assert.equal(byId(productionReadiness(rows({codex:diag({servers})}),true)).integrations.state,'unverified');
 const proven=[{name:'zernio',status:'discovered',tools:['accounts_list'],readEvidence:[{checkedAt:at,tool:'accounts_list',agentId:'a1'}]}];
 assert.equal(byId(productionReadiness(rows({codex:diag({servers:proven})}),true)).integrations.state,'ready');
 const missing=byId(productionReadiness(rows(),true)).integrations;
 assert.equal(missing.state,'unverified');assert.match(missing.detail,/Nenhum provedor de publicação/);
 const login=byId(productionReadiness(rows({codex:diag({servers:[{name:'publora',status:'login-required',tools:[]}]})}),true)).integrations;
 assert.equal(login.state,'blocked');assert.match(login.next,/login/i);
});

test('optional gaps never block the summary; everything proven says ready; English labels',()=>{
 const proven=[{name:'zernio',status:'discovered',tools:['accounts_list'],readEvidence:[{checkedAt:at,tool:'accounts_list',agentId:'a1'}]}];
 const good=productionReadiness(rows({codex:diag({servers:proven})}),true);
 assert.equal(byId(good).notion.optional,true);
 assert.equal(byId(good).notion.state,'unchecked');
 assert.equal(good.allChecked,false);
 assert.match(good.summary,/Nenhum bloqueio verificado/);
 const fullyChecked=productionReadiness([...rows({codex:diag({servers:proven})}),{kind:'mcp',title:'Notion',level:'ready',levelLabel:'Pronto',facts:[]}],true);
 assert.equal(fullyChecked.allChecked,true);
 assert.match(fullyChecked.summary,/Tudo verificado está pronto/);
 const optionalOnly=productionReadiness(rows({codex:diag({servers:proven}),m:media({animate:false})}),true);
 assert.doesNotMatch(optionalOnly.summary,/bloqueiam/);
 const en=productionReadiness([codexRow(diag(),'',false),claudeRow({state:'connected'},false),mediaRow(media(),true,false)],false);
 assert.equal(en.items.find(i=>i.id==='ffmpeg').stateLabel,'Ready');assert.equal(en.items.find(i=>i.id==='whisper').title,'Transcription (Whisper)');
});
