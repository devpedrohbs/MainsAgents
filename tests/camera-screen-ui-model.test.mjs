import test from 'node:test';
import assert from 'node:assert/strict';
import {chatEditStatus,pairLine,offsetText} from '../src/features/chat/chatEdits.ts';
import {providerWaitText,providerGateNotice} from '../src/features/production/providerWait.ts';
import {resumeMode} from '../src/features/production/editorExecutions.ts';

/** Renderer models of the chat card and the production dialog: they only present host facts (never invent a reset time or "synchronized"). */
const wait={providerId:'claude',label:'Claude Code',kind:'rate-limit',since:'2026-10-16T12:00:00.000Z',resetsAt:null,generation:3,sent:true,stage:'planning-edit',done:['Transcrição local guardada'],remaining:['Exportação final']};
const run=extra=>({id:'r',stage:'blocked',resumeStage:'planning-edit',blockReason:'provider-limit',providerWait:wait,...extra});

test('provider wait: unknown reset says unknown; a reported reset is shown as the provider\'s; Resume is the action', () => {
 const text=providerWaitText(wait,true);assert.match(text.reset,/desconhecido \(o provedor não informou\)/);assert.match(text.how,/Nada é reenviado sozinho/);
 assert.match(providerWaitText({...wait,resetsAt:'2026-10-16T15:00:00.000Z'},true).reset,/Liberação informada pelo provedor/);
 const status=chatEditStatus({sessionId:'s',messageId:'m',kind:'edit',status:'started',runId:'r'},run(),[],true);
 assert.equal(status.tone,'attention');assert.match(status.title,/Aguardando limite de uso do Claude Code/);assert.deepEqual(status.actions,['resume','cancel-edit']);
 assert.equal(resumeMode(run()),'provider-wait');assert.equal(resumeMode(run({blockReason:undefined,providerWait:undefined,authoring:{lastStop:{code:'editor_turn_limit',continuable:true}}})),'checkpoint');
 assert.match(providerGateNotice(wait,true),/edições automáticas ficam guardadas até você usar Retomar/);
});

test('pair card: measuring, needs-sync reasons, and the pair line never says synchronized for a manual offset', () => {
 const base={sessionId:'s',messageId:'m',kind:'edit',pair:{camera:{name:'cam.mp4'},screen:{name:'tela.mkv'},voice:'camera',layout:'camera-corner'}};
 assert.deepEqual(chatEditStatus({...base,status:'measuring'},undefined,[],true).actions,['cancel-measure']);
 const drift=chatEditStatus({...base,status:'needs-sync',sync:{status:'drift',text:'O atraso muda ao longo da gravação (deriva).'}},undefined,[],true);
 assert.equal(drift.title,'O atraso muda ao longo da gravação');assert.match(drift.detail,/marcado como não verificado/);
 assert.equal(chatEditStatus({...base,status:'needs-sync',sync:{status:'no-common-audio'}},undefined,[],true).title,'Sem áudio comum para medir o atraso');
 assert.match(pairLine({...base,status:'started',sync:{status:'manual',offsetSeconds:-1.7}},undefined,true),/Câmera: cam\.mp4 · Tela: tela\.mkv · voz: câmera · câmera no canto · A tela começa 1,70 s antes da câmera\. \(manual, não verificado pelo app\)/);
 assert.match(pairLine({...base,status:'started'},{sourcePair:{offsetSeconds:2.39,voice:'screen',layout:'alternate',hash:'h',sync:{origin:'measured',verified:true}}},true),/voz: tela .*A tela começa 2,39 s depois da câmera\. \(medido no áudio comum\)/);
 assert.equal(offsetText(0,true),'Câmera e tela começam juntas.');assert.equal(pairLine({sessionId:'s',messageId:'m',status:'started'},undefined,true),'');
});
