// Adds the standalone skill "paper-fundos-gpt" (native GPT backgrounds in Paper) to the local "Criador de Carrosséis" agent.
// Only `skills`, `skillFiles` and `updatedAt` of that one agent change: provider (Claude by default), model, instructions,
// the other skills, Paper settings, sessions and drafts stay as saved. Through the app's state store (CAS write); no network.
//   node scripts/paper-gpt-skill-setup.mjs                      -> dry run
//   node scripts/paper-gpt-skill-setup.mjs --apply <backup-dir> -> backup, then write (MainsAgents must be closed)
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync,backup} from 'node:sqlite';
import {createDesktopStateStore} from '../desktop-state-store.mjs';

const agentId='criador-de-carrosseis-71023a16',skill='paper-fundos-gpt';
const skillFile=join(homedir(),'Documents','Skills','CriadorDeCarrosseis',skill,'SKILL.md');
const storage=join(homedir(),'.mainsagents','storage'),database=join(storage,'workspace-state.sqlite');
const apply=process.argv[2]==='--apply',backupDir=process.argv[3];
if(apply&&!backupDir)throw Error('Usage: --apply <backup-dir>');
const running=process.platform==='win32'?execFileSync('tasklist',['/FI','IMAGENAME eq MainsAgents.exe','/NH'],{encoding:'utf8'}).includes('MainsAgents.exe'):false;
if(running&&apply)throw Error('MainsAgents is running. Close it before changing saved agents.');
if(!existsSync(skillFile))throw Error(`Skill not found: ${skillFile}`);

const meta=new DatabaseSync(database,{readOnly:true});const version=meta.prepare("SELECT value FROM metadata WHERE key='app-version'").get()?.value;meta.close();
const store=createDesktopStateStore(storage,version);
const profile=store.currentProfile();if(!profile)throw Error('No active profile.');
const {values,revisions}=store.readAllVersioned(profile);
const agents=values.agents??[],index=agents.findIndex(agent=>agent.id===agentId);
if(index<0)throw Error(`Agent ${agentId} not found in the active profile.`);
const agent=agents[index];
const ownDraft=Object.keys(values['agent-drafts']??{}).find(key=>{try{return JSON.parse(key)[2]===`agent:${agentId}`;}catch{return false;}});
if(ownDraft)throw Error('This agent has an unsaved editor draft. Open it in MainsAgents and save or discard it first.');

const unchanged=agent.skills?.includes(skill)&&agent.skillFiles?.[skill]===skillFile;
const next={...agent,skills:agent.skills.includes(skill)?agent.skills:[...agent.skills,skill],skillFiles:{...agent.skillFiles,[skill]:skillFile},updatedAt:new Date().toISOString()};
console.log(JSON.stringify({profile:profile.slice(0,6)+'…',agent:agentId,provider:agent.providerId,skills:`${agent.skills.length} -> ${next.skills.length}`,added:unchanged?null:skill,disabled:(agent.disabledSkills??[]).includes(skill)},null,1));
if(!apply||unchanged){console.log(unchanged?'Already configured: nothing written.':'Dry run: nothing written.');process.exit(0);}

mkdirSync(backupDir,{recursive:true});
// Keep the source handle referenced until the online backup finishes (an unreferenced handle can be collected mid-copy).
const source=new DatabaseSync(database,{readOnly:true});
try{await backup(source,join(backupDir,'workspace-state.sqlite'));}finally{source.close();}
writeFileSync(join(backupDir,'agent-before.json'),JSON.stringify(agent,null,1),{flag:'wx'});
store.write(profile,'agents',agents.map((item,position)=>position===index?next:item),revisions.agents);
const after=store.read(profile,'agents');
if(after.length!==agents.length||after.some((item,position)=>position!==index&&JSON.stringify(item)!==JSON.stringify(agents[position])))throw Error('Other agents changed unexpectedly.');
const saved=after[index],keys=new Set([...Object.keys(agent),...Object.keys(saved)]);
for(const key of keys)if(!['skills','skillFiles','updatedAt'].includes(key)&&JSON.stringify(agent[key])!==JSON.stringify(saved[key]))throw Error(`Unexpected change in ${key}.`);
if(JSON.stringify(store.read(profile,'sessions'))!==JSON.stringify(values.sessions))throw Error('Sessions changed unexpectedly.');
console.log(`Applied. Backup: ${backupDir}`);
