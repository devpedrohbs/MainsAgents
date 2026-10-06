/** Pure presentation of /api/codex/diagnostics and /api/providers/claude/diagnostics. Discovery never implies data access. */
export interface CodexDiagnostics {checkedAt:string;runtime:string;account:string;modelCheck:string;models:{id:string;name:string}[];discovery:string;servers:{name:string;status:string;tools:string[];readEvidence?:{checkedAt:string;tool:string;agentId:string}[]}[];agents:{id:string;name:string;provider?:string;skills:{name:string;status:string;path?:string;mentions?:string[];dependencies?:{name:string;status:string;missingTools?:string[]}[]}[]}[]}
export interface ClaudeDiagnostics {state?:string;message?:string;installCommand?:string;loginCommand?:string;mcp?:string}
export type FactState='yes'|'no'|'unknown'|'unchecked'|'restricted';
export type RowLevel='ready'|'unverified'|'attention'|'restricted'|'unchecked';
export interface Fact {label:string;value:string;state:FactState}
export interface NextAction {text:string;command?:string}
export interface CapabilityRow {id:string;kind:'cli'|'mcp'|'media';title:string;level:RowLevel;levelLabel:string;facts:Fact[];next?:NextAction;tools?:string[];receipts?:{tool:string;checkedAt:string;agent:string}[]}

export const probeTools=['accounts_list','accounts_list_accounts','list_connections'];
/** Servers the existing read-test endpoint can probe without AI inference. */
export const probeable=(server:CodexDiagnostics['servers'][number])=>['zernio','publora'].includes(server.name)&&server.status==='discovered'&&server.tools.some(tool=>probeTools.includes(tool));

const ptLabels:Record<string,string>={running:'Em execução',connected:'Conectado',authenticated:'Autenticado','login-required':'Precisa de login','not-installed':'CLI não instalada',error:'Não foi possível verificar','check-failed':'Não foi possível verificar',completed:'Concluído',failed:'Falhou',disabled:'Desativado',unavailable:'Indisponível',discovered:'Ferramentas encontradas',empty:'Sem ferramentas','not-discovered':'Não foi encontrado',readable:'Arquivo legível',missing:'Caminho não encontrado',unreadable:'Não foi possível ler','too-large':'Arquivo muito grande','missing-tools':'Ferramentas necessárias ausentes','invalid-declaration':'Requisitos declarados inválidos','check-in-media-editor':'Verificar no editor de mídia','unsupported-provider':'MCP indisponível neste provedor',available:'Instalado'};
export const statusLabel=(value:string,pt:boolean)=>pt?ptLabels[value]??value:value.replaceAll('-',' ');
const levels:Record<RowLevel,[string,string]>={ready:['Pronto','Ready'],unverified:['Leitura não verificada','Read not verified'],attention:['Precisa de atenção','Needs attention'],restricted:['Restrito pelo app','Restricted by the app'],unchecked:['Ainda não verificado','Not checked yet']};
const row=(pt:boolean,value:Omit<CapabilityRow,'levelLabel'>):CapabilityRow=>({...value,levelLabel:pt?levels[value.level][0]:levels[value.level][1]});
const fact=(label:string,value:string,state:FactState):Fact=>({label,value,state});

export function codexRow(data:CodexDiagnostics|null,error:string,pt:boolean):CapabilityRow{
 const t=(a:string,b:string)=>pt?a:b,where=t('em “Conexão com a CLI do Codex”, logo abaixo','in “Codex CLI connection” below');
 if(!data)return row(pt,{id:'codex',kind:'cli',title:'Codex CLI',level:error?'attention':'unchecked',facts:[fact(t('Runtime','Runtime'),error?t('Não respondeu','Did not respond'):t('Ainda não verificado','Not checked yet'),error?'no':'unchecked')],next:error?{text:t(`Use “Reconectar” ou “Verificar novamente” ${where}.`,`Use “Reconnect” or “Check again” ${where}.`)}:undefined});
 const account=data.account==='authenticated'?'yes':data.account==='login-required'?'no':'unknown';
 const facts=[fact(t('Runtime','Runtime'),statusLabel(data.runtime,pt),data.runtime==='running'?'yes':'no'),fact(t('Conta','Account'),statusLabel(data.account,pt),account),fact(t('Modelos','Models'),data.modelCheck==='completed'?`${data.models.length}`:statusLabel(data.modelCheck,pt),data.modelCheck==='completed'?'yes':'unknown'),fact(t('Descoberta MCP','MCP discovery'),statusLabel(data.discovery,pt),data.discovery==='completed'?'yes':'no')];
 const next:NextAction|undefined=account==='no'?{text:t(`Use “Entrar” ${where}.`,`Use “Sign in” ${where}.`)}:account==='unknown'?{text:t(`Use “Verificar novamente” ${where}.`,`Use “Check again” ${where}.`)}:data.discovery!=='completed'?{text:t(`A descoberta MCP falhou; use “Reconectar” ${where} e verifique de novo.`,`MCP discovery failed; use “Reconnect” ${where} and check again.`)}:undefined;
 return row(pt,{id:'codex',kind:'cli',title:'Codex CLI',level:next?'attention':'ready',facts,next});
}

export function claudeRow(claude:ClaudeDiagnostics|null,pt:boolean):CapabilityRow{
 const t=(a:string,b:string)=>pt?a:b,state=claude?.state;
 const mcp=fact('MCP',t('Bloqueado pelo MainsAgents neste provedor','Blocked by MainsAgents for this provider'),'restricted');
 if(!claude)return row(pt,{id:'claude',kind:'cli',title:'Claude Code CLI',level:'unchecked',facts:[fact(t('Instalação','Installation'),t('Ainda não verificado','Not checked yet'),'unchecked'),mcp]});
 const installed=state==='not-installed'?'no':state==='connected'||state==='login-required'?'yes':'unknown';
 const login=state==='connected'?'yes':state==='login-required'?'no':installed==='no'?'no':'unknown';
 const facts=[fact(t('Instalação','Installation'),installed==='yes'?t('Instalada','Installed'):installed==='no'?t('Não instalada','Not installed'):t('Não foi possível verificar','Could not check'),installed),fact('Login',login==='yes'?t('Conectado','Connected'):login==='no'?t('Sem login','Not signed in'):t('Não foi possível verificar','Could not check'),login),mcp];
 const next:NextAction|undefined=state==='not-installed'?{text:t('Instale a CLI no terminal e verifique de novo.','Install the CLI in a terminal, then check again.'),command:claude.installCommand}:state==='login-required'?{text:t('Entre pela própria CLI no terminal e verifique de novo.','Sign in through the CLI in a terminal, then check again.'),command:claude.loginCommand??'claude auth login'}:state!=='connected'?{text:t('Use “Verificar novamente” em “Conexão com a CLI do Claude Code”, logo abaixo.','Use “Check again” in “Claude Code CLI connection” below.')}:undefined;
 return row(pt,{id:'claude',kind:'cli',title:'Claude Code CLI',level:next?'attention':'restricted',facts,next});
}

export function mcpRows(data:CodexDiagnostics,pt:boolean,locale:string):CapabilityRow[]{
 const t=(a:string,b:string)=>pt?a:b;
 return data.servers.map(server=>{
  const s=server.status,receipts=(server.readEvidence??[]).map(proof=>({tool:proof.tool,checkedAt:new Date(proof.checkedAt).toLocaleString(locale),agent:data.agents.find(agent=>agent.id===proof.agentId)?.name??proof.agentId}));
  const connected:FactState=s==='discovered'||s==='empty'?'yes':s==='not-discovered'&&data.discovery!=='completed'?'unknown':'no';
  const connectedText=s==='disabled'?t('Desativado','Disabled'):s==='login-required'?t('Precisa de login','Login required'):s==='unavailable'?t('Falhou ao iniciar','Failed to start'):connected==='yes'?t('Respondeu','Responded'):connected==='unknown'?t('Não foi possível verificar','Could not check'):t('Não respondeu','Did not respond');
  const catalog=s==='discovered'?fact(t('Catálogo','Catalog'),`${statusLabel('discovered',pt)} (${server.tools.length})`,'yes'):fact(t('Catálogo','Catalog'),s==='empty'?statusLabel('empty',pt):t('Não disponível','Not available'),connected==='unknown'?'unknown':'no');
  const read=receipts.length?fact(t('Leitura real','Actual read'),t(`Confirmada em ${receipts.at(-1)!.checkedAt}`,`Confirmed on ${receipts.at(-1)!.checkedAt}`),'yes'):fact(t('Leitura real','Actual read'),t('Ainda não verificada','Not verified yet'),'unchecked');
  const facts=[fact(t('Configurado','Configured'),t('Sim, no Codex','Yes, in Codex'),'yes'),fact(t('Conexão','Connection'),connectedText,connected),catalog,read];
  let next:NextAction|undefined;
  if(s==='disabled')next={text:t('Reative o servidor na configuração do Codex e verifique de novo.','Re-enable the server in the Codex configuration, then check again.')};
  else if(s==='login-required')next={text:t('Faça login do servidor no terminal e verifique de novo.','Sign in to the server in a terminal, then check again.'),command:`codex mcp login ${server.name}`};
  else if(s==='unavailable')next={text:t('Confira se o app ou a CLI do servidor está aberto; depois use “Reconectar” e verifique de novo.','Make sure the server app or CLI is running; then use “Reconnect” and check again.')};
  else if(s==='empty')next={text:t('O servidor respondeu sem ferramentas; confira a conta ou o plano do serviço.','The server responded without tools; check the service account or plan.')};
  else if(s==='not-discovered')next={text:connected==='unknown'?t('A descoberta falhou; verifique de novo.','Discovery failed; check again.'):t('Configurado, mas não apareceu na descoberta; reinicie o Codex com “Reconectar”.','Configured but missing from discovery; restart Codex with “Reconnect”.')};
  else if(!receipts.length)next={text:probeable(server)?t('Use “Preparar teste de leitura” abaixo para confirmar o acesso real.','Use “Prepare read test” below to confirm actual access.'):t('Catálogo não comprova acesso. Ainda não há teste de leitura sem IA para este servidor; a primeira leitura aprovada no chat fica registrada aqui.','A catalog does not prove access. There is no AI-free read test for this server yet; the first approved read in chat will be recorded here.')};
  const level:RowLevel=s==='discovered'?receipts.length?'ready':'unverified':'attention';
  return row(pt,{id:`mcp:${server.name}`,kind:'mcp',title:server.name,level,facts,next,tools:server.tools,receipts});
 });
}

export function mediaRow(media:{ffmpeg:boolean;ffprobe:boolean}|null,checked:boolean,pt:boolean):CapabilityRow{
 const t=(a:string,b:string)=>pt?a:b;
 const facts=(['ffmpeg','ffprobe'] as const).map(name=>fact(name,!checked?t('Ainda não verificado','Not checked yet'):!media?t('Não foi possível verificar','Could not check'):media[name]?t('Instalado','Installed'):t('Não encontrado','Not found'),!checked?'unchecked':!media?'unknown':media[name]?'yes':'no'));
 const missing=facts.some(item=>item.state==='no'||item.state==='unknown');
 return row(pt,{id:'media',kind:'media',title:t('Edição de vídeo local','Local video editing'),level:!checked?'unchecked':missing?'attention':'ready',facts,next:missing?{text:t('Instale o FFmpeg (inclui ffprobe) neste PC e verifique de novo.','Install FFmpeg (includes ffprobe) on this PC, then check again.')}:undefined});
}

export function diagnosticsSummary(rows:CapabilityRow[],pt:boolean){
 const attention=rows.filter(item=>item.level==='attention').length,unverified=rows.filter(item=>item.level==='unverified').length;
 if(rows.every(item=>item.level==='unchecked'))return pt?'Nada verificado ainda. A verificação é manual e não gera respostas de IA.':'Nothing checked yet. Checks are manual and generate no AI responses.';
 const parts=[attention?(pt?`${attention} precisa(m) de atenção`:`${attention} need attention`):'',unverified?(pt?`${unverified} com catálogo encontrado e leitura não verificada`:`${unverified} with catalog found but read not verified`):''].filter(Boolean);
 return parts.length?parts.join(' · '):(pt?'Tudo verificado está pronto.':'Everything checked is ready.');
}
