import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

function skillName(file, fallback) {
  const text = readFileSync(file, 'utf8');
  const header = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const name = header && /^name:\s*(.+)$/m.exec(header[1])?.[1]?.trim().replace(/^['"]|['"]$/g, '');
  return name && /^[\p{L}\p{N}_-]+$/u.test(name) ? name : fallback.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'skill';
}

export function findSkills(directory, depth = 0) {
  if (!directory || !existsSync(directory) || depth > 4) return [];
  const found = [];
  try {
    const entries = readdirSync(directory, { withFileTypes: true });
    const standard = entries.find(entry => entry.isFile() && entry.name.toLowerCase() === 'skill.md');
    if (standard) {
      const filePath = join(directory, standard.name);
      const installed = ['.agents','.codex','.claude'].flatMap(agentDirectory=>findSkills(join(directory,agentDirectory,'skills'),depth+1));
      const own = { name: skillName(filePath, basename(directory)), path: directory, filePath };
      return [...new Map([...installed,own].map(skill=>[skill.name,skill])).values()];
    }
    // A loose file in the selected folder takes precedence over a copied nested skill.
    for (const agentDirectory of ['.agents','.codex','.claude']) found.push(...findSkills(join(directory,agentDirectory,'skills'),depth+1));
    for (const entry of entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).sort((a,b)=>a.name.localeCompare(b.name))) found.push(...findSkills(join(directory,entry.name), depth + 1));
    for (const entry of entries.filter(entry => entry.isFile() && /\.md$/i.test(entry.name) && !/^(readme|license|changelog|agents)\.md$/i.test(entry.name)).sort((a,b)=>a.name.localeCompare(b.name))) {
      try {
        const filePath = join(directory, entry.name);
        if (!readFileSync(filePath, 'utf8').trim()) continue;
        found.push({ name: skillName(filePath, entry.name.replace(/\.md$/i,'')), path: directory, filePath });
      } catch { /* An unreadable file does not hide the remaining skills. */ }
    }
  } catch { return []; }
  const unique = new Map();
  for (const skill of found) unique.set(skill.name, skill);
  return [...unique.values()];
}
