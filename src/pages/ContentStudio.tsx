import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useWorkspaces } from '../app/WorkspaceProvider';
import { useLanguage } from '../app/LanguageProvider';
import { useAgents } from '../features/agents/AgentsProvider';
import { useContentWorkflow } from '../features/content/ContentWorkflowProvider';
import type {
  ApprovedScript,
  ContentFormat,
  EditorialContent,
  EditorialTopic,
  Platform,
  ScriptOptions,
} from '../features/content/model';
import { SelectMenu } from '../components/common/SelectMenu';
import { Icon } from '../components/common/Icon';

const platforms: Platform[] = ['Instagram', 'TikTok', 'YouTube'];
const topicStatus: Record<EditorialTopic['status'], [string, string]> = {
  draft: ['Aguardando pesquisa', 'Research needed'],
  researching: ['Pesquisando', 'Researching'],
  review: ['Para decidir', 'Needs decision'],
  approved: ['Aprovada', 'Approved'],
  rejected: ['Descartada', 'Rejected'],
  error: ['Falha na pesquisa', 'Research failed'],
};
const contentStatus: Record<EditorialContent['status'], [string, string]> = {
  planning: ['Roteiro pendente', 'Script needed'],
  generating: ['Gerando roteiro', 'Generating script'],
  'script-review': ['Roteiro para revisão', 'Review script'],
  'script-approved': ['Roteiro aprovado', 'Script approved'],
  error: ['Falha no roteiro', 'Script failed'],
};

export function ContentStudio({
  selectedContentId,
  onOpenSession,
  onCreateAgent,
}: {
  selectedContentId?: string | null;
  onOpenSession: (agentId: string, sessionId: string) => void;
  onCreateAgent: () => void;
}) {
  const { currentWorkspaceId, currentWorkspace } = useWorkspaces();
  const { locale } = useLanguage();
  const pt = locale === 'pt-BR';
  const { agents: allAgents } = useAgents();
  const {
    state,
    ready,
    storageError,
    createTopic,
    runResearch,
    reviseTopic,
    decideTopic,
    runScript,
    approveScript,
  } = useContentWorkflow();
  const agents = allAgents.filter((agent) => agent.workspaceId === currentWorkspaceId);
  const researchAgents = agents.filter((agent) => agent.tools.includes('web-search'));
  const [inputKind, setInputKind] = useState<'text' | 'url' | 'ideas'>('text');
  const [input, setInput] = useState('');
  const [category, setCategory] = useState(locale === 'pt-BR' ? 'IA e tecnologia' : 'AI and technology');
  const [priority, setPriority] = useState<'normal' | 'urgent'>('normal');
  const [researchAgentId, setResearchAgentId] = useState('');
  const [scriptAgentId, setScriptAgentId] = useState('');
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [format, setFormat] = useState<ContentFormat>('short-video');
  const [plannedAt, setPlannedAt] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>(['Instagram', 'TikTok']);
  const [decisionNotes, setDecisionNotes] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editSummary, setEditSummary] = useState('');
  const [editWhy, setEditWhy] = useState('');
  const [editAngles, setEditAngles] = useState('');
  const [hook, setHook] = useState('');
  const [cta, setCta] = useState('');
  const [pathTitle, setPathTitle] = useState('');
  const [pathOutline, setPathOutline] = useState('');
  const [scriptText, setScriptText] = useState('');
  const [thumbnail, setThumbnail] = useState('');
  const [improv, setImprov] = useState('');
  const topics = useMemo(
    () =>
      state.topics
        .filter((item) => item.workspaceId === currentWorkspaceId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [currentWorkspaceId, state.topics],
  );
  const linkedContent = selectedContentId
    ? state.contents.find((item) => item.id === selectedContentId && item.workspaceId === currentWorkspaceId)
    : undefined;
  const topic = topics.find((item) => item.id === (selectedTopicId ?? linkedContent?.topicId)) ?? topics[0];
  const content = topic?.contentId ? state.contents.find((item) => item.id === topic.contentId) : undefined;
  const optionsArtifact = content?.scriptOptionsArtifactId
    ? state.artifacts.find((item) => item.id === content.scriptOptionsArtifactId)
    : undefined;
  const options =
    optionsArtifact?.type === 'script-options' ? (optionsArtifact.data as ScriptOptions) : undefined;
  const approvedArtifact = content?.approvedScriptArtifactId
    ? state.artifacts.find((item) => item.id === content.approvedScriptArtifactId)
    : undefined;
  const approvedScript =
    approvedArtifact?.type === 'script' ? (approvedArtifact.data as ApprovedScript) : undefined;
  const runs = state.runs
    .filter(
      (item) =>
        item.topicId === topic?.id || item.topicId === topic?.requestId || item.contentId === content?.id,
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const topicApprovals = state.approvals
    .filter((item) => item.topicId === topic?.id)
    .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
  const versions = state.artifacts
    .filter((item) => item.contentId === content?.id && item.type === 'script')
    .sort((a, b) => b.version - a.version);

  useEffect(() => {
    if (!researchAgents.some((agent) => agent.id === researchAgentId))
      setResearchAgentId(researchAgents[0]?.id ?? '');
  }, [researchAgentId, researchAgents]);
  useEffect(() => {
    if (!agents.some((agent) => agent.id === scriptAgentId)) setScriptAgentId(agents[0]?.id ?? '');
  }, [agents, scriptAgentId]);
  useEffect(() => {
    setEditTitle(topic?.title ?? '');
    setEditSummary(topic?.summary ?? '');
    setEditWhy(topic?.whyItMatters ?? '');
    setEditAngles(topic?.angles.join('\n') ?? '');
    setDecisionNotes('');
  }, [topic?.id, topic?.researchArtifactId]);
  useEffect(() => {
    if (!options) return;
    setHook(options.hooks[0] ?? '');
    setCta(options.ctas[0] ?? '');
    setPathTitle(options.paths[0]?.title ?? '');
    setPathOutline(options.paths[0]?.outline ?? '');
    setScriptText(options.draftScript);
    setThumbnail(options.thumbnailDirection);
    setImprov(options.improvisationTopics.join('\n'));
  }, [optionsArtifact?.id]);

  useEffect(() => {
    if (linkedContent) setSelectedTopicId(linkedContent.topicId);
  }, [linkedContent?.id]);
  const step = content?.status === 'script-approved' ? 3 : content ? 2 : topic?.researchArtifactId ? 1 : 0;
  const steps = pt
    ? ['Pesquisar pauta', 'Decidir pauta', 'Revisar roteiro', 'Roteiro aprovado']
    : ['Research topic', 'Decide on topic', 'Review script', 'Script approved'];
  const action = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setFeedback('');
    try {
      await work();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action(async () => {
      const created = await createTopic({
        workspaceId: currentWorkspaceId,
        inputKind,
        input,
        category,
        priority,
      });
      setSelectedTopicId(created.id);
      setInput('');
      if (!researchAgentId) {
        setFeedback(
          pt
            ? 'Pauta salva. Crie um agente com Pesquisa na Web para pesquisá-la.'
            : 'Topic saved. Create an agent with Web Search to research it.',
        );
        return;
      }
      await runResearch(created.id, researchAgentId);
    });
  };
  const togglePlatform = (platform: Platform) =>
    setSelectedPlatforms((current) =>
      current.includes(platform) ? current.filter((item) => item !== platform) : [...current, platform],
    );
  const approve = () => {
    if (!topic) return;
    void action(async () => {
      await decideTopic(topic.id, 'approved', decisionNotes, format, selectedPlatforms, plannedAt);
      setFeedback(
        pt
          ? 'Pauta aprovada. Agora gere as opções de roteiro.'
          : 'Topic approved. Generate script options next.',
      );
    });
  };
  const reject = () => {
    if (!topic) return;
    void action(async () => {
      await decideTopic(topic.id, 'rejected', decisionNotes);
      setFeedback(pt ? 'Decisão registrada.' : 'Decision saved.');
    });
  };
  const approveCurrentScript = () => {
    if (!content) return;
    const script: ApprovedScript = {
      hook,
      cta,
      path: { title: pathTitle, outline: pathOutline },
      text: scriptText,
      improvisationTopics: improv
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      thumbnailDirection: thumbnail,
    };
    void action(async () => {
      await approveScript(content.id, script, decisionNotes);
      setFeedback(
        pt
          ? 'Esta versão do roteiro foi aprovada e guardada.'
          : 'This script version was approved and saved.',
      );
    });
  };

  return (
    <div className="page content-studio-page">
      <header className="page-head">
        <div>
          <p className="eyebrow">{currentWorkspace.name}</p>
          <h1>{pt ? 'Estúdio de conteúdo' : 'Content Studio'}</h1>
          <p>
            {pt
              ? 'Da pauta ao roteiro aprovado, com fontes, versões e decisões no mesmo lugar.'
              : 'Take a topic to an approved script with sources, versions and decisions together.'}
          </p>
        </div>
      </header>
      {storageError && (
        <p className="editorial-alert" role="alert">
          {storageError}
        </p>
      )}
      {feedback && (
        <p className="editorial-alert" role="status">
          {feedback}
        </p>
      )}
      <ol className="editorial-progress" aria-label={pt ? 'Etapas de produção' : 'Production stages'}>
        {steps.map((label, index) => (
          <li
            key={label}
            className={index < step ? 'complete' : index === step ? 'current' : ''}
            aria-current={index === step ? 'step' : undefined}
          >
            <span>{index < step ? '✓' : index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <div className="editorial-grid">
        <aside className="editorial-rail">
          <form className="editorial-card editorial-intake" onSubmit={submit}>
            <h2>{pt ? 'Nova pauta' : 'New topic'}</h2>
            <div
              className="editorial-segment"
              role="group"
              aria-label={pt ? 'Tipo de entrada' : 'Input type'}
            >
              {(['text', 'url', 'ideas'] as const).map((kind) => (
                <button
                  type="button"
                  key={kind}
                  aria-pressed={inputKind === kind}
                  onClick={() => setInputKind(kind)}
                >
                  {kind === 'text'
                    ? pt
                      ? 'Ideia'
                      : 'Idea'
                    : kind === 'url'
                      ? 'Link'
                      : pt
                        ? 'Propor ideias'
                        : 'Suggest ideas'}
                </button>
              ))}
            </div>
            <label className="editorial-field">
              <span>
                {inputKind === 'ideas'
                  ? pt
                    ? 'Direção opcional'
                    : 'Optional brief'
                  : inputKind === 'url'
                    ? 'URL'
                    : pt
                      ? 'Ideia ou contexto'
                      : 'Idea or brief'}
              </span>
              <textarea
                rows={inputKind === 'url' ? 2 : 3}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={
                  inputKind === 'url'
                    ? 'https://...'
                    : inputKind === 'ideas'
                      ? pt
                        ? 'Ex.: tendências de automação para esta semana'
                        : 'e.g. automation trends this week'
                      : pt
                        ? 'O que aconteceu ou o que você quer investigar?'
                        : 'What happened or what do you want to explore?'
                }
              />
            </label>
            <details className="editorial-intake-options">
              <summary>{pt ? 'Categoria e prioridade' : 'Category and priority'}</summary>
              <div>
                {' '}
                <label className="editorial-field">
                  <span>{pt ? 'Categoria' : 'Category'}</span>
                  <input value={category} onChange={(event) => setCategory(event.target.value)} />
                </label>
                <label className="editorial-field">
                  <span>{pt ? 'Prioridade' : 'Priority'}</span>
                  <SelectMenu
                    ariaLabel={pt ? 'Prioridade' : 'Priority'}
                    value={priority}
                    onChange={(value) => setPriority(value as 'normal' | 'urgent')}
                    options={[
                      { value: 'normal', label: pt ? 'Normal' : 'Normal' },
                      { value: 'urgent', label: pt ? 'Urgente' : 'Urgent' },
                    ]}
                  />
                </label>
              </div>
            </details>
            <label className="editorial-field">
              <span>{pt ? 'Agente de pesquisa' : 'Research agent'}</span>
              <SelectMenu
                ariaLabel={pt ? 'Agente de pesquisa' : 'Research agent'}
                value={researchAgentId}
                onChange={setResearchAgentId}
                options={
                  researchAgents.length
                    ? researchAgents.map((agent) => ({
                        value: agent.id,
                        label: `${agent.name} · ${agent.providerId ?? 'codex'}`,
                      }))
                    : [
                        {
                          value: '',
                          label: pt ? 'Nenhum agente com Pesquisa na Web' : 'No agent with Web Search',
                        },
                      ]
                }
              />
            </label>
            {!researchAgents.length && (
              <p className="editorial-hint">
                {pt
                  ? 'A pauta pode ser salva sem pesquisar. Para pesquisar, crie um agente com Pesquisa na Web.'
                  : 'You can save a topic without researching it. To research, create an agent with Web Search.'}
                <button className="text-link" type="button" onClick={onCreateAgent}>
                  {pt ? 'Criar agente' : 'Create agent'}
                </button>
              </p>
            )}
            <button
              className="primary-button"
              type="submit"
              disabled={!ready || busy || (inputKind !== 'ideas' && !input.trim())}
            >
              <Icon name="spark" />
              {busy
                ? pt
                  ? 'Aguarde…'
                  : 'Working…'
                : researchAgentId
                  ? pt
                    ? 'Criar e pesquisar'
                    : 'Create and research'
                  : pt
                    ? 'Salvar pauta'
                    : 'Save topic'}
            </button>
          </form>
          <div className="editorial-card editorial-list">
            <div className="editorial-section-head">
              <h2>{pt ? 'Pautas' : 'Topics'}</h2>
              <span>{topics.length}</span>
            </div>
            {topics.length ? (
              topics.map((item) => (
                <button
                  className={`editorial-list-item ${topic?.id === item.id ? 'active' : ''}`}
                  key={item.id}
                  onClick={() => setSelectedTopicId(item.id)}
                >
                  <span className="editorial-list-title">{item.title}</span>
                  <span className="editorial-meta">
                    {item.priority === 'urgent' ? '● ' : ''}
                    {pt ? topicStatus[item.status][0] : topicStatus[item.status][1]} · {item.category}
                  </span>
                </button>
              ))
            ) : (
              <p className="editorial-empty">
                {pt
                  ? 'Crie uma pauta ou peça sugestões para começar.'
                  : 'Create a topic or ask for suggestions to begin.'}
              </p>
            )}
          </div>
        </aside>
        <main className="editorial-detail">
          {!topic ? (
            <div className="editorial-card editorial-empty-large">
              <Icon name="script" />
              <h2>{pt ? 'Seu fluxo editorial começa aqui' : 'Your editorial workflow starts here'}</h2>
              <p>
                {pt
                  ? 'Envie um link, uma ideia ou peça pautas com fontes.'
                  : 'Send a link, an idea, or ask for sourced topic proposals.'}
              </p>
            </div>
          ) : (
            <>
              <section className="editorial-card">
                <div className="editorial-section-head">
                  <div>
                    <span className="editorial-kicker">
                      {pt ? 'PAUTA' : 'TOPIC'} ·{' '}
                      {topic.priority === 'urgent' ? (pt ? 'URGENTE' : 'URGENT') : topic.category}
                    </span>
                    <h2>{topic.title}</h2>
                  </div>
                  <span className={`editorial-state ${topic.status}`}>
                    {pt ? topicStatus[topic.status][0] : topicStatus[topic.status][1]}
                  </span>
                </div>
                <p className="editorial-provenance">
                  {pt ? 'Entrada original' : 'Original input'}:{' '}
                  {topic.originUrl ? (
                    <a href={topic.originUrl} target="_blank" rel="noreferrer">
                      {topic.originUrl}
                    </a>
                  ) : (
                    topic.input
                  )}
                </p>
                {topic.lastError && (
                  <p className="editorial-alert" role="alert">
                    {topic.lastError}
                  </p>
                )}
                {!topic.researchArtifactId && (
                  <div className="editorial-actions">
                    <button
                      className="primary-button"
                      disabled={busy || !researchAgentId}
                      onClick={() => void action(() => runResearch(topic.id, researchAgentId))}
                    >
                      {topic.status === 'error'
                        ? pt
                          ? 'Tentar pesquisa novamente'
                          : 'Retry research'
                        : pt
                          ? 'Pesquisar pauta'
                          : 'Research topic'}
                    </button>
                  </div>
                )}
                {topic.researchArtifactId && (
                  <>
                    <div className="editorial-copy">
                      <h3>{pt ? 'Resumo' : 'Summary'}</h3>
                      <p>{topic.summary}</p>
                      <h3>{pt ? 'Por que importa' : 'Why it matters'}</h3>
                      <p>{topic.whyItMatters}</p>
                      <h3>{pt ? 'Ângulos possíveis' : 'Possible angles'}</h3>
                      <ul>
                        {topic.angles.map((angle, index) => (
                          <li key={index}>{angle}</li>
                        ))}
                      </ul>
                      <h3>{pt ? 'Fontes para conferir' : 'Sources to verify'}</h3>
                      <ul>
                        {topic.sources.map((source, index) => (
                          <li key={index}>
                            <a href={source.url} target="_blank" rel="noreferrer">
                              {source.title}
                            </a>
                          </li>
                        ))}
                      </ul>
                      {topic.factualQuestions.length > 0 && (
                        <>
                          <h3>{pt ? 'Questões ainda abertas' : 'Open factual questions'}</h3>
                          <ul>
                            {topic.factualQuestions.map((question, index) => (
                              <li key={index}>{question}</li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                    {topic.status === 'review' && (
                      <div className="editorial-review">
                        <h3>{pt ? 'Ajustar e decidir' : 'Edit and decide'}</h3>
                        <p className="editorial-hint">
                          {pt
                            ? 'Confira as fontes antes de aprovar. Salvar ajustes cria uma nova versão da pauta.'
                            : 'Check the sources before approval. Saving changes creates a new topic version.'}
                        </p>
                        <div className="editorial-two">
                          <label className="editorial-field">
                            <span>{pt ? 'Título' : 'Title'}</span>
                            <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} />
                          </label>
                          <label className="editorial-field">
                            <span>{pt ? 'Por que importa' : 'Why it matters'}</span>
                            <input value={editWhy} onChange={(event) => setEditWhy(event.target.value)} />
                          </label>
                        </div>
                        <label className="editorial-field">
                          <span>{pt ? 'Resumo' : 'Summary'}</span>
                          <textarea
                            rows={3}
                            value={editSummary}
                            onChange={(event) => setEditSummary(event.target.value)}
                          />
                        </label>
                        <label className="editorial-field">
                          <span>{pt ? 'Ângulos (um por linha)' : 'Angles (one per line)'}</span>
                          <textarea
                            rows={3}
                            value={editAngles}
                            onChange={(event) => setEditAngles(event.target.value)}
                          />
                        </label>
                        <button
                          className="soft-button"
                          disabled={busy}
                          onClick={() =>
                            void action(() =>
                              reviseTopic(topic.id, {
                                title: editTitle,
                                summary: editSummary,
                                whyItMatters: editWhy,
                                angles: editAngles.split('\n'),
                              }),
                            )
                          }
                        >
                          {pt ? 'Salvar ajustes' : 'Save edits'}
                        </button>
                        <div className="editorial-divider" />
                        <label className="editorial-field">
                          <span>{pt ? 'Data pretendida (opcional)' : 'Planned date (optional)'}</span>
                          <input
                            type="date"
                            value={plannedAt}
                            onChange={(event) => setPlannedAt(event.target.value)}
                          />
                        </label>
                        <div className="editorial-two">
                          <label className="editorial-field">
                            <span>{pt ? 'Formato' : 'Format'}</span>
                            <SelectMenu
                              ariaLabel={pt ? 'Formato' : 'Format'}
                              value={format}
                              onChange={(value) => setFormat(value as ContentFormat)}
                              options={[
                                { value: 'short-video', label: pt ? 'Vídeo curto' : 'Short video' },
                                { value: 'long-video', label: pt ? 'Vídeo longo' : 'Long video' },
                                { value: 'carousel', label: pt ? 'Carrossel' : 'Carousel' },
                              ]}
                            />
                          </label>
                          <div className="editorial-field">
                            <span>{pt ? 'Plataformas' : 'Platforms'}</span>
                            <div className="editorial-checks">
                              {platforms.map((platform) => (
                                <label key={platform}>
                                  <input
                                    type="checkbox"
                                    checked={selectedPlatforms.includes(platform)}
                                    onChange={() => togglePlatform(platform)}
                                  />
                                  {platform}
                                </label>
                              ))}
                            </div>
                          </div>
                        </div>
                        <label className="editorial-field">
                          <span>{pt ? 'Observação da decisão' : 'Decision note'}</span>
                          <textarea
                            rows={2}
                            value={decisionNotes}
                            onChange={(event) => setDecisionNotes(event.target.value)}
                          />
                        </label>
                        <div className="editorial-actions">
                          <button
                            className="primary-button"
                            disabled={busy || !selectedPlatforms.length}
                            onClick={approve}
                          >
                            {pt ? 'Aprovar pauta' : 'Approve topic'}
                          </button>
                          <button className="soft-button" disabled={busy} onClick={reject}>
                            {pt ? 'Descartar pauta' : 'Reject topic'}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </section>
              {content && (
                <section className="editorial-card">
                  <div className="editorial-section-head">
                    <div>
                      <span className="editorial-kicker">{pt ? 'CARD DE CONTEÚDO' : 'CONTENT CARD'}</span>
                      <h2>{content.title}</h2>
                      <p className="editorial-meta">
                        {content.format} · {content.platforms.join(' / ')}
                        {content.plannedAt ? ` · ${content.plannedAt}` : ''}
                      </p>
                    </div>
                    <span className={`editorial-state ${content.status}`}>
                      {pt ? contentStatus[content.status][0] : contentStatus[content.status][1]}
                    </span>
                  </div>
                  {content.lastError && (
                    <p className="editorial-alert" role="alert">
                      {content.lastError}
                    </p>
                  )}
                  <div className="editorial-two editorial-run-row">
                    <label className="editorial-field">
                      <span>{pt ? 'Agente de roteiro' : 'Script agent'}</span>
                      <SelectMenu
                        ariaLabel={pt ? 'Agente de roteiro' : 'Script agent'}
                        value={scriptAgentId}
                        onChange={setScriptAgentId}
                        options={
                          agents.length
                            ? agents.map((agent) => ({
                                value: agent.id,
                                label: `${agent.name} · ${agent.providerId ?? 'codex'}`,
                              }))
                            : [{ value: '', label: pt ? 'Crie um agente' : 'Create an agent' }]
                        }
                      />
                    </label>
                    <button
                      className="soft-button"
                      disabled={busy || !scriptAgentId || content.status === 'generating'}
                      onClick={() => void action(() => runScript(content.id, scriptAgentId))}
                    >
                      {content.scriptOptionsArtifactId
                        ? pt
                          ? 'Gerar nova versão de opções'
                          : 'Generate new options'
                        : pt
                          ? 'Gerar opções de roteiro'
                          : 'Generate script options'}
                    </button>
                  </div>
                  {options && (
                    <div className="editorial-review">
                      <h3>{pt ? 'Compare e escolha' : 'Compare and choose'}</h3>
                      <p className="editorial-hint">
                        {pt
                          ? 'Escolha uma opção em cada grupo e ajuste o texto antes da aprovação.'
                          : 'Choose an option in each group and edit the text before approval.'}
                      </p>
                      <div className="editorial-choice">
                        <strong>Hooks · {options.hooks.length}</strong>
                        {options.hooks.map((item, index) => (
                          <button
                            type="button"
                            key={index}
                            aria-pressed={hook === item}
                            onClick={() => setHook(item)}
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                      <label className="editorial-field">
                        <span>Hook {pt ? 'escolhido/editado' : 'selected/edited'}</span>
                        <input value={hook} onChange={(event) => setHook(event.target.value)} />
                      </label>
                      <div className="editorial-choice">
                        <strong>
                          {pt ? 'Caminhos de condução' : 'Narrative paths'} · {options.paths.length}
                        </strong>
                        {options.paths.map((item, index) => (
                          <button
                            type="button"
                            key={index}
                            aria-pressed={pathTitle === item.title}
                            onClick={() => {
                              setPathTitle(item.title);
                              setPathOutline(item.outline);
                            }}
                          >
                            <b>{item.title}</b>
                            <span>{item.outline}</span>
                          </button>
                        ))}
                      </div>
                      <div className="editorial-two">
                        <label className="editorial-field">
                          <span>{pt ? 'Caminho escolhido' : 'Selected path'}</span>
                          <input value={pathTitle} onChange={(event) => setPathTitle(event.target.value)} />
                        </label>
                        <label className="editorial-field">
                          <span>{pt ? 'Estrutura' : 'Outline'}</span>
                          <textarea
                            rows={3}
                            value={pathOutline}
                            onChange={(event) => setPathOutline(event.target.value)}
                          />
                        </label>
                      </div>
                      <div className="editorial-choice">
                        <strong>CTAs · {options.ctas.length}</strong>
                        {options.ctas.map((item, index) => (
                          <button
                            type="button"
                            key={index}
                            aria-pressed={cta === item}
                            onClick={() => setCta(item)}
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                      <label className="editorial-field">
                        <span>CTA {pt ? 'escolhido/editado' : 'selected/edited'}</span>
                        <input value={cta} onChange={(event) => setCta(event.target.value)} />
                      </label>
                      <div className="editorial-two">
                        <label className="editorial-field">
                          <span>{pt ? 'Tópicos para improvisar' : 'Improvisation topics'}</span>
                          <textarea
                            rows={4}
                            value={improv}
                            onChange={(event) => setImprov(event.target.value)}
                          />
                        </label>
                        <label className="editorial-field">
                          <span>{pt ? 'Direção de capa/thumb' : 'Cover/thumbnail direction'}</span>
                          <textarea
                            rows={4}
                            value={thumbnail}
                            onChange={(event) => setThumbnail(event.target.value)}
                          />
                        </label>
                      </div>
                      <label className="editorial-field">
                        <span>{pt ? 'Roteiro final editável' : 'Editable final script'}</span>
                        <textarea
                          className="editorial-script"
                          rows={13}
                          value={scriptText}
                          onChange={(event) => setScriptText(event.target.value)}
                        />
                      </label>
                      <label className="editorial-field">
                        <span>{pt ? 'Observação de aprovação' : 'Approval note'}</span>
                        <textarea
                          rows={2}
                          value={decisionNotes}
                          onChange={(event) => setDecisionNotes(event.target.value)}
                        />
                      </label>
                      <button
                        className="primary-button"
                        disabled={busy || content.status === 'generating' || scriptText.trim().length < 80}
                        onClick={approveCurrentScript}
                      >
                        {pt
                          ? `Aprovar versão ${versions.length + 1}`
                          : `Approve version ${versions.length + 1}`}
                      </button>
                    </div>
                  )}
                  {approvedScript && (
                    <div className="editorial-approved">
                      <h3>
                        {pt
                          ? `Roteiro aprovado · versão ${approvedArtifact?.version}`
                          : `Approved script · version ${approvedArtifact?.version}`}
                      </h3>
                      <p>{approvedScript.text}</p>
                      <small>
                        {pt ? 'Hook' : 'Hook'}: {approvedScript.hook} · CTA: {approvedScript.cta}
                      </small>
                    </div>
                  )}
                  {versions.length > 0 && (
                    <div className="editorial-history">
                      <h3>{pt ? 'Versões guardadas' : 'Saved versions'}</h3>
                      {versions.map((artifact) => (
                        <details key={artifact.id}>
                          <summary>
                            {pt ? 'Versão' : 'Version'} {artifact.version} ·{' '}
                            {new Date(artifact.createdAt).toLocaleString(locale)}{' '}
                            {state.approvals.some(
                              (approval) =>
                                approval.artifactId === artifact.id && approval.decision === 'approved',
                            )
                              ? '✓'
                              : ''}
                          </summary>
                          <pre>{(artifact.data as ApprovedScript).text}</pre>
                        </details>
                      ))}
                    </div>
                  )}
                </section>
              )}
              {(runs.length > 0 || topicApprovals.length > 0) && (
                <section className="editorial-card editorial-history">
                  <h2>{pt ? 'Sessões e decisões' : 'Sessions and decisions'}</h2>
                  {runs.map((run) => (
                    <div className="editorial-history-row" key={run.id}>
                      <span>
                        {run.stage === 'research'
                          ? pt
                            ? 'Pesquisa'
                            : 'Research'
                          : pt
                            ? 'Roteiro'
                            : 'Script'}{' '}
                        · {run.providerId}
                        {run.modelId ? ` / ${run.modelId}` : ''} · {run.state}
                      </span>
                      {run.sessionId && (
                        <button
                          className="text-link"
                          onClick={() => {
                            if (run.sessionId) onOpenSession(run.agentId, run.sessionId);
                          }}
                        >
                          {pt ? 'Abrir sessão' : 'Open session'}
                        </button>
                      )}
                      {run.error && <small>{run.error}</small>}
                    </div>
                  ))}
                  {topicApprovals.map((approval) => (
                    <div className="editorial-history-row" key={approval.id}>
                      <span>
                        {approval.decision === 'approved'
                          ? pt
                            ? 'Aprovado'
                            : 'Approved'
                          : pt
                            ? 'Descartado'
                            : 'Rejected'}{' '}
                        · {pt ? 'artefato' : 'artifact'} v{approval.artifactVersion} ·{' '}
                        {new Date(approval.decidedAt).toLocaleString(locale)}
                      </span>
                      {approval.notes && <small>{approval.notes}</small>}
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
