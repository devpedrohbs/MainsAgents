import test from 'node:test';
import assert from 'node:assert/strict';
import {captionsFromWords} from '../production-caption-words.mjs';
import {validateCaptionSegments,captionsHash} from '../editorial-captions.mjs';

const w=(start,end,text)=>({start,end,text});
test('word captions keep recognized words verbatim, group 1-3 words, never overlap and pass the libass validator',()=>{
  const words=[w(0.1,0.4,'Hoje'),w(0.42,0.7,'vamos'),w(0.72,1.0,'falar'),w(1.02,1.3,'de'),w(1.32,1.9,'edição.'),w(2.6,2.9,'Corte'),w(2.95,3.05,'é'),w(3.1,3.6,'90%'),w(3.62,4.0,'mais'),w(4.02,4.5,'rápido!')];
  const {segments,warnings}=captionsFromWords({words,segments:[]},5);
  assert.deepEqual(warnings,['whisper-approximate','word-timing']);
  assert.equal(segments.map(item=>item.text).join(' '),words.map(item=>item.text).join(' '),'no word changed, added or dropped');
  assert(segments.every(item=>item.text.split(' ').length<=3),JSON.stringify(segments));
  assert(segments.every((item,index)=>index===0||item.start>=segments[index-1].end),'no overlap');
  assert.equal(segments.find(item=>item.text.startsWith('Corte')).start,2.6,'does not bridge the 0.7 s pause');
  assert.ok(segments.some(item=>item.text.endsWith('edição.')),'breaks at sentence end');
  assert.deepEqual(validateCaptionSegments(segments,5),segments);
  assert.match(captionsHash(segments),/^[a-f0-9]{64}$/);
});
test('too-short words merge instead of breaking the engine minimum; libass-unsafe characters are reported',()=>{
  const {segments,warnings}=captionsFromWords({words:[w(0,0.05,'a'),w(0.06,0.1,'{b}'),w(0.11,0.15,'c')]},1);
  assert.equal(segments.length,1);assert.equal(segments[0].text,'a b c');assert(segments[0].end-segments[0].start>=0.2);
  assert(warnings.includes('text-sanitized'));validateCaptionSegments(segments,1);
});
test('without word timings it falls back to sentence captions and says so',()=>{
  const {segments,warnings}=captionsFromWords({segments:[{start:0,end:2,text:'Uma frase inteira.'}]},3);
  assert.equal(segments[0].text,'Uma frase inteira.');assert(warnings.includes('no-word-timing')&&warnings.includes('sentence-timing'));
});
