import type { Agent } from '../agents/model/Agent';

export interface SlashSkillToken { query:string; start:number; end:number }

/** Read the command at the caret, without treating URLs or file paths as skills. */
export function slashSkillToken(draft:string,caret=draft.length):SlashSkillToken|null {
  const cursor=Math.max(0,Math.min(caret,draft.length));
  const match=/(?:^|\s)\/([^\s/]*)$/.exec(draft.slice(0,cursor));
  if(!match)return null;
  const start=cursor-match[1].length-1;
  const suffix=/^[^\s/]*/.exec(draft.slice(cursor))![0];
  const end=cursor+suffix.length;
  if(draft[end]==='/')return null;
  return {query:match[1],start,end};
}

export function slashSkillQuery(draft:string,caret=draft.length):string|null {
  return slashSkillToken(draft,caret)?.query??null;
}

/** Selecting a chip removes only its command, keeping the surrounding request. */
export function removeSlashSkillToken(draft:string,token:SlashSkillToken):{text:string;caret:number} {
  const before=draft.slice(0,token.start);
  let after=draft.slice(token.end);
  if(!before||(/[\t ]$/.test(before)&&/^[\t ]/.test(after)))after=after.replace(/^[\t ]+/,'');
  return {text:before+after,caret:before.length};
}

export function matchingSkills(skills:readonly string[],query:string):string[] {
  const needle=query.toLocaleLowerCase();
  return [...new Set(skills)].filter((skill)=>skill.toLocaleLowerCase().includes(needle));
}

export function typedSkillCommand(draft:string,skills:readonly string[]):{skill:string;content:string}|null {
  const match=/^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(draft.trim());
  if(!match)return null;
  const skill=skills.find((item)=>item.toLocaleLowerCase()===match[1].toLocaleLowerCase());
  return skill?{skill,content:(match[2]??'').trim()}:null;
}

export function providerSkillPrompt(agent:Pick<Agent,'skills'|'skillsDirectory'|'skillFiles'>,content:string,selectedSkill?:string):string {
  const active=agent.skills??[];
  if(selectedSkill&&!active.includes(selectedSkill))throw new Error(`Skill ${selectedSkill} is no longer associated with this agent.`);
  if(selectedSkill&&!agent.skillsDirectory)throw new Error('The selected skill has no configured folder.');
  if(!agent.skillsDirectory)return content;
  const files=Object.fromEntries(active.filter(name=>agent.skillFiles?.[name]).map(name=>[name,agent.skillFiles![name]]));
  const scope=`Enabled skills for this agent: ${JSON.stringify(active)}. Skill Markdown files: ${JSON.stringify(files)}. Use no other skills from the folder ${JSON.stringify(agent.skillsDirectory)}.`;
  if(!selectedSkill)return `${scope}\n\nUser request:\n${content}`;
  const file=agent.skillFiles?.[selectedSkill];
  return `${scope}\n\nThe user explicitly selected the skill ${JSON.stringify(selectedSkill)}. ${file?`Read the Markdown file ${JSON.stringify(file)}`:'Read its SKILL.md or matching .md file in the configured folder'} and apply it to the request below. If it cannot be found or read, say so; do not pretend to use it.\n\nUser request:\n${content}`;
}
