import {useStudioDraftField,studioDraftKey,clearStudioDraft} from '../features/content/studioDrafts';
import {CarouselReview} from '../components/content/CarouselReview';
import {carouselScript} from '../../editorial-protocol.mjs';
import type {CarouselDraft} from '../features/content/model';
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
import {useCanvas} from '../components/canvas/CanvasProvider';
import {ContentAssetLibrary} from '../components/content/ContentAssetLibrary';
import {EditorialWorkPanel} from '../components/content/EditorialWorkPanel';
import {ContentPublications} from '../components/content/ContentPublications';
import {PublicationCalendar} from '../components/content/PublicationCalendar';
import {usePersistentState} from '../data/localPersistence';
import {ContentMediaEditor} from '../components/content/ContentMediaEditor';
import {ScriptDeliveryReview} from '../components/chat/ChatDeliveryCard';
import type {EditorialArtifact} from '../features/content/model';
import {networkLogos} from '../assets/networkLogos';

const platforms: Platform[] = ['Instagram', 'TikTok', 'YouTube', 'LinkedIn'];
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
  'script-rejected': ['Roteiro rejeitado', 'Script rejected'],
  error: ['Falha no roteiro', 'Script failed'],
};

export function ContentStudio({
  selectedContentId,
  selectedTopicId: requestedTopicId,
  onOpenSession,
  onCreateAgent,
}: {
  selectedContentId?: string | null;
  selectedTopicId?: string | null;
  onOpenSession: (agentId: string, sessionId: string) => void;
  onCreateAgent: () => void;
}) {
  const { currentWorkspaceId, currentWorkspace } = useWorkspaces();
  const { locale } = useLanguage();
  const pt = locale === 'pt-BR';
  const [view,setView]=usePersistentState<'studio'|'calendar'>('studio-view','studio');
  const [reviewArtifact,setReviewArtifact]=useState<EditorialArtifact|null>(null);
  useEffect(()=>{const open=()=>setView('calendar');window.addEventListener('mainsagents:publication-calendar',open);return()=>window.removeEventListener('mainsagents:publication-calendar',open)},[]);
  useEffect(()=>{if(selectedContentId||requestedTopicId)setView('studio')},[selectedContentId,requestedTopicId]);
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
    jobs,getNotionConnection,configureNotion,retryJob,setProductionStage,
  } = useContentWorkflow();
  const {allNodes,addNode,updateNodeData}=useCanvas();
  const agents = allAgents.filter((agent) => agent.workspaceId === currentWorkspaceId);
  const researchAgents = agents.filter((agent) => agent.tools.includes('web-search'));
  const intakeScope=studioDraftKey('intake',currentWorkspaceId);
  const [inputKind, setInputKind] = useStudioDraftField<'text' | 'url' | 'ideas'>(intakeScope,'inputKind','text');
  const [input, setInput] = useStudioDraftField<string>(intakeScope,'input','');
  const [category, setCategory] = useStudioDraftField<string>(intakeScope,'category',locale === 'pt-BR' ? 'IA e tecnologia' : 'AI and technology');
  const [priority, setPriority] = useStudioDraftField<'normal' | 'urgent'>(intakeScope,'priority','normal');
  const [researchAgentId, setResearchAgentId] = useStudioDraftField<string>(intakeScope,'researchAgentId','');
  const [scriptAgentId, setScriptAgentId] = useStudioDraftField<string>(intakeScope,'scriptAgentId','');
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(requestedTopicId ?? null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [topicFilter,setTopicFilter]=useState<'all'|'review'|'researching'|'approved'>('all');
  const [notionId,setNotionId]=useState('');
  const [syncNotion,setSyncNotion]=useState(false);
  const [connectionReady,setConnectionReady]=useState(false);
  useEffect(()=>{
    let active=true;setConnectionReady(false);
    void getNotionConnection(currentWorkspaceId).then(config=>{if(active){setNotionId(config.dataSourceId||config.suggestedDataSourceId||'');setSyncNotion(config.autoSync);setConnectionReady(true)}}).catch(error=>{if(active)setFeedback(error.message)});
    return()=>{active=false};
  },[currentWorkspaceId,getNotionConnection]);
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
  const visibleTopics=topics.filter(item=>topicFilter==='all'||item.status===topicFilter);
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
  const topicScope=studioDraftKey('topic-review',currentWorkspaceId,topic?.id??'none',topic?.researchArtifactId??'none');
  const scriptScope=studioDraftKey('script-review',currentWorkspaceId,content?.id??topic?.id??'none',optionsArtifact?.id??'none',approvedArtifact?.id??'none');
  const [format,setFormat]=useStudioDraftField<ContentFormat>(topicScope,'format','short-video');
  const [plannedAt,setPlannedAt]=useStudioDraftField<string>(topicScope,'plannedAt','');
  const [selectedPlatforms,setSelectedPlatforms]=useStudioDraftField<Platform[]>(topicScope,'platforms',['Instagram','TikTok']);
  const [decisionNotes,setDecisionNotes]=useStudioDraftField<string>(options?scriptScope:topicScope,'notes','');
  const [editTitle,setEditTitle]=useStudioDraftField<string>(topicScope,'title',topic?.title??'');
  const [editSummary,setEditSummary]=useStudioDraftField<string>(topicScope,'summary',topic?.summary??'');
  const [editWhy,setEditWhy]=useStudioDraftField<string>(topicScope,'why',topic?.whyItMatters??'');
  const [editAngles,setEditAngles]=useStudioDraftField<string>(topicScope,'angles',topic?.angles.join('\n')??'');
  const [hook,setHook]=useStudioDraftField<string>(scriptScope,'hook',approvedScript?.hook??options?.hooks[0]??'');
  const [cta,setCta]=useStudioDraftField<string>(scriptScope,'cta',approvedScript?.cta??options?.ctas[0]??'');
  const [pathTitle,setPathTitle]=useStudioDraftField<string>(scriptScope,'pathTitle',approvedScript?.path.title??options?.paths[0]?.title??'');
  const [pathOutline,setPathOutline]=useStudioDraftField<string>(scriptScope,'pathOutline',approvedScript?.path.outline??options?.paths[0]?.outline??'');
  const [scriptText,setScriptText]=useStudioDraftField<string>(scriptScope,'text',approvedScript?.text??options?.draftScript??'');
  const [thumbnail,setThumbnail]=useStudioDraftField<string>(scriptScope,'thumbnail',approvedScript?.thumbnailDirection??options?.thumbnailDirection??'');
  const [improv,setImprov]=useStudioDraftField<string>(scriptScope,'improv',(approvedScript?.improvisationTopics??options?.improvisationTopics??[]).join('\n'));
  const initialCarousel=content?.status==='script-approved'?approvedScript?.carousel??options?.carousel:options?.carousel??approvedScript?.carousel;
  const structuredCarousel=content?.format==='carousel'&&!!initialCarousel;
  const [carouselJson,setCarouselJson]=useStudioDraftField<string>(scriptScope,'carousel',JSON.stringify(initialCarousel??null));
  let carouselDraft:CarouselDraft|undefined,carouselError='';
  if(structuredCarousel)try{
    const parsed=JSON.parse(carouselJson);
    if(!parsed||!Array.isArray(parsed.slides)||parsed.slides.length>20||!parsed.slides.every((slide:CarouselDraft['slides'][number])=>slide&&['title','text','imageBrief'].every(key=>typeof slide[key as keyof typeof slide]==='string')&&Array.isArray(slide.sourceUrls)&&slide.sourceUrls.every(url=>typeof url==='string'))||typeof parsed.caption!=='string')throw new Error('Invalid saved carousel draft. Restore the generated draft to review it.');
    carouselDraft=parsed;carouselScript(parsed,topic?.sources);
  }catch(error){carouselError=(error as Error).message;}
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
    if (!options) return;
    setHook(approvedScript?.hook??options.hooks[0] ?? '');
    setCta(approvedScript?.cta??options.ctas[0] ?? '');
    setPathTitle(approvedScript?.path.title??options.paths[0]?.title ?? '');
    setPathOutline(approvedScript?.path.outline??options.paths[0]?.outline ?? '');
    setScriptText(approvedScript?.text??options.draftScript);
    setThumbnail(approvedScript?.thumbnailDirection??options.thumbnailDirection);
    setImprov((approvedScript?.improvisationTopics??options.improvisationTopics).join('\n'));
  }, [optionsArtifact?.id,approvedArtifact?.id]);

  useEffect(() => {
    setSelectedTopicId(linkedContent?.topicId ?? requestedTopicId ?? null);
  }, [linkedContent?.id, requestedTopicId]);
  const notionConfirmed=jobs.some(job=>job.contentId===content?.id&&job.result);
  const step = approvedArtifact ? (notionConfirmed?5:4) : content ? 3 : topic?.researchArtifactId ? 2 : topic?.status==='researching'?1:0;
  const completeSteps=[!!topic,!!topic?.researchArtifactId,topic?.status==='approved',!!optionsArtifact,!!approvedArtifact,notionConfirmed];
  const steps = pt
    ? ['Pauta','Pesquisa','Decisão','Roteiro','Aprovado','Notion']
    : ['Topic','Research','Decision','Script','Approved','Notion'];
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
      setSelectedTopicId(created.id);setTopicFilter('all');
      clearStudioDraft(intakeScope);
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
      await configureNotion(currentWorkspaceId,{dataSourceId:notionId.trim().replace(/^collection:\/\//,''),autoSync:syncNotion});
      const destination=notionId.trim().replace(/^collection:\/\//,'').replaceAll('-','').toLowerCase().replace(/^(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})$/,'$1-$2-$3-$4-$5');
      await approveScript(content.id, structuredCarousel?carouselScript(carouselDraft,topic?.sources):script, decisionNotes,syncNotion,optionsArtifact?{artifact:optionsArtifact,destination}:undefined);
      setFeedback(
        pt
          ? syncNotion?'Roteiro aprovado. A criação do card está na fila; acompanhe a confirmação abaixo.':'Esta versão do roteiro foi aprovada e guardada.'
          : syncNotion?'Script approved. The Notion card is queued; follow its confirmation below.':'This script version was approved and saved.',
      );
    });
  };

  return (
    <div className="page content-studio-page">
      <header className="page-head">
        <div>
          <p className="eyebrow">{currentWorkspace.name}</p>
          <h1 data-od-id="studio-heading">{view==='calendar'?(pt?'Calendário de postagens':'Publishing calendar'):(pt ? 'Estúdio de conteúdo' : 'Content Studio')}</h1>
          <p>
            {view==='calendar'?(pt?'Conteúdo, canais e horários. Tudo no mesmo lugar.':'Content, channels and timing. All in one place.'):pt
              ? 'Da ideia à publicação: pesquisa, decisão, roteiro e entregas por rede.'
              : 'From idea to publication: research, decisions, scripts and channel deliverables.'}
          </p>
        </div>
      <div className="studio-page-actions"><div className="editorial-segment content-studio-tabs" aria-label={pt?'Visão do Estúdio':'Studio view'}><button type="button" aria-pressed={view==='studio'} onClick={()=>setView('studio')}>{pt?'Produção':'Production'}</button><button type="button" aria-pressed={view==='calendar'} onClick={()=>setView('calendar')}>{pt?'Calendário':'Calendar'}</button></div>{view==='studio'&&<button className="primary-button" onClick={()=>{document.querySelector<HTMLTextAreaElement>('.editorial-intake textarea')?.focus();document.querySelector('.editorial-intake')?.scrollIntoView({block:'nearest',behavior:'smooth'});}}><Icon name="plus"/>{pt?'Nova pauta':'New topic'}</button>}</div></header>
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

      {view==='calendar'?<PublicationCalendar key={currentWorkspaceId} workspaceId={currentWorkspaceId}/>:<>

      <form className="editorial-card editorial-intake" aria-label={pt?"Nova pauta":"New topic"} onSubmit={submit}>
            <h2>{pt ? 'Nova pauta' : 'New topic'}</h2>
            <div className="studio-intake-header"><div
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
            </div><p>{pt?'A pesquisa abre uma sessão do agente e traz fontes e ângulos.':'Research opens an agent session with sources and angles.'}</p></div>
            <label className="editorial-field studio-intake-brief">
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
                rows={1}
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
            <label className="editorial-field studio-intake-category"><span>{pt?'Categoria':'Category'}</span><input value={category} onChange={event=>setCategory(event.target.value)}/></label>
<details className="editorial-intake-options"><summary>{pt?'Prioridade':'Priority'}</summary><SelectMenu ariaLabel={pt?'Prioridade':'Priority'} value={priority} onChange={value=>setPriority(value as 'normal'|'urgent')} options={[{value:'normal',label:pt?'Normal':'Normal'},{value:'urgent',label:pt?'Urgente':'Urgent'}]}/></details>
            <label className="editorial-field studio-intake-agent">
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
              className="primary-button studio-intake-submit"
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
                    ? 'Pesquisar'
                    : 'Research'
                  : pt
                    ? 'Salvar pauta'
                    : 'Save topic'}
            </button>
          </form>
<div className="editorial-grid">
        <aside className="editorial-rail">

          <div className="editorial-card editorial-list">
            <div className="editorial-section-head">
              <h2>{pt ? 'Pautas' : 'Topics'}</h2>
              <span>{topics.length} {pt?'pautas':'topics'}</span>
            </div><div className="studio-topic-filters" role="group" aria-label={pt?'Filtrar pautas':'Filter topics'}>{(['all','review','researching','approved'] as const).map(filter=><button type="button" key={filter} aria-pressed={topicFilter===filter} onClick={()=>setTopicFilter(filter)}>{({all:pt?'Todas':'All',review:pt?'Para decidir':'Review',researching:pt?'Pesquisando':'Researching',approved:pt?'Aprovadas':'Approved'})[filter]}<span>{filter==='all'?topics.length:topics.filter(item=>item.status===filter).length}</span></button>)}</div>
            {visibleTopics.length ? (
              visibleTopics.map((item) => (
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
                <ol className="editorial-progress" aria-label={pt ? 'Etapas de produção' : 'Production stages'}>
        {steps.map((label, index) => (
          <li
            key={label}
            className={completeSteps[index] ? 'complete' : index === step ? 'current' : ''}
            aria-current={index === step ? 'step' : undefined}
          >
            <span>{index < step ? '✓' : index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
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
                    <div className="studio-topic-body"><div className="editorial-copy">
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
                    </div><aside className="studio-topic-meta"><div><span>{pt?'Formato':'Format'}</span><strong>{(content?.format??format)==='carousel'?(pt?'Carrossel':'Carousel'):(content?.format??format)==='long-video'?(pt?'Vídeo longo':'Long video'):(pt?'Vídeo curto':'Short video')}</strong></div><div><span>{pt?'Redes':'Networks'}</span><div className="studio-network-badges">{(content?.platforms??selectedPlatforms).map(platform=><span key={platform}><img src={networkLogos[platform.toLowerCase()]} alt=""/>{platform}</span>)}</div></div><div><span>{pt?'Agente de pesquisa':'Research agent'}</span><strong>{agents.find(agent=>agent.id===(runs.find(run=>run.stage==='research')?.agentId??researchAgentId))?.name??(pt?'Não definido':'Not selected')}</strong></div><div><span>{pt?'Publicação planejada':'Planned publication'}</span><strong>{content?.plannedAt||plannedAt||(pt?'Não definida':'Not planned')}</strong></div><div><span>Notion</span>{jobs.find(job=>job.contentId===content?.id&&job.result)?.result?.url?<a href={jobs.find(job=>job.contentId===content?.id&&job.result)!.result!.url} target="_blank" rel="noopener noreferrer">{pt?'Abrir card confirmado':'Open confirmed card'}</a>:<small>{pt?'Card não vinculado':'No card linked'}</small>}</div></aside></div>
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
              {content && <ContentAssetLibrary key={content.id} content={content}/>}
              {content && <ContentMediaEditor key={`media-${content.id}`} content={content}/>}
              {content && <ContentPublications key={`publications-${content.id}`} content={content}/>}
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
                      {optionsArtifact&&<button className="soft-button" type="button" disabled={busy||content.status==='generating'} onClick={()=>setReviewArtifact(structuredClone(optionsArtifact))}>{pt?'Pedir ajuste ou rejeitar':'Request changes or reject'}</button>}
                      {structuredCarousel?<>
                        {carouselDraft&&<CarouselReview value={carouselDraft} pt={pt} onChange={value=>setCarouselJson(JSON.stringify(value))}/>}
                        {carouselError&&<p className="delivery-error" role="alert">{carouselError}</p>}
                        {!carouselDraft&&<button className="soft-button" onClick={()=>setCarouselJson(JSON.stringify(initialCarousel))}>{pt?'Restaurar rascunho gerado':'Restore generated draft'}</button>}
                      </>:<>
                      <h3>{pt ? 'Compare e escolha' : 'Compare and choose'}</h3>
                      <p className="editorial-hint">
                        {syncNotion?(pt?'Aprovar e criar card no Notion':'Approve and create Notion card'):pt
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
                      </>}
                      <label className="editorial-field">
                        <span>{pt ? 'Observação de aprovação' : 'Approval note'}</span>
                        <textarea
                          rows={2}
                          value={decisionNotes}
                          onChange={(event) => setDecisionNotes(event.target.value)}
                        />
                      </label>
                      <div className="editorial-notion-settings">
                        <h3>{pt?'Destino no Notion':'Notion destination'}</h3>
                        <label htmlFor="editorial-notion-source">{pt?'ID da base (data source)':'Data source ID'}</label>
                        <input id="editorial-notion-source" value={notionId} disabled={busy||!connectionReady} placeholder="collection://…" onChange={event=>setNotionId(event.target.value)} />
                        <label className="editorial-notion-toggle"><input type="checkbox" checked={syncNotion} disabled={busy||!connectionReady||!notionId.trim()} onChange={event=>setSyncNotion(event.target.checked)}/><span>{pt?'Ao aprovar, criar/atualizar o card desta versão':'On approval, create/update the card for this version'}</span></label>
                        <small>{pt?'Usa sua conexão Notion MCP do Codex. Não agenda nem publica conteúdo.':'Uses your Codex Notion MCP connection. Does not schedule or publish content.'}</small>
                      </div>
                      <button
                        className="primary-button"
                        disabled={busy || !connectionReady || content.status === 'generating' || (structuredCarousel?!!carouselError:scriptText.trim().length < 80)}
                        onClick={approveCurrentScript}
                      >
                        {pt
                          ? structuredCarousel?(syncNotion?'Aprovar carrossel e enviar ao Notion':'Aprovar carrossel'):syncNotion?'Aprovar roteiro e enviar ao Notion':'Aprovar roteiro'
                          : structuredCarousel?(syncNotion?'Approve carousel and send to Notion':'Approve carousel'):syncNotion?'Approve script and send to Notion':'Approve script'}
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
                      {approvedScript.carousel?<CarouselReview value={approvedScript.carousel} pt={pt} readOnly/>:<p>{approvedScript.text}</p>}
                      <small>
                        {pt ? 'Hook' : 'Hook'}: {approvedScript.hook} · CTA: {approvedScript.cta}
                      </small>
                      <div className="editorial-actions">
                        <SelectMenu ariaLabel={pt?'Etapa de produção':'Production stage'} value={content.productionStage??'ready-to-record'} options={[
                          {value:'planning',label:pt?'Planejamento':'Planning'},
                          {value:'ready-to-record',label:pt?'Pronto para gravar':'Ready to record'},
                          {value:'recording',label:pt?'Gravando':'Recording'},
                          {value:'editing',label:pt?'Em edição':'Editing'},
                          {value:'video-review',label:pt?'Revisar vídeo':'Video review'},
                          {value:'ready',label:pt?'Pronto':'Ready'},
                          {value:'archived',label:pt?'Arquivado':'Archived'},
                        ]} onChange={value=>void action(()=>setProductionStage(content.id,value as NonNullable<EditorialContent['productionStage']>))}/>
                        <button className="soft-button" type="button" disabled={busy} onClick={()=>{
                          const existing=allNodes.find(item=>item.workspaceId===currentWorkspaceId&&item.node.data.artifactId===approvedArtifact?.id);
                          if(!existing){const nodeId=addNode('script');updateNodeData(currentWorkspaceId,nodeId,{contentId:content.id,artifactId:approvedArtifact?.id,title:content.title,preview:approvedScript.text,wordCount:approvedScript.text.trim().split(/\s+/).length,meta:`v${approvedArtifact?.version}`});}
                          window.location.hash='canvas';
                        }}><Icon name="canvas"/>{pt?'Abrir roteiro no Canvas':'Open script on Canvas'}</button>
                      </div>
                    </div>
                  )}
                  {jobs.filter(job=>job.contentId===content.id).map(job=><div className="editorial-notion-job" key={job.id} role="status">
                    <strong>{job.status==='succeeded'?(pt?'Card confirmado no Notion':'Notion card confirmed'):job.status==='failed'?(pt?'Precisa de atenção':'Needs attention'):job.status==='running'?(pt?'Preparando e verificando o card…':'Preparing and verifying the card…'):job.status==='canceled'?(pt?'Cancelado':'Canceled'):(pt?'Aguardando execução':'Queued')}</strong>
                    {job.result&&<><small>{pt?'Versão':'Version'} {job.result.artifactVersion} · {new Date(job.result.verifiedAt).toLocaleString(locale)}</small><a className="text-link" href={job.result.url} target="_blank" rel="noreferrer">{pt?'Abrir card no Notion':'Open Notion card'}</a></>}
                    {job.error&&<p>{job.error}</p>}
                    {job.status==='failed'&&<button className="soft-button" disabled={busy||!connectionReady||!syncNotion} onClick={()=>void action(async()=>{await configureNotion(currentWorkspaceId,{dataSourceId:notionId.trim().replace(/^collection:\/\//,''),autoSync:syncNotion});await retryJob(job.id)})}>{pt?'Verificar e tentar novamente':'Verify and retry'}</button>}
                  </div>)}
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
                          {(artifact.data as ApprovedScript).carousel?<CarouselReview value={(artifact.data as ApprovedScript).carousel!} pt={pt} readOnly/>:<pre>{(artifact.data as ApprovedScript).text}</pre>}
                        </details>
                      ))}
                    </div>
                  )}
                </section>
              )}
              <EditorialWorkPanel key={topic.id} topicId={topic.id} content={content}/>
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
                          : run.stage==='handoff' ? (pt?'Transferência':'Handoff') : pt
                            ? 'Roteiro'
                            : 'Script'}{' '}
                        · {run.providerId}
                        {run.modelId ? ` / ${run.modelId}` : ''} · {run.state}
                      </span>
                      {run.sessionId && !run.jobId && (
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
                          : approval.decision==='revision-requested'?(pt?'Ajuste solicitado':'Changes requested'):pt
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
      </>}
      {reviewArtifact&&<ScriptDeliveryReview artifact={reviewArtifact} initialDecision="revision-requested" onClose={()=>setReviewArtifact(null)}/>}
    </div>
  );
}
