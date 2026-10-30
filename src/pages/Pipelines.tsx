import { useState } from 'react';
import { useLanguage } from '../app/LanguageProvider';
import { useWorkspaces } from '../app/WorkspaceProvider';
import { useAgents } from '../features/agents/AgentsProvider';
import { AgentAvatar } from '../components/agents/AgentAvatar';
import { Icon } from '../components/common/Icon';
import { StatusIcon, type RunState } from '../components/common/StatusIcon';
import { updatePersistentValue } from '../data/localPersistence';
import { useProduction } from '../features/production/ProductionProvider';
import { boxTitle, createProductionFlow, flowExecutionSemantics, type FlowBoxKind, type ProductionFlows } from '../features/flows/flowModel';
import { planOf } from './Runs';
import { runLabel, shortAgo } from '../features/inbox/inbox';
import { selectRun } from '../features/inbox/runSelection';

interface PipelinesProps { onNewProduction: () => void; onNavigate: (page: 'runs') => void }
type Role = 'content-agent' | 'video-agent' | 'publishing-agent';
interface PipelineNode { id: string; kind: 'trigger' | 'agent' | 'human' | 'tool'; title: string; meta: string; role?: Role; stages: string[]; glyph: string; chips: string[]; column?: 0 | 1 }

/** The production every setup runs, in order. Agents fill the roles; the human gates are fixed by the coordinator. */
function nodesFor(pt: boolean, scriptMode: 'notion' | 'local'): PipelineNode[] {
  return [
    { id: 'trigger', kind: 'trigger', title: pt ? 'Pauta aprovada' : 'Idea approved', meta: pt ? 'ou vídeo já gravado' : 'or a recorded video', stages: [], glyph: '⚡', chips: [pt ? 'gatilho' : 'trigger'] },
    { id: 'script', kind: 'agent', role: 'content-agent', title: pt ? 'Escrever roteiro' : 'Write script', meta: '', stages: ['writing'], glyph: 'RO', chips: ['hook', 'CTA'] },
    { id: 'approve-script', kind: 'human', title: pt ? 'Aprovar roteiro' : 'Approve script', meta: pt ? 'Você' : 'You', stages: ['script-review'], glyph: '✓', chips: [pt ? 'aprovação' : 'approval'] },
    ...(scriptMode === 'notion' ? [{ id: 'notion', kind: 'tool' as const, role: 'content-agent' as Role, title: pt ? 'Registrar no Notion' : 'Save to Notion', meta: 'Notion', stages: ['notion'], glyph: 'N', chips: [pt ? 'card' : 'card'] }] : []),
    { id: 'recording', kind: 'human', title: pt ? 'Gravar e enviar o vídeo' : 'Record and send the video', meta: pt ? 'Você' : 'You', stages: ['recording'], glyph: '●', chips: [pt ? 'gravação' : 'recording'] },
    { id: 'edit', kind: 'agent', role: 'video-agent', title: pt ? 'Editar vídeo' : 'Edit video', meta: '', stages: ['planning-edit', 'editing'], glyph: 'ED', chips: [pt ? 'cortes' : 'cuts', pt ? 'legenda' : 'captions'] },
    { id: 'approve-video', kind: 'human', title: pt ? 'Aprovar vídeo' : 'Approve video', meta: pt ? 'Você' : 'You', stages: ['video-review'], glyph: '✓', chips: [pt ? 'aprovação' : 'approval'] },
    { id: 'captions', kind: 'agent', role: 'publishing-agent', title: pt ? 'Legendas por rede' : 'Captions per network', meta: '', stages: ['platforms', 'preparing-package'], glyph: 'PB', chips: [pt ? 'texto' : 'text'], column: 0 },
    { id: 'covers', kind: 'tool', title: pt ? 'Capas' : 'Covers', meta: pt ? 'locais, sem IA' : 'local, no AI', stages: ['generating-cover', 'covers-review'], glyph: '▣', chips: ['1280×720'], column: 1 },
    { id: 'approve-package', kind: 'human', title: pt ? 'Aprovar pacote' : 'Approve package', meta: pt ? 'Você' : 'You', stages: ['package-review'], glyph: '✓', chips: [pt ? 'aprovação' : 'approval'] },
    { id: 'schedule', kind: 'agent', role: 'publishing-agent', title: pt ? 'Agendar publicação' : 'Schedule post', meta: '', stages: ['schedule', 'scheduling'], glyph: 'PB', chips: [pt ? 'autorizado por você' : 'authorized by you'] },
  ];
}

export function Pipelines({ onNewProduction, onNavigate }: PipelinesProps) {
  const { locale } = useLanguage(), pt = locale === 'pt-BR';
  const { currentWorkspaceId } = useWorkspaces();
  const { agents: allAgents, getAgentById } = useAgents();
  const { flows, runs } = useProduction();
  const agents = allAgents.filter((agent) => agent.workspaceId === currentWorkspaceId);
  const workspaceFlows = flows.flows.filter((flow) => flow.workspaceId === currentWorkspaceId);
  const activeId = flows.activeByWorkspace[currentWorkspaceId];
  const flow = workspaceFlows.find((candidate) => candidate.id === activeId) ?? workspaceFlows[0];
  const [selectedNode, setSelectedNode] = useState('script');
  const [tab, setTab] = useState<'config' | 'run'>('config');
  const save = (update: (current: ProductionFlows) => ProductionFlows) => updatePersistentValue<ProductionFlows>('production-flows', flows, update);
  const createFlow = () => { const next = createProductionFlow(currentWorkspaceId, pt ? `Produção ${workspaceFlows.length + 1}` : `Production ${workspaceFlows.length + 1}`, allAgents, pt); save((current) => ({ ...current, flows: [...current.flows, next], activeByWorkspace: { ...current.activeByWorkspace, [currentWorkspaceId]: next.id } })); };

  if (!flow) return <div className="page v2-page v2-pipelines" data-od-id="pipelines-page">
    <header className="v2-header"><h1>Pipelines</h1><span className="v2-spacer" /><button className="primary-button" onClick={createFlow}><Icon name="plus" />{pt ? 'Nova configuração' : 'New setup'}</button></header>
    <div className="v2-empty v2-center"><b>{pt ? 'Nenhuma configuração de produção' : 'No production setup'}</b><span>{pt ? 'Uma configuração diz qual agente faz o roteiro, a edição e a publicação.' : 'A setup says which agent writes, edits and publishes.'}</span></div>
  </div>;

  const scriptMode = flow.scriptMode === 'local' ? 'local' : 'notion';
  const nodes = nodesFor(pt, scriptMode);
  const semantics = flowExecutionSemantics(flow, allAgents, pt);
  const roleAgent = (role: Role): ReturnType<typeof getAgentById> => { const box = flow.nodes.find((node) => node.kind === role); const agent = box?.agentId ? getAgentById(box.agentId) : undefined; return agent ?? (role === 'publishing-agent' ? roleAgent('content-agent') : undefined); };
  const latest = runs.filter((run) => run.workspaceId === currentWorkspaceId && run.flowId === flow.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const stageStates = new Map<string, RunState>(latest ? planOf(latest, pt, Date.now()).map((step) => [step.id, step.state]) : []);
  const nodeState = (node: PipelineNode): RunState | undefined => {
    if (!latest || !node.stages.length) return undefined;
    const states = node.stages.map((stage) => stageStates.get(stage)).filter((state): state is RunState => !!state);
    if (!states.length) return undefined;
    for (const state of ['failed', 'waiting', 'running', 'paused'] as RunState[]) if (states.includes(state)) return state;
    return states.every((state) => state === 'done') ? 'done' : states.includes('done') ? 'running' : 'queued';
  };
  const stateLabel: Record<RunState, string> = pt ? { queued: 'na fila', running: 'executando', waiting: 'aguardando você', paused: 'pausada', done: 'concluída', failed: 'falhou' } : { queued: 'queued', running: 'running', waiting: 'waiting for you', paused: 'paused', done: 'done', failed: 'failed' };
  const node = nodes.find((candidate) => candidate.id === selectedNode) ?? nodes[1];
  const setRoleAgent = (kind: FlowBoxKind, agentId: string) => save((current) => ({ ...current, flows: current.flows.map((f) => {
    if (f.id !== flow.id) return f;
    const index = f.nodes.findIndex((n) => n.kind === kind);
    const next = index >= 0 ? f.nodes.map((n, i) => i === index ? { ...n, agentId: agentId || undefined, sessionId: n.agentId === agentId ? n.sessionId : undefined } : n) : agentId ? [...f.nodes, { id: `box-${crypto.randomUUID()}`, kind, title: boxTitle(kind, pt), position: { x: 80 + f.nodes.length * 350, y: 140 }, agentId }] : f.nodes;
    return { ...f, nodes: next, updatedAt: new Date().toISOString() };
  }) }));
  const setScriptMode = (mode: 'notion' | 'local') => save((current) => ({ ...current, flows: current.flows.map((f) => f.id === flow.id ? { ...f, scriptMode: mode, updatedAt: new Date().toISOString() } : f) }));
  const rename = (name: string) => { const value = name.trim().slice(0, 120); if (value && value !== flow.name) save((current) => ({ ...current, flows: current.flows.map((f) => f.id === flow.id ? { ...f, name: value, updatedAt: new Date().toISOString() } : f) })); };
  const errors = semantics.issues.filter((issue) => issue.level === 'error');
  const main = nodes.filter((n) => n.column === undefined), parallelIndex = nodes.findIndex((n) => n.column !== undefined);
  const nodeCard = (n: PipelineNode) => {
    const agent = n.role ? roleAgent(n.role) : undefined, state = nodeState(n);
    const meta = n.kind === 'agent' || (n.kind === 'tool' && n.role) ? agent?.name ?? (pt ? 'sem agente' : 'no agent') : n.meta;
    return <button key={n.id} type="button" className={`v2-node ${n.kind}`} aria-pressed={n.id === node.id} onClick={() => setSelectedNode(n.id)} data-node={n.id}>
      <span className="v2-node-top">{agent && n.kind === 'agent' ? <AgentAvatar name={agent.name} image={agent.avatarImage} mascot={agent.avatarMascot} role={agent.role} /> : <span className="v2-node-glyph" aria-hidden="true">{n.glyph}</span>}<b className="v2-ellipsis">{n.title}</b>{state && <StatusIcon state={state} />}</span>
      <span className={`v2-node-meta v2-ellipsis ${n.kind === 'agent' && !agent ? 'missing' : ''}`}>{meta}</span>
      <span className="v2-node-chips">{n.chips.map((chip) => <span key={chip}>{chip}</span>)}</span>
    </button>;
  };
  const before = main.filter((n) => nodes.indexOf(n) < parallelIndex), after = main.filter((n) => nodes.indexOf(n) > parallelIndex);
  const parallel = nodes.filter((n) => n.column !== undefined);
  const nodeAgent = node.role ? roleAgent(node.role) : undefined;

  return <div className="page v2-page v2-pipelines" data-od-id="pipelines-page">
    <header className="v2-header">
      <nav className="v2-crumbs" aria-label={pt ? 'Trilha' : 'Breadcrumb'}><span>Pipelines</span><span aria-hidden="true">/</span>
        <select className="v2-flow-select" aria-label={pt ? 'Configuração de produção' : 'Production setup'} value={flow.id} onChange={(event) => save((current) => ({ ...current, activeByWorkspace: { ...current.activeByWorkspace, [currentWorkspaceId]: event.target.value } }))}>{workspaceFlows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
      </nav>
      <span className={`v2-chip ${errors.length ? 'v2-chip-failed' : 'v2-chip-done'}`}><StatusIcon size={12} state={errors.length ? 'failed' : 'done'} />{errors.length ? (pt ? `${errors.length} ${errors.length === 1 ? 'problema' : 'problemas'}` : `${errors.length} issue${errors.length === 1 ? '' : 's'}`) : (pt ? 'pronta para rodar' : 'ready to run')}</span>
      <span className="v2-sub">{pt ? `alterada há ${shortAgo(flow.updatedAt, locale)}` : `changed ${shortAgo(flow.updatedAt, locale)} ago`}</span>
      <span className="v2-spacer" />
      <button type="button" className="soft-button" onClick={createFlow}><Icon name="plus" />{pt ? 'Nova configuração' : 'New setup'}</button>
      <button type="button" className="primary-button" disabled={errors.length > 0} onClick={onNewProduction}>{pt ? 'Nova execução' : 'New run'}</button>
    </header>
    <div className="v2-pipe-body">
      <section className="v2-pipe-canvas" aria-label={pt ? 'Etapas do pipeline' : 'Pipeline steps'}>
        <div className="v2-pipe-flow">
          {before.map((n, index) => <div key={n.id} className="v2-pipe-step">{index > 0 && <i className="v2-edge" aria-hidden="true" />}{nodeCard(n)}{n.id === 'approve-script' && <span className="v2-loop" aria-hidden="true">{pt ? 'pedir ajuste volta ao roteiro' : 'request changes goes back to the script'}</span>}</div>)}
          <div className="v2-pipe-step"><i className="v2-edge" aria-hidden="true" /><span className="v2-edge-label">{pt ? 'aprovado · em paralelo' : 'approved · in parallel'}</span></div>
          <div className="v2-pipe-parallel">{parallel.map(nodeCard)}</div>
          <div className="v2-pipe-step"><span className="v2-edge-label">{pt ? 'espera os dois' : 'waits for both'}</span><i className="v2-edge" aria-hidden="true" /></div>
          {after.map((n, index) => <div key={n.id} className="v2-pipe-step">{index > 0 && <i className="v2-edge" aria-hidden="true" />}{nodeCard(n)}</div>)}
        </div>
        {latest && <button type="button" className="v2-pipe-run" onClick={() => { selectRun(currentWorkspaceId, latest.id); onNavigate('runs'); }}>
          <StatusIcon size={12} state={nodeState(nodes.find((n) => n.stages.includes(latest.stage)) ?? nodes[0]) ?? 'queued'} />
          {pt ? 'Estados da' : 'States of'} <span className="v2-mono">{runLabel(latest.id)}</span> {pt ? 'sobre as etapas' : 'on the steps'}<span className="v2-link">{pt ? 'Abrir rastro' : 'Open trace'}</span>
        </button>}
      </section>

      <aside className="v2-inspector v2-pipe-inspector" aria-label={pt ? 'Configurar etapa' : 'Configure step'}>
        <div className="v2-insp-title"><span className="v2-node-glyph" aria-hidden="true">{node.glyph}</span><div><h2>{node.title}</h2><span className="v2-sub">{node.kind === 'human' ? (pt ? 'Decisão sua' : 'Your decision') : node.kind === 'agent' ? (pt ? 'Agente' : 'Agent') : node.kind === 'trigger' ? (pt ? 'Gatilho' : 'Trigger') : (pt ? 'Ferramenta' : 'Tool')}</span></div></div>
        <div className="v2-tabs" role="tablist" aria-label={pt ? 'Seções da etapa' : 'Step sections'}>
          <button type="button" role="tab" aria-selected={tab === 'config'} onClick={() => setTab('config')}>{pt ? 'Configurar' : 'Configure'}</button>
          <button type="button" role="tab" aria-selected={tab === 'run'} onClick={() => setTab('run')}>{pt ? 'Última execução' : 'Last run'}</button>
        </div>
        {tab === 'config' ? <div className="v2-insp-form">
          <label className="v2-field"><span>{pt ? 'Nome da configuração' : 'Setup name'}</span><input key={flow.id} defaultValue={flow.name} onBlur={(event) => rename(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }} /></label>
          {node.role && node.kind === 'agent' && <label className="v2-field"><span>{pt ? 'Quem faz' : 'Who does it'}</span>
            <select value={flow.nodes.find((n) => n.kind === node.role)?.agentId ?? ''} onChange={(event) => setRoleAgent(node.role!, event.target.value)}>
              <option value="">{node.role === 'publishing-agent' ? (pt ? 'O agente de conteúdo' : 'The content agent') : (pt ? 'Escolha um agente' : 'Choose an agent')}</option>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
            {nodeAgent && <small className="v2-sub">{nodeAgent.role} · {nodeAgent.providerId === 'claude' ? 'Claude' : nodeAgent.providerId === 'gemini' ? 'Gemini' : 'Codex'}{node.id === 'edit' ? (pt ? ' · a direção de edição fica nas preferências da produção' : ' · edit direction lives in production preferences') : ''}</small>}
          </label>}
          {(node.id === 'notion' || node.id === 'script') && <div className="v2-field"><span>{pt ? 'Onde o roteiro aprovado fica' : 'Where the approved script lives'}</span>
            <div className="v2-segmented" role="group" aria-label={pt ? 'Destino do roteiro' : 'Script destination'}><button type="button" aria-pressed={scriptMode === 'notion'} onClick={() => setScriptMode('notion')}>Notion</button><button type="button" aria-pressed={scriptMode === 'local'} onClick={() => setScriptMode('local')}>{pt ? 'Só no app' : 'App only'}</button></div>
            <small className="v2-sub">{pt ? 'É o ponto de partida; cada nova execução mostra e confirma a escolha.' : 'A starting point; every new run shows and confirms the choice.'}</small>
          </div>}
          {node.kind === 'human' && <fieldset className="v2-field"><legend>{pt ? 'O que você pode fazer' : 'What you can do'}</legend>
            <span className="v2-check"><StatusIcon size={12} state="done" />{pt ? 'Aprovar e seguir' : 'Approve and continue'}</span>
            {node.id === 'approve-script' && <span className="v2-check"><StatusIcon size={12} state="done" />{pt ? 'Editar o texto e aprovar' : 'Edit the text and approve'}</span>}
            {node.id !== 'recording' && <span className="v2-check"><StatusIcon size={12} state="done" />{pt ? 'Pedir ajuste → volta para quem fez' : 'Request changes → back to whoever made it'}</span>}
            <span className="v2-check"><StatusIcon size={12} state="done" />{pt ? 'Interromper → encerra a execução' : 'Stop → ends the run'}</span>
            <small className="v2-sub">{pt ? 'Avisos chegam na Caixa de entrada. Nada segue sem sua decisão.' : 'Notices reach the Inbox. Nothing moves on without your decision.'}</small>
          </fieldset>}
          {node.kind === 'trigger' && <p className="v2-sub">{pt ? 'Começa por Nova execução: a partir de uma pauta aprovada no Estúdio ou de um vídeo que você já gravou.' : 'Starts from New run: from an idea approved in the Studio or a video you already recorded.'}</p>}
          {node.id === 'covers' && <p className="v2-sub">{pt ? 'Três capas locais por formato, exportadas neste PC. Você aprova uma por rede.' : 'Three local covers per format, exported on this PC. You approve one per network.'}</p>}
          {semantics.issues.length > 0 && <section className="v2-issues" aria-label={pt ? 'Verificação' : 'Check'}>{semantics.issues.map((issue, index) => <div key={index} className={issue.level}><StatusIcon size={12} state={issue.level === 'error' ? 'failed' : issue.level === 'warning' ? 'waiting' : 'queued'} /><span><b>{issue.message}</b> {issue.fix}</span></div>)}</section>}
        </div> : <div className="v2-insp-form">{latest ? <>
          <dl className="v2-kv"><div><dt>run</dt><dd>{runLabel(latest.id)}</dd></div><div><dt>{pt ? 'conteúdo' : 'content'}</dt><dd>{latest.name || latest.topic?.title}</dd></div><div><dt>{pt ? 'nesta etapa' : 'this step'}</dt><dd>{nodeState(node) ? stateLabel[nodeState(node)!] : (pt ? 'não se aplica' : 'n/a')}</dd></div><div><dt>{pt ? 'atualizada' : 'updated'}</dt><dd>{shortAgo(latest.updatedAt, locale)}</dd></div></dl>
          <button type="button" className="soft-button" onClick={() => { selectRun(currentWorkspaceId, latest.id); onNavigate('runs'); }}>{pt ? 'Abrir execução' : 'Open run'}</button>
        </> : <p className="v2-sub">{pt ? 'Esta configuração ainda não rodou.' : 'This setup has not run yet.'}</p>}</div>}
      </aside>
    </div>
  </div>;
}
