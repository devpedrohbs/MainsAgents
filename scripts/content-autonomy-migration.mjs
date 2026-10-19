// Records the creator's explicit preference (2026-10-13) on the local "Criador de Carrosséis" agent: routine Paper
// production in its selected file without repeated confirmations, and "an explicit scheduling request in chat is the
// authorization for that exact future post". Also aligns the creator skills that still said scheduling always needs a
// separate approval. Through the app's own state store (CAS write); no AI, no network, no provider calls.
//   node scripts/content-autonomy-migration.mjs                      -> dry run: prints the planned change
//   node scripts/content-autonomy-migration.mjs --apply <backup-dir> -> backup, then write (MainsAgents must be closed)
// Every other agent, session and key is left untouched. Re-running after apply reports "Already configured".
import {execFileSync} from 'node:child_process';
import {copyFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync,backup} from 'node:sqlite';
import {createDesktopStateStore} from '../desktop-state-store.mjs';
import {validPaperDesign} from '../paper-design.mjs';
import {validPublishingAutomation} from '../publishing-automation.mjs';

const agentId='criador-de-carrosseis-71023a16',paperFileId='01M4V841P4WXN0HWA5BH326JKM';
const preference={enabled:true,provider:'publora',timeZone:'America/Sao_Paulo'};
const skillsDirectory=join(homedir(),'Documents','Skills','CriadorDeCarrosseis');
const storage=join(homedir(),'.mainsagents','storage'),database=join(storage,'workspace-state.sqlite');
const apply=process.argv[2]==='--apply',backupDir=process.argv[3];
if(apply&&!backupDir)throw Error('Usage: --apply <backup-dir>');
const running=process.platform==='win32'?execFileSync('tasklist',['/FI','IMAGENAME eq MainsAgents.exe','/NH'],{encoding:'utf8'}).includes('MainsAgents.exe'):false;
if(running&&apply)throw Error('MainsAgents is running. Close it before changing saved agents.');

// Exact phrase replacements: an edited phrase is left alone and reported, never overwritten.
const scheduleRule='Agendamento: quando o criador pede para agendar um post pronto, esse pedido é a autorização daquele agendamento futuro. Pergunte de uma vez só o que faltar (rede, conta, data, hora, fuso), use a legenda e as exportações já mostradas e a ferramenta mainsagents_schedule_post; não peça aprovação passo a passo. Publicar imediatamente, apagar ou alterar outros posts exige pedido explícito. Relate só o resultado confirmado pela ferramenta.';
const skillPatches=[
 ['carrossel-revisao-final.md','- [ ] Nada foi publicado, agendado ou enviado ao Notion sem aprovação explícita do criador.','- [ ] Nada foi publicado ou enviado ao Notion sem aprovação explícita do criador. Agendamento só quando o criador pediu para agendar este post (o pedido é a autorização); o que faltava (rede, conta, data, hora) foi perguntado de uma vez, sem inventar.'],
 ['mainsagent-contexto-editorial.md','A aprovação já autoriza esse registro; não autoriza agendamento/publicação.','A aprovação já autoriza esse registro; sozinha não autoriza agendamento/publicação. Quando o criador pede para agendar um post pronto, esse pedido autoriza aquele agendamento futuro: pergunte de uma vez só o que faltar (rede, conta, data e hora) e use mainsagents_schedule_post. Publicar imediatamente continua exigindo pedido explícito.'],
 ['mainsagent-contexto-editorial.md','e confirma o pacote antes de agendar a publicação.','e confirma o pacote antes de agendar a publicação; pedir o agendamento é essa confirmação.'],
 ['paper-carrossel/SKILL.md','- Sem geração de imagem paga nem assets `paper-gen://` sem pedido explícito. Padrão: fotos fornecidas ou capa tipográfica.','- Padrão: fotos fornecidas ou capa tipográfica. Imagens geradas (por exemplo, imagens GPT) só quando o criador pedir: gere com a ferramenta de imagem do host e insira o arquivo salvo com `<img src="paper-asset:///C:/caminho/imagem.png">`. Assets `paper-gen://` consomem créditos e sempre exigem pedido explícito.'],
];
const obsoletePaperRule='No Paper, siga as configurações salvas do agente: com a opção sem confirmações repetidas ativada, criar, editar e exportar no arquivo escolhido não pedem nova aprovação; apagar ou substituir camadas, usar outro arquivo e gerar imagens com créditos sempre pedem.';
const paperRule='No Paper, siga as configurações salvas do agente: com a produção automática ativada, ler, criar, editar, substituir layout, ajustar tokens, inserir imagens verificadas e exportar no arquivo escolhido não pedem aprovação; apagar camadas, usar outro arquivo e gerar imagens com créditos (paper-gen://) pedem.';

const meta=new DatabaseSync(database,{readOnly:true});const version=meta.prepare("SELECT value FROM metadata WHERE key='app-version'").get()?.value;meta.close();
const store=createDesktopStateStore(storage,version);
const profile=store.currentProfile();if(!profile)throw Error('No active profile.');
const {values,revisions}=store.readAllVersioned(profile);
const agents=values.agents??[],index=agents.findIndex(agent=>agent.id===agentId);
if(index<0)throw Error(`Agent ${agentId} not found in the active profile.`);
const agent=agents[index];
const ownDraft=Object.keys(values['agent-drafts']??{}).find(key=>{try{return JSON.parse(key)[2]===`agent:${agentId}`;}catch{return false;}});
if(ownDraft)throw Error('This agent has an unsaved editor draft. Open it in MainsAgents and save or discard it first.');
if(!['claude','codex'].includes(agent.providerId??'codex'))throw Error('The agent must use Claude or Codex.');
// The grant is only for the file the person selected; a different or missing file is reported, never guessed.
if(!validPaperDesign(agent.paperDesign)||!agent.paperDesign.enabled||agent.paperDesign.fileId!==paperFileId)throw Error(`Paper is not connected to the expected file (${paperFileId}). Reconnect it in Configure → Paper first.`);

let instructions=agent.instructions.replace(obsoletePaperRule,paperRule);
if(!instructions.includes(scheduleRule))instructions=`${instructions.trimEnd()}\n\n${scheduleRule}`;
const permissions=Array.isArray(agent.mcpPermissions)&&!agent.mcpPermissions.includes('schedule')?[...agent.mcpPermissions,'schedule']:agent.mcpPermissions;
const next={...agent,instructions,mcpPermissions:permissions,paperDesign:{...agent.paperDesign,automatic:true},publishingAutomation:validPublishingAutomation(agent.publishingAutomation)&&agent.publishingAutomation.enabled?agent.publishingAutomation:preference,updatedAt:new Date().toISOString()};
if(!validPublishingAutomation(next.publishingAutomation))throw Error('Invalid scheduling preference.');
const {updatedAt:_a,...left}=agent,{updatedAt:_b,...right}=next,unchangedAgent=JSON.stringify(left)===JSON.stringify(right);

const skills=skillPatches.map(([file,from,to])=>{const path=join(skillsDirectory,file);if(!existsSync(path))return {file,state:'missing'};const text=readFileSync(path,'utf8');return {file,path,from,to,text,state:text.includes(to)?'done':text.includes(from)?'patch':'edited-by-person (left alone)'};});
const summary={profile:profile.slice(0,6)+'…',agent:agentId,paperAutomatic:`${agent.paperDesign.automatic} -> true (file ${paperFileId})`,publishingAutomation:`${JSON.stringify(agent.publishingAutomation??null)} -> ${JSON.stringify(next.publishingAutomation)}`,mcpPermissions:`${JSON.stringify(agent.mcpPermissions??'all')} -> ${JSON.stringify(next.mcpPermissions??'all')}`,instructions:{paperRuleUpdated:agent.instructions.includes(obsoletePaperRule),scheduleRuleAdded:!agent.instructions.includes(scheduleRule)},skills:skills.map(item=>`${item.file}: ${item.state}`),authority:'Explicit user preference relayed by the coordinator on 2026-10-13 (autonomous routine production and scheduling on request).'};
console.log(JSON.stringify(summary,null,1));
const unchanged=unchangedAgent&&skills.every(item=>item.state!=='patch');
if(!apply||unchanged){console.log(unchanged?'Already configured: nothing written.':'Dry run: nothing written.');store.close?.();process.exit(0);}

mkdirSync(backupDir,{recursive:true});
// Keep the source handle referenced until the online backup finishes (an unreferenced handle can be collected mid-copy).
const source=new DatabaseSync(database,{readOnly:true});
try{await backup(source,join(backupDir,'workspace-state.sqlite'));}finally{source.close();}
writeFileSync(join(backupDir,'agent-before.json'),JSON.stringify(agent,null,1),{flag:'wx'});
writeFileSync(join(backupDir,'grant-audit.json'),JSON.stringify({appliedAt:new Date().toISOString(),...summary},null,1),{flag:'wx'});
for(const item of skills.filter(skill=>skill.state==='patch'))copyFileSync(item.path,join(backupDir,item.file.replace(/[\\/]/g,'__')));
if(!unchangedAgent){
 // CAS: fails if anything changed the saved agents after the read above.
 store.write(profile,'agents',agents.map((item,position)=>position===index?next:item),revisions.agents);
 const after=store.read(profile,'agents');
 if(after.length!==agents.length||after.some((item,position)=>position!==index&&JSON.stringify(item)!==JSON.stringify(agents[position])))throw Error('Other agents changed unexpectedly.');
 if(JSON.stringify(store.read(profile,'sessions'))!==JSON.stringify(values.sessions))throw Error('Sessions changed unexpectedly.');
}
// One write per file, only if it is still exactly what was read (and backed up) above.
for(const path of new Set(skills.filter(skill=>skill.state==='patch').map(skill=>skill.path))){
 const items=skills.filter(skill=>skill.path===path&&skill.state==='patch'),current=readFileSync(path,'utf8');
 if(current!==items[0].text)throw Error(`${items[0].file} changed during the migration; it was not patched.`);
 writeFileSync(path,items.reduce((text,item)=>text.replace(item.from,item.to),current));
}
console.log(`Applied. Backup: ${backupDir}`);store.close?.();
