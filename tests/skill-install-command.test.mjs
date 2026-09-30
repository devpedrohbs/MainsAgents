import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseSkillInstallCommand,skillInstallArgs} from '../skill-install-command.mjs';

test('Installer preserves the requested --skill instead of installing an entire repository',()=>{
  const parsed=parseSkillInstallCommand('npx skills add https://github.com/skillify-sh/skills --skill instagram-scraper');
  assert.deepEqual(parsed,{source:'https://github.com/skillify-sh/skills',skills:['instagram-scraper']});
  assert.deepEqual(skillInstallArgs(parsed),['--yes','skills','add',parsed.source,'--skill','instagram-scraper','--agent','codex','--yes','--copy']);
});
test('Installer supports multiple and quoted skill names without running arbitrary commands',()=>{
  assert.deepEqual(parseSkillInstallCommand('npx --yes skills add owner/repo -s one two --skill "Convex Best Practices" --yes --agent codex').skills,['one','two','Convex Best Practices']);
  for(const command of ['npx skills add owner/repo --skill','npx skills add owner/repo && whoami','npx skills add owner/repo --global','npx other-package add owner/repo','npx skills add owner/repo --skill "unclosed'])assert.throws(()=>parseSkillInstallCommand(command));
});
