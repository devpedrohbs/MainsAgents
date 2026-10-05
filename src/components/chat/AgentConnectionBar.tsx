import type { Agent } from '../../features/agents/model/Agent';
import type { AgentSession } from '../../features/chat/model/Chat';
import { useAgents } from '../../features/agents/AgentsProvider';
import { useChat } from '../../features/chat/ChatProvider';
import { useLanguage } from '../../app/LanguageProvider';
import { SelectMenu } from '../common/SelectMenu';
import { Icon } from '../common/Icon';

export function AgentConnectionBar({agent,session,ensureSession,busy,providerId,onError}:{
  agent:Agent; session?:AgentSession; ensureSession:()=>AgentSession;
  busy:boolean; providerId:string; onError:(message:string)=>void;
}) {
  const {agents,updateAgent}=useAgents();
  const {setAgentConnection,newConnectedSession,sessions,getRunState}=useChat();
  const {locale}=useLanguage();
  const pt=locale==='pt-BR',connection=session?.agentConnection;
  const targets=agents.filter(item=>item.workspaceId===agent.workspaceId&&item.id!==agent.id);
  const enabled=connection?.enabled??false;
  const selected=targets.find(item=>item.id===connection?.targetAgentId);
  const targetSession=sessions.find(item=>item.id===connection?.targetSessionId);
  const targetState=getRunState(targetSession?.id);
  const targetBusy=targetState==='thinking'||targetState==='searching'||targetState==='using-tool';
  const change=(targetId:string,on:boolean)=>{
    try {
      const current=ensureSession();
      if(on&&!agent.tools.includes('subagents'))updateAgent(agent.id,{...agent,tools:[...agent.tools,'subagents']});
      setAgentConnection(current.id,targetId,on);
    } catch(error) { onError(error instanceof Error?error.message:String(error)); }
  };
  return <div className={`agent-connection-bar ${enabled?'connected':''}`}>
    <div className="agent-connection-controls">
      <button type="button" role="switch" aria-checked={enabled} className="agent-connection-switch"
        aria-label={pt?'Conectar agente':'Connect agent'}
        disabled={busy||(!enabled&&(providerId!=='codex'||!targets.length))}
        title={providerId!=='codex'?(pt?'A conexão automática requer Codex no agente de origem.':'Automatic connections require Codex in the requesting agent.'):undefined}
        onClick={()=>change(enabled?connection?.targetAgentId??'':selected?.id??targets[0]?.id??'',!enabled)}>
        <span className="agent-switch-track" aria-hidden="true"><i/></span>
        <span>{pt?'Conectar agente':'Connect agent'}</span>
      </button>
      {enabled&&<SelectMenu className="agent-connection-picker" value={selected?.id??''}
        ariaLabel={pt?'Agente conectado':'Connected agent'} disabled={busy||targetBusy}
        options={[...(!selected?[{value:'',label:pt?'Selecione um agente':'Choose an agent',disabled:true}]:[]),...targets.map(item=>({value:item.id,label:item.name}))]}
        onChange={id=>change(id,true)}/>}
      {enabled&&<button type="button" className="agent-connection-new" disabled={busy||targetBusy||!selected}
        aria-label={pt?'Nova sessão no agente conectado':'New connected agent session'}
        title={pt?'Iniciar outra conversa mantendo a função e as skills do agente.':'Start another conversation with the same agent role and skills.'}
        onClick={()=>{try{newConnectedSession(ensureSession().id);}catch(error){onError(error instanceof Error?error.message:String(error));}}}>
        <Icon name="plus"/><span>{pt?'Nova sessão':'New session'}</span>
      </button>}
    </div>
    {enabled&&<p className={!selected?'connection-unavailable':''}>
      {!selected?(pt?'O agente não está disponível. Selecione outro ou desligue a conexão.':'This agent is unavailable. Choose another or turn off the connection.'):
        targetSession?(pt?`Continua em: ${targetSession.title}`:`Continues in: ${targetSession.title}`):
        (pt?'Pedidos relevantes serão enviados ao agente escolhido, na mesma sessão.':'Relevant requests go to the selected agent in the same session.')}
    </p>}
  </div>;
}
