import test from 'node:test';
import assert from 'node:assert/strict';
import {claudeRow,codexRow,diagnosticsSummary,mcpRows,mediaRow} from '../src/features/chat/runtimeDiagnosticsView.ts';

const at='2026-10-06T12:00:00.000Z';
const diag=(extra={})=>({checkedAt:at,runtime:'running',account:'authenticated',modelCheck:'completed',models:[{id:'m',name:'M'}],discovery:'completed',servers:[],agents:[{id:'a1',name:'Editor'}],...extra});
const facts=row=>Object.fromEntries(row.facts.map(fact=>[fact.label,fact.state]));

test('before any manual check every row says not checked yet',()=>{
 const rows=[codexRow(null,'',true),claudeRow(null,true),mediaRow(null,false,true)];
 assert.ok(rows.every(row=>row.level==='unchecked'&&row.levelLabel==='Ainda não verificado'));
 assert.match(diagnosticsSummary(rows,true),/Nada verificado ainda/);
 assert.equal(facts(claudeRow(null,true)).MCP,'restricted');
});

test('missing Claude CLI and missing login give the existing install/login commands',()=>{
 const missing=claudeRow({state:'not-installed',installCommand:'irm https://claude.ai/install.ps1 | iex'},true);
 assert.equal(missing.level,'attention');assert.equal(facts(missing)['Instalação'],'no');
 assert.equal(missing.next.command,'irm https://claude.ai/install.ps1 | iex');
 const login=claudeRow({state:'login-required',loginCommand:'claude auth login'},false);
 assert.deepEqual([facts(login).Installation,facts(login).Login],['yes','no']);assert.equal(login.next.command,'claude auth login');
 const connected=claudeRow({state:'connected'},false);
 assert.equal(connected.level,'restricted');assert.equal(connected.next,undefined);assert.equal(facts(connected).MCP,'restricted');
 const gated=claudeRow({state:'connected',mcp:'approval-gated',mcpServers:[{name:'paper',status:'connected'},{name:'claude.ai Notion',status:'login-required'}]},true);
 assert.equal(facts(gated).MCP,'yes');assert.equal(gated.level,'attention');assert.match(gated.next.text,/claude\.ai Notion/);assert.equal(gated.tools.length,2);
 assert.equal(claudeRow({state:'connected',mcp:'approval-gated',mcpServers:[{name:'paper',status:'connected'}]},true).level,'ready');
 assert.equal(claudeRow({},true).facts[0].state,'unknown'); // malformed response is not treated as installed
});

test('Codex login, failed check and fetch errors point to the existing connection buttons',()=>{
 assert.match(codexRow(diag({account:'login-required'}),'',true).next.text,/Entrar/);
 assert.match(codexRow(diag({account:'check-failed'}),'',false).next.text,/Check again/);
 assert.match(codexRow(diag({discovery:'failed'}),'',true).next.text,/Reconectar/);
 const down=codexRow(null,'CLI unavailable',true);assert.equal(down.level,'attention');assert.equal(down.facts[0].state,'no');
 assert.equal(codexRow(diag(),'',true).level,'ready');
});

test('catalog discovery is never presented as verified access',()=>{
 const [paper,zernio]=mcpRows(diag({servers:[{name:'paper',status:'discovered',tools:['get_screenshot']},{name:'zernio',status:'discovered',tools:['accounts_list']}]}),true,'pt-BR');
 assert.equal(paper.level,'unverified');assert.equal(facts(paper)['Catálogo'],'yes');assert.equal(facts(paper)['Leitura real'],'unchecked');
 assert.match(paper.next.text,/não comprova acesso/);
 assert.match(zernio.next.text,/Preparar teste de leitura/);
});

test('a read receipt marks the server ready with date and agent',()=>{
 const [row]=mcpRows(diag({servers:[{name:'publora',status:'discovered',tools:['list_connections'],readEvidence:[{checkedAt:at,tool:'list_connections',agentId:'a1'}]}]}),false,'en-US');
 assert.equal(row.level,'ready');assert.equal(facts(row)['Actual read'],'yes');assert.equal(row.next,undefined);
 assert.equal(row.receipts[0].agent,'Editor');
});

test('MCP errors are separated: disabled, login, failed start, empty and undiscovered',()=>{
 const rows=mcpRows(diag({discovery:'failed',servers:['disabled','login-required','unavailable','empty','not-discovered'].map(status=>({name:`s-${status}`,status,tools:[]}))}),true,'pt-BR');
 assert.ok(rows.every(row=>row.level==='attention'&&row.next));
 assert.equal(rows[1].next.command,'codex mcp login s-login-required');
 assert.equal(facts(rows[3])['Conexão'],'yes');assert.equal(facts(rows[3])['Catálogo'],'no');
 assert.equal(facts(rows[4])['Conexão'],'unknown');
 assert.match(diagnosticsSummary(rows,true),/5 precisa/);
});

test('media row distinguishes unchecked, failed check and missing tools',()=>{
 assert.equal(mediaRow({ffmpeg:true,ffprobe:true},true,true).level,'ready');
 assert.equal(mediaRow({ffmpeg:true,ffprobe:false},true,true).level,'attention');
 assert.equal(mediaRow(null,true,true).facts[0].state,'unknown');
});
