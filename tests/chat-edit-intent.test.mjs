import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyEditRequest,parseTimeWindow,videoPathsIn,withTimeWindow} from '../chat-edit-intent.mjs';
import {chatEditStatus,messageVideos} from '../src/features/chat/chatEdits.ts';

const kind=text=>classifyEditRequest(text).kind;

test('only an unequivocal request starts an edit; questions, analysis, negation and quotes never do',()=>{
 for(const text of ['Edite este vídeo','edita esse vídeo com motion','Por favor, edite o vídeo','Editar este vídeo','Quero que você edite essa gravação','Faça a edição desse vídeo','Remova os erros e retomadas','corte as repetições','Edit this video','please edit my recording','Monte o vídeo'])assert.equal(kind(text),'edit',text);
 for(const text of ['Como editar esse vídeo?','Qual a melhor forma de editar?','O que você acha do vídeo?','Analise o vídeo e me diga o que melhorar','Avalie o ritmo deste vídeo','Me dê feedback sobre o corte','How should I edit this video?','What do you think of this cut?'])assert.equal(kind(text),'none',text);
 for(const text of ['Não edite ainda','Não precisa editar, só analise','Don\'t edit it yet','nem mexe no vídeo por enquanto'])assert.equal(kind(text),'none',text);
 for(const text of ['Ele escreveu "edite este vídeo" no roteiro','> edite o vídeo\nisso foi o que o cliente pediu'])assert.equal(kind(text),'none',text);
 assert.equal(kind(''),'none');assert.equal(kind('   '),'none');
 for(const text of ['Pode editar esse vídeo?','Você consegue editar a gravação?','Poderia editar este vídeo, por favor?','Could you edit this video?'])assert.equal(kind(text),'edit',text);
 assert.equal(kind('Esse vídeo precisa de edição'),'ambiguous');
 for(const text of ['Dá para editar esse vídeo?','```text\nEdite este vídeo\n```','Como editar? Edite este vídeo é um exemplo.'])assert.equal(kind(text),'none',text);
});

test('a visual change with a time window of the edited video is an adjustment; timestamps alone are not',()=>{
 assert.deepEqual(classifyEditRequest('Entre 12 e 18 segundos troque a animação por uma comparação'),{kind:'adjust',reason:'window',window:{start:12,end:18}});
 assert.deepEqual(classifyEditRequest('De 0:12 a 0:18 coloque um gráfico de barras').window,{start:12,end:18});
 assert.deepEqual(classifyEditRequest('Between 12s and 18,5s replace the title with a counter').window,{start:12,end:18.5});
 assert.equal(kind('12s-18s mude a cor do título'),'adjust');
 assert.equal(kind('Entre 12 e 18 segundos eu falo do preço'),'none','timestamps without a visual change');
 assert.equal(kind('Pode trocar a animação entre 12 e 18 segundos?'),'adjust');
 assert.equal(kind('Como trocar a animação entre 12 e 18 segundos?'),'none');
 assert.equal(kind('Entre 18 e 12 segundos troque a animação'),'none','an inverted window is not a request');
 assert.equal(parseTimeWindow('sem tempo nenhum'),null);
 assert.equal(withTimeWindow('Entre 12 e 18 segundos troque a animação por uma comparação',{start:10,end:20}),'Entre 10 e 20 segundos: troque a animação por uma comparação');
 assert.equal(kind(withTimeWindow('Entre 12 e 18 segundos troque a animação',{start:10,end:20})),'adjust');
});

test('videos come from attachments and typed absolute paths only, never from file text',()=>{
 assert.deepEqual(videoPathsIn('Edite C:\\Users\\eu\\Videos\\aula 1.mp4 por favor'),[],'an unquoted path with spaces is never guessed');
 assert.deepEqual(videoPathsIn('Edite C:\\Users\\eu\\Videos\\aula-1.mp4 por favor'),['C:\\Users\\eu\\Videos\\aula-1.mp4']);
 assert.deepEqual(videoPathsIn('Edite "C:\\Users\\eu\\Videos\\aula 1.mp4"'),['C:\\Users\\eu\\Videos\\aula 1.mp4']);
 assert.deepEqual(videoPathsIn('arquivo /Users/eu/clip.mov e notas.txt'),['/Users/eu/clip.mov']);
 assert.deepEqual(videoPathsIn('relatório.pdf'),[]);
 const message={content:'Edite',attachments:[{kind:'video',path:'C:\\a\\x.mp4',name:'x.mp4'}],contextNodes:[{nodeId:'n',kind:'file',label:'y.mov',content:'C:\\a\\y.mov'},{nodeId:'m',kind:'note',label:'nota',content:'C:\\a\\z.mp4'}]};
 assert.deepEqual(messageVideos(message).map(item=>item.name),['x.mp4','y.mov'],'a canvas note mentioning a path is not an attachment');
});

test('the chat card shows only real host/run states and the explicit actions of each one',()=>{
 const base={sessionId:'s',messageId:'m'};
 assert.equal(chatEditStatus(undefined,undefined,[],true).tone,'progress');
 assert.match(chatEditStatus({...base,status:'needs-choice'},undefined,[],true).title,/Qual vídeo/);
 assert.match(chatEditStatus({...base,status:'needs-video'},undefined,[],true).detail,/Anexe o vídeo/);
 assert.deepEqual(chatEditStatus({...base,status:'failed',error:'x'},undefined,[],true).actions,['retry']);
 const run={id:'r',stage:'editing',videoJobId:'job',editDirector:{name:'Editor de Vídeo',provider:'claude',choice:'claude'}};
 const editing=chatEditStatus({...base,status:'started',kind:'edit',runId:'r'},run,[{id:'job',status:'running',progress:42.4}],true);
 assert.equal(editing.progress,42);assert.match(editing.detail,/Editor de Vídeo \(Claude Code\)/);assert.deepEqual(editing.actions,['cancel-edit']);
 assert.match(chatEditStatus({...base,status:'started',kind:'edit'},{...run,stage:'blocked',error:'Claude sem login'},[],true).detail,/sem login/);
 const adjust={...base,status:'started',kind:'adjust',adjustId:'a1',window:{start:12,end:18},runId:'r'};
 assert.deepEqual(chatEditStatus(adjust,{...run,stage:'planning-edit',localAdjust:{id:'a1',status:'planning',window:{start:12,end:18}}},[],true).actions,['cancel-adjust']);
 const applied={...run,stage:'video-review',outputVideo:{sha256:'b'},localAdjustments:[{id:'a1',status:'applied',window:{start:12,end:18},output:{sha256:'b'},proof:{sameAudio:true}}]};
 const done=chatEditStatus(adjust,applied,[],true);assert.match(done.title,/12,0–18,0 s/);assert.deepEqual(done.actions,['revert']);
 assert.deepEqual(chatEditStatus(adjust,{...applied,outputVideo:{sha256:'other'}},[],true).actions,[],'undo only while that version is the one under review');
});
