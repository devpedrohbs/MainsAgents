import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingSkills, providerSkillPrompt, slashSkillQuery, typedSkillCommand } from '../src/features/chat/skillCommands.ts';

test('slash picker filters only skills associated with this agent',()=>{
  assert.equal(slashSkillQuery('/'), '');
  assert.equal(slashSkillQuery('/vid'), 'vid');
  assert.equal(slashSkillQuery('Please /vid'), null);
  assert.deepEqual(matchingSkills(['video-hooks','research','video-hooks'],'VIDEO'),['video-hooks']);
  assert.deepEqual(matchingSkills(['research'],'video'),[]);
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
