import {useState} from 'react';
import {useLanguage} from '../../app/LanguageProvider';
import {RuntimeActionApprovals} from './RuntimeActionApprovals';
import {SelectMenu} from '../common/SelectMenu';
import {claudeRow,codexRow,diagnosticsSummary,mcpRows,mediaRow,probeable,statusLabel,type CapabilityRow,type ClaudeDiagnostics,type CodexDiagnostics,type FactState,type MediaCapabilities} from '../../features/chat/runtimeDiagnosticsView';
import {productionReadiness} from '../../features/chat/productionReadiness';
import '../../styles/runtime-actions.css';
import './runtime-diagnostics.css';

const factMark:Record<FactState,string>={yes:'✓',no:'✕',unknown:'?',unchecked:'–',restricted:'⊘'};

function CapabilityCard({item,pt}:{item:CapabilityRow;pt:boolean}){
 return <li className="capability-card" data-level={item.level}>
  <div className="capability-head"><strong>{item.title}</strong><span className="capability-level">{item.levelLabel}</span></div>
  <dl className="capability-facts">{item.facts.map(fact=><div key={fact.label} data-state={fact.state}><dt>{fact.label}</dt><dd><span aria-hidden="true">{factMark[fact.state]}</span> {fact.value}</dd></div>)}</dl>
  {item.next&&<div className="capability-next"><span>{pt?'Próxima ação: ':'Next action: '}</span>{item.next.text}{item.next.command&&<code>{item.next.command}</code>}</div>}
  {(item.tools?.length||item.receipts?.length)?<details><summary>{pt?`Detalhes técnicos de ${item.title}`:`${item.title} technical details`}</summary>
   {item.tools?.length?<p>{pt?'Ferramentas no catálogo (aprovação em cada chamada permitida): ':'Catalog tools (approval for every permitted call): '}{item.tools.join(', ')}</p>:null}
   {item.receipts?.map((proof,index)=><p key={index}>{pt?'Leitura confirmada':'Confirmed read'}: {proof.tool} · {proof.checkedAt} · {proof.agent}</p>)}
  </details>:null}
 </li>;
}

export function RuntimeDiagnostics(){
 const {locale}=useLanguage(),pt=locale==='pt-BR';
 const [media,setMedia]=useState<MediaCapabilities|null>(null);
 const [data,setData]=useState<CodexDiagnostics|null>(null),[claude,setClaude]=useState<ClaudeDiagnostics|null>(null),[checked,setChecked]=useState(false),[working,setWorking]=useState(false),[error,setError]=useState(''),[testing,setTesting]=useState(false),[probeAgent,setProbeAgent]=useState(''),[probeServer,setProbeServer]=useState(''),[notice,setNotice]=useState('');
 async function get<T>(url:string):Promise<T>{const response=await fetch(url,{cache:'no-store'}),value=await response.json();if(!response.ok)throw new Error(value.error??'CLI unavailable');return value;}
 async function check(){setWorking(true);setError('');const results=await Promise.allSettled([get<CodexDiagnostics>('/api/codex/diagnostics'),get<ClaudeDiagnostics>('/api/providers/claude/diagnostics'),get<MediaCapabilities>('/api/content/media/capabilities')]);if(results[0].status==='fulfilled')setData(results[0].value);else{setData(null);setError(String(results[0].reason.message??results[0].reason));}setClaude(results[1].status==='fulfilled'?results[1].value:{state:'check-failed'});setMedia(results[2].status==='fulfilled'?results[2].value:null);setChecked(true);setWorking(false);}
 async function probe(){setTesting(true);setError('');setNotice('');try{const response=await fetch('/api/codex/diagnostics/read-test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({agentId:probeAgent,server:probeServer})}),value=await response.json();if(!response.ok)throw new Error(value.error);setNotice(pt?'Leitura real confirmada. Nenhum turno de IA foi iniciado.':'Real read confirmed. No AI turn was started.');await check();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setTesting(false);}}
 const rows=[codexRow(data,error,pt),claudeRow(checked?claude:null,pt),...(data?mcpRows(data,pt,locale):[]),mediaRow(media,checked,pt)];
 const readiness=productionReadiness(rows,pt);
 const probeServers=data?.servers.filter(probeable)??[];
 return <section className="runtime-capabilities" aria-labelledby="runtime-capabilities-title" aria-busy={working}>
  <header><div><strong id="runtime-capabilities-title">{pt?'Capacidades das CLIs e dos agentes':'CLI and agent capabilities'}</strong><small>{pt?'Verificação manual: confere instalação, login, catálogo MCP e requisitos das skills sem gerar respostas de IA.':'Manual check: verifies installation, sign-in, MCP catalog and skill requirements without generating AI responses.'}</small></div><button className="soft-button" disabled={working||testing} onClick={()=>void check()}>{working?(pt?'Verificando…':'Checking…'):(pt?'Verificar capacidades':'Check capabilities')}</button></header>
  <p className="capability-summary" role="status">{working?(pt?'Verificando capacidades…':'Checking capabilities…'):diagnosticsSummary(rows,pt)}{data&&` · ${pt?'Verificado em':'Checked at'} ${new Date(data.checkedAt).toLocaleString(locale)}`}</p>
  <section className="readiness-checklist" aria-labelledby="readiness-title"><h3 id="readiness-title">{pt?'Pronto para produzir?':'Ready to produce?'}</h3><p className="readiness-summary" role="status">{readiness.summary}</p>
   <ul>{readiness.items.map(item=><li key={item.id} data-state={item.state}><span className="readiness-state"><span aria-hidden="true">{({ready:'✓',blocked:'✕',unverified:'?',unchecked:'–'})[item.state]}</span> {item.stateLabel}</span><div><strong>{item.title}{item.optional&&<em> · {pt?'opcional':'optional'}</em>}</strong><small>{item.detail}</small>{item.next&&<small className="readiness-next">{pt?'Como resolver: ':'How to fix: '}{item.next}</small>}</div></li>)}</ul>
   <p className="capability-note">{pt?'Este resumo reaproveita as verificações abaixo e a verificação antes de iniciar cada produção; não chama IA nem inventa disponibilidade.':'This summary reuses the checks below and the pre-start check of each production; it calls no AI and invents no availability.'}</p></section>
  {error&&<p className="capability-error" role="alert">{pt?'Codex não respondeu ao diagnóstico: ':'Codex did not answer diagnostics: '}{error}</p>}
  <ul className="capability-list">{rows.map(item=><CapabilityCard key={item.id} item={item} pt={pt}/>)}</ul>
  <p className="capability-note">{pt?'Catálogo encontrado não comprova acesso aos dados. Só “Leitura real” confirma uma leitura concluída, com data; isso não garante que o acesso continue disponível. No provedor Claude, o MainsAgents mantém MCP, escrita e controle do computador bloqueados; modelos são aliases do provedor.':'A discovered catalog does not prove data access. Only “Actual read” confirms a completed read, with its date; it does not guarantee continued access. For the Claude provider, MainsAgents keeps MCP, writes and computer control blocked; models are provider aliases.'}</p>
  {probeServers.length>0&&<div className="runtime-action"><strong>{pt?'Testar leitura real do provedor':'Test actual provider reads'}</strong><p>{pt?'Consulta as contas do provedor, após sua aprovação abaixo. Sem inferência de IA, criação ou publicação.':'Queries provider accounts after your approval below. No AI inference, creation or publication.'}</p><SelectMenu value={probeServer} onChange={setProbeServer} ariaLabel={pt?'Provedor do teste':'Test provider'} options={[{value:'',label:pt?'Escolha o provedor':'Choose the provider'},...probeServers.map(server=>({value:server.name,label:server.name}))]}/><SelectMenu value={probeAgent} onChange={setProbeAgent} ariaLabel={pt?'Agente do teste':'Test agent'} options={[{value:'',label:pt?'Escolha um agente Codex':'Choose a Codex agent'},...(data?.agents??[]).filter(agent=>(agent.provider??'codex')==='codex').map(agent=>({value:agent.id,label:agent.name}))]}/><button className="soft-button" disabled={testing||!probeAgent||!probeServer} onClick={()=>void probe()}>{testing?(pt?'Aguardando decisão / consulta…':'Awaiting decision / read…'):(pt?'Preparar teste de leitura':'Prepare read test')}</button><RuntimeActionApprovals/>{notice&&<p role="status">{notice}</p>}</div>}
  {data&&data.agents.length>0&&<details className="capability-skills"><summary>{pt?'Skills dos agentes e dependências declaradas':'Agent skills and declared dependencies'}</summary><ul>{data.agents.map(agent=><li key={agent.id}><strong>{agent.name}</strong>{agent.skills.length?agent.skills.map(skill=><div key={skill.name}>{skill.name} · {statusLabel(skill.status,pt)}{skill.dependencies?.length?skill.dependencies.map(requirement=><small key={requirement.name}>{requirement.name}: {statusLabel(requirement.status==='check-in-media-editor'&&media?(media[requirement.name as 'ffmpeg'|'ffprobe']?'available':'unavailable'):requirement.status,pt)}{requirement.missingTools?.length?` (${requirement.missingTools.join(', ')})`:''}</small>):skill.mentions?.length?<small>{pt?'Menciona, sem declarar dependências':'Mentions without declaring dependencies'}: {skill.mentions.join(', ')}</small>:null}</div>):<span>{pt?'Sem skills associadas':'No associated skills'}</span>}</li>)}</ul></details>}
  <details><summary>{pt?'Histórico de aprovações do chat':'Chat approval history'}</summary><RuntimeActionApprovals history/></details>
 </section>;
}
