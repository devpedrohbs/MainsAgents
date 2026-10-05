import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingSkills, providerSkillPrompt, slashSkillQuery, slashSkillToken, removeSlashSkillToken, typedSkillCommand } from '../src/features/chat/skillCommands.ts';

test('slash picker filters only skills associated with this agent',()=>{
  assert.equal(slashSkillQuery('/'), '');
  assert.equal(slashSkillQuery('/vid'), 'vid');
  assert.equal(slashSkillQuery('Please /vid'), 'vid');
  assert.deepEqual(matchingSkills(['video-hooks','research','video-hooks'],'VIDEO'),['video-hooks']);
  assert.deepEqual(matchingSkills(['research'],'video'),[]);
});

test('slash skills follow the caret in an existing request and never interpret URLs or paths',()=>{
  const draft='Crie um /video-hooks sobre IA';
  assert.deepEqual(slashSkillToken(draft,11),{query:'vi',start:8,end:20});
  assert.equal(slashSkillQuery(draft),null);
  assert.equal(slashSkillQuery('Primeira linha\n/'), '');
  for(const text of ['https://example.com/video','C:/video','/home/videos','Uma fração 1/2'])assert.equal(slashSkillQuery(text),null);
});

test('selecting an inline skill preserves the request on both sides of the cursor',()=>{
  const draft='Crie um /video-hooks sobre IA';
  const token=slashSkillToken(draft,11);
  assert.deepEqual(removeSlashSkillToken(draft,token),{text:'Crie um sobre IA',caret:8});
  assert.deepEqual(removeSlashSkillToken('/video-hooks Crie um roteiro',slashSkillToken('/video-hooks Crie um roteiro',12)),{text:'Crie um roteiro',caret:0});
  assert.deepEqual(removeSlashSkillToken('Crie um roteiro /',slashSkillToken('Crie um roteiro /')),{text:'Crie um roteiro ',caret:16});
});

test('typed command selects an exact associated skill and separates the request',()=>{
  assert.deepEqual(typedSkillCommand('/video-hooks Write three openings',['video-hooks']),{skill:'video-hooks',content:'Write three openings'});
  assert.equal(typedSkillCommand('/unlinked Write three openings',['video-hooks']),null);
});

test('provider request names the selected skill and rejects removed skills',()=>{
  const agent={skillsDirectory:'C:/skills/agent',skills:['video-hooks']};
  const prompt=providerSkillPrompt(agent,'Write three openings','video-hooks');
  assert.match(prompt,/video-hooks/);
  assert.match(prompt,/Write three openings/);
  assert.throws(()=>providerSkillPrompt({...agent,skills:[]},'Write three openings','video-hooks'),/no longer associated/);
});

test('A selected loose Markdown skill sends the exact file path to the provider',()=>{
  const agent={skillsDirectory:'C:/skills',skills:['roteiro'],skillFiles:{roteiro:'C:/skills/meu-roteiro.md',disabled:'C:/skills/disabled.md'}};
  const prompt=providerSkillPrompt(agent,'Crie um roteiro','roteiro');
  assert.match(prompt,/C:\/skills\/meu-roteiro\.md/);
  assert.doesNotMatch(prompt,/disabled\.md/);
  assert.match(prompt,/Crie um roteiro/);
});
