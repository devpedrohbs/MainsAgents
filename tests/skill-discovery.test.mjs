import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findSkills } from '../skill-discovery.mjs';

test('Loose Markdown skills support frontmatter and plain manually written files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mains-skills-'));
  writeFileSync(join(directory,'pautas.md'),'---\nname: editor-pautas\ndescription: Pautas\n---\n# Pautas');
  writeFileSync(join(directory,'Meu Roteiro.MD'),'# Escreva um roteiro\nInstruções da skill.');
  writeFileSync(join(directory,'README.md'),'Documentation');
  writeFileSync(join(directory,'empty.md'),'');
  const skills = findSkills(directory);
  assert.deepEqual(skills.map(skill=>skill.name).sort(), ['editor-pautas','meu-roteiro']);
  assert.equal(skills.find(skill=>skill.name==='editor-pautas').filePath,join(directory,'pautas.md'));
});

test('A standard skill and its Markdown copy appear once; support documents are not separate skills', () => {
  const directory = mkdtempSync(join(tmpdir(),'mains-skills-'));
  mkdirSync(join(directory,'research'));
  writeFileSync(join(directory,'research','SKILL.md'),'---\nname: research\n---\n# Research');
  writeFileSync(join(directory,'research','references.md'),'Reference documentation');
  writeFileSync(join(directory,'research.md'),'# Research');
  const skills=findSkills(directory);
  assert.equal(skills.length,1);
  assert.equal(skills[0].filePath,join(directory,'research.md'));
});

test('Refreshing a folder combines Markdown skills with npx-installed skills and discovers new files',()=>{
  const directory=mkdtempSync(join(tmpdir(),'mains-skill-refresh-'));
  writeFileSync(join(directory,'manual.md'),'# Manual skill');
  mkdirSync(join(directory,'.agents','skills','instagram-scraper'),{recursive:true});
  writeFileSync(join(directory,'.agents','skills','instagram-scraper','SKILL.md'),'---\nname: instagram-scraper\n---\n# Instagram');
  assert.deepEqual(findSkills(directory).map(skill=>skill.name).sort(),['instagram-scraper','manual']);
  writeFileSync(join(directory,'new-skill.md'),'# New skill');
  assert.deepEqual(findSkills(directory).map(skill=>skill.name).sort(),['instagram-scraper','manual','new-skill']);
});
