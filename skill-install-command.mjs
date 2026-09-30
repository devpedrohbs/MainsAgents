export function parseSkillInstallCommand(command) {
  if (typeof command !== 'string' || /[\r\n;&|`<>]/.test(command)) throw new Error('Use only an npx skills add command.');
  const tokens = [];
  const pattern = /\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))/gy;
  let offset = 0;
  const text = command.trim();
  while (offset < text.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(text);
    if (!match) throw new Error('Check the quotes in the skill command.');
    tokens.push(match[1] ?? match[2] ?? match[3]);
    offset = pattern.lastIndex;
  }
  let index = 0;
  if (!/^npx(?:\.cmd)?$/i.test(tokens[index++] ?? '')) throw new Error('Enter a command like: npx skills add owner/repository --skill skill-name');
  if (tokens[index] === '--yes' || tokens[index] === '-y') index++;
  if (tokens[index++] !== 'skills' || tokens[index++] !== 'add') throw new Error('Use npx skills add to install a skill.');
  const source = tokens[index++];
  if (!source || !/^(https?:\/\/[^\s]+|[\w.-]+\/[\w./-]+(?:@[\w.-]+)?)$/.test(source)) throw new Error('Use a repository URL or owner/repository after npx skills add.');
  const skills = [];
  while (index < tokens.length) {
    const option = tokens[index++];
    if (['--yes','-y','--copy'].includes(option)) continue;
    if (option === '--agent' || option === '-a') {
      if (!['codex','claude-code'].includes(tokens[index++])) throw new Error('Supported agent options are codex and claude-code.');
      continue;
    }
    if (option === '--skill' || option === '-s') {
      const start = skills.length;
      while (index < tokens.length && !tokens[index].startsWith('-')) {
        const name = tokens[index++];
        if (!name || /[\\/]/.test(name)) throw new Error('Invalid skill name.');
        skills.push(name);
      }
      if (skills.length === start) throw new Error('Enter a skill name after --skill.');
      continue;
    }
    throw new Error(`Unsupported option: ${option}. Use --skill, --agent codex or --yes.`);
  }
  return { source, skills: [...new Set(skills)] };
}

export function skillInstallArgs({ source, skills }) {
  return ['--yes','skills','add',source,...skills.flatMap(name=>['--skill',name]),'--agent','codex','--yes','--copy'];
}
