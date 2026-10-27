import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultMascot,isAgentMascot,randomMascot} from '../src/features/agents/mascot.ts';
import {agentDraftValuesProblem} from '../src/features/agents/agentDrafts.ts';

test('agents without a chosen look get a stable mascot whose object follows the role',()=>{
 assert.deepEqual(defaultMascot({name:'Roteirista',role:'Roteiro'}),defaultMascot({name:'Roteirista',role:'Roteiro'}));
 assert.equal(defaultMascot({name:'A',role:'Editor de vídeo'}).prop,'clapper');
 assert.equal(defaultMascot({name:'A',role:'Designer de capa'}).prop,'brush');
 assert.equal(defaultMascot({name:'A',role:'Publicador'}).prop,'megaphone');
 assert.equal(defaultMascot({name:'A',role:'Pesquisa'}).prop,'baton');
 assert.ok(isAgentMascot(defaultMascot({name:'Qualquer'})));
 for(let i=0;i<20;i++)assert.ok(isAgentMascot(randomMascot()));
});

test('saved looks and drafts accept only known shapes, objects, eyes and #rrggbb colours',()=>{
 const look={shape:'robot',color:'#f472b6',prop:'megaphone',mood:'happy'};
 assert.ok(isAgentMascot(look));
 for(const bad of [{...look,shape:'star'},{...look,color:'pink'},{...look,prop:'sword'},{...look,mood:'angry'},{...look,extra:1},null,[]])assert.equal(isAgentMascot(bad),false);
 assert.equal(agentDraftValuesProblem({avatarMascot:look}),undefined);
 assert.match(agentDraftValuesProblem({avatarMascot:{...look,color:'url(x)'}}),/avatarMascot/);
});
