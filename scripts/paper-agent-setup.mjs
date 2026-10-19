// Points the local "Criador de Carrosséis" agent at Claude + Paper, through the app's own state store (CAS write, agent
// revision history). No AI, no network, no Paper calls. Every other agent, session and key is left untouched.
//   node scripts/paper-agent-setup.mjs                 -> dry run: prints the planned change (no content, no secrets)
//   node scripts/paper-agent-setup.mjs --apply <backup-dir>
// Refuses while MainsAgents is running (its in-memory data would overwrite or conflict with this write).
import {execFileSync} from 'node:child_process';
import {copyFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync,backup} from 'node:sqlite';
import {createDesktopStateStore} from '../desktop-state-store.mjs';
import {paperVisualStyle,validPaperDesign} from '../paper-design.mjs';

const agentId='criador-de-carrosseis-71023a16',skill='paper-carrossel';
const skillsDirectory=join(homedir(),'Documents','Skills','CriadorDeCarrosseis'),skillFile=join(skillsDirectory,skill,'SKILL.md');
const storage=join(homedir(),'.mainsagents','storage'),database=join(storage,'workspace-state.sqlite');
const apply=process.argv[2]==='--apply',backupDir=process.argv[3];
if(apply&&!backupDir)throw Error('Usage: --apply <backup-dir>');

const running=process.platform==='win32'?execFileSync('tasklist',['/FI','IMAGENAME eq MainsAgents.exe','/NH'],{encoding:'utf8'}).includes('MainsAgents.exe'):false;
if(running&&apply)throw Error('MainsAgents is running. Close it before changing saved agents.');
if(!existsSync(skillFile))throw Error(`Skill not found: ${skillFile}`);

// Same version as stored: opening the store must not trigger its version-migration backup or metadata change.
const meta=new DatabaseSync(database,{readOnly:true});const version=meta.prepare("SELECT value FROM metadata WHERE key='app-version'").get()?.value;meta.close();
const store=createDesktopStateStore(storage,version);
const profile=store.currentProfile();if(!profile)throw Error('No active profile.');
const {values,revisions}=store.readAllVersioned(profile);
const agents=values.agents??[],index=agents.findIndex(agent=>agent.id===agentId);
if(index<0)throw Error(`Agent ${agentId} not found in the active profile.`);
const agent=agents[index];
if(agent.workspaceId!=='my-workspace')throw Error(`Unexpected workspace ${agent.workspaceId}.`);
// An unsaved editor draft of this agent would reopen with the old provider/skills and could revert this change on save.
const ownDraft=Object.keys(values['agent-drafts']??{}).find(key=>{try{return JSON.parse(key)[2]===`agent:${agentId}`;}catch{return false;}});
if(ownDraft)throw Error('This agent has an unsaved editor draft. Open it in MainsAgents and save or discard it first.');

// The 0.3.63/0.3.64 stock direction (fixed blue palette). Only this exact text is moved to the flexible base; any edited style stays.
const previousStockStyle=`Direção editorial tech baseada nas referências fornecidas pelo criador (cores aproximadas): azul #41799F, azul claro #A8D7E8, branco #F7F8F4, verde escuro #173029 e verde suave #A9B99C.
Formato inicial 1080 × 1350 px, adaptável ao pedido. Capa com foto real autorizada ocupando o quadro e uma palavra ou assunto dominante; quando não houver foto adequada, use uma capa tipográfica forte. Títulos brancos em sans-serif pesada (Inter ou Manrope disponíveis), com 120–180 px; palavra dominante pode chegar a 220 px. Serifada editorial em itálico (Georgia ou equivalente disponível) pode aparecer em títulos, com moderação. Corpo 40–48 px, entrelinha confortável e margem segura de 72 px. Confirme as fontes disponíveis no Paper.
Slides internos azuis, uma ideia por página, respiro amplo e screenshots reais grandes em moldura clara nos tutoriais. Capture ou use arquivos reais fornecidos; não simule uma interface como prova. Evite reduzir screenshots inteiros até que seus textos fiquem ilegíveis: destaque o trecho relevante. Encerramento com CTA curto em cápsula branca. Assinatura discreta e consistente, quando configurada.
Preserve os textos como camadas editáveis, separados de fotografias e screenshots. Adapte a composição a cada slide. As referências orientam cor, escala e ritmo; use a identidade do criador. Os controles de navegação, bolinhas e ícones do Instagram vistos nas capturas não pertencem à arte. Confira cada slide em escala de celular antes de exportar.`;
const paperDesign=validPaperDesign(agent.paperDesign)
 // Keep whatever the person already saved in the editor (file, signature, edited style, grant); this script never enables the grant.
 ?(agent.paperDesign.visualStyle===previousStockStyle?{...agent.paperDesign,visualStyle:paperVisualStyle}:agent.paperDesign)
 // No file yet: the person connects the open Paper file in the editor, which also turns Paper on.
 :{enabled:false,automatic:false,fileId:'',fileName:'',signature:'',visualStyle:paperVisualStyle};
// Permanent instructions: the per-call sentence is replaced by the saved-settings rule; the Paper workflow is appended once.
const obsolete='Escrever, exportar ou apagar no Paper exige aprovação a cada chamada.';
const savedRule='No Paper, siga as configurações salvas do agente: com a opção sem confirmações repetidas ativada, criar, editar e exportar no arquivo escolhido não pedem nova aprovação; apagar ou substituir camadas, usar outro arquivo e gerar imagens com créditos sempre pedem.';
const marker='Fluxo Paper (skill paper-carrossel):';
const previousBlock=`${marker} ao criar ou editar slides no Paper, leia antes a skill paper-carrossel. Os parâmetros Paper salvos no MainsAgents (arquivo de destino, assinatura e direção visual) prevalecem sobre padrões antigos das outras skills. Sem arquivo conectado, não crie em outro arquivo: peça para conectar o arquivo em Configurar → Paper. Não invente assinatura nem gere imagens pagas sem pedido explícito.`;
// Per-piece visual rule; also appended on its own when the person rewrote the Paper block, so their wording is kept.
const styleRule='Estilo por carrossel: a direção visual salva é só a base. Cores, referências ou estilo que o criador pedir para um carrossel valem para essa peça, coerentes em todos os slides e revisões dela, e não mudam a base, o perfil nem as skills, a menos que ele peça explicitamente para salvar um novo padrão; num carrossel novo sem pedido visual, volte à base.';
const paperBlock=`${marker} ao criar ou editar slides no Paper, leia antes a skill paper-carrossel. Arquivo de destino, assinatura e modo de aprovação salvos no MainsAgents prevalecem sobre padrões antigos das outras skills. ${styleRule} Sem arquivo conectado, não crie em outro arquivo: peça para conectar o arquivo em Configurar → Paper. Não invente assinatura nem gere imagens pagas sem pedido explícito.`;
const instructions=(text=>text.includes(styleRule)?text:text.includes(previousBlock)?text.replace(previousBlock,paperBlock):text.includes(marker)?`${text.trimEnd()}\n\n${styleRule}`:`${text.trimEnd()}\n\n${paperBlock}`)(agent.instructions.replace(obsolete,savedRule));
const next={...agent,instructions,providerId:'claude',modelId:agent.providerId==='claude'?agent.modelId:'',skills:agent.skills.includes(skill)?agent.skills:[...agent.skills,skill],skillFiles:{...agent.skillFiles,[skill]:skillFile},disabledSkills:(agent.disabledSkills??[]).filter(name=>name!==skill),paperDesign,updatedAt:new Date().toISOString()};
const summary={profile:profile.slice(0,6)+'…',agents:agents.length,agent:agentId,provider:`${agent.providerId} -> claude`,model:`${JSON.stringify(agent.modelId)} -> ${JSON.stringify(next.modelId)}`,skills:`${agent.skills.length} -> ${next.skills.length}`,instructions:{chars:`${agent.instructions.length} -> ${next.instructions.length}`,namesPaperSkill:next.instructions.includes('paper-carrossel'),obsoleteRemoved:!next.instructions.includes(obsolete),perPieceStyleRule:next.instructions.includes(styleRule)},visualStyle:agent.paperDesign?.visualStyle===previousStockStyle?"previous stock -> editorial base":paperDesign.visualStyle===paperVisualStyle?"editorial base":"kept (customized)",unchanged:JSON.stringify(next)===JSON.stringify({...agent,updatedAt:next.updatedAt}),paperDesign:{...paperDesign,visualStyle:`${paperDesign.visualStyle.length} chars`},sessionsUntouched:(values.sessions??[]).length};
console.log(JSON.stringify(summary,null,1));
if(!apply||summary.unchanged){console.log(summary.unchanged?'Already configured: nothing written.':'Dry run: nothing written.');store.close?.();process.exit(0);}

mkdirSync(backupDir,{recursive:true});
// Keep the source handle referenced until the online backup finishes (an unreferenced handle can be collected mid-copy).
const source=new DatabaseSync(database,{readOnly:true});
try{await backup(source,join(backupDir,'workspace-state.sqlite'));}finally{source.close();}
copyFileSync(join(skillsDirectory,'carrossel-direcao-visual.md'),join(backupDir,'carrossel-direcao-visual.md'));
writeFileSync(join(backupDir,'agent-before.json'),JSON.stringify(agent,null,1),{flag:'wx'});
// CAS: fails if anything changed the saved agents after the read above.
store.write(profile,'agents',agents.map((item,position)=>position===index?next:item),revisions.agents);
const after=store.read(profile,'agents');
if(after.length!==agents.length||after.some((item,position)=>position!==index&&JSON.stringify(item)!==JSON.stringify(agents[position])))throw Error('Other agents changed unexpectedly.');
if(JSON.stringify(store.read(profile,'sessions'))!==JSON.stringify(values.sessions))throw Error('Sessions changed unexpectedly.');
console.log(`Applied. Backup: ${backupDir}`);store.close?.();
