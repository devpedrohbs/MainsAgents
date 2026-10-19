import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { Agent, AgentEditorValues, AgentTool } from '../../features/agents/model/Agent';
import { agentToolDetails } from '../../features/agents/model/Agent';
import { Icon } from '../common/Icon';
import { AgentAvatar } from './AgentAvatar';
import { useWorkspaces } from '../../app/WorkspaceProvider';
import { useLanguage } from '../../app/LanguageProvider';
import { SelectMenu } from '../common/SelectMenu';
import { readPersistentValue, updatePersistentValue } from '../../data/localPersistence';
import { storageProfile } from '../../data/IndexedDbStateStore';
import { adoptLegacyAgentDraft, agentDraftKey, agentDraftStorageKey, legacyAgentDraftKey, putAgentDraft, restoreAgentDraft, type AgentDraftMap } from '../../features/agents/agentDrafts';
import {paperVisualStyle} from '../../../paper-design.mjs';
import {validPublishingAutomation} from '../../../publishing-automation.mjs';

const tools = Object.keys(agentToolDetails) as AgentTool[];
const defaultPaperDesign:NonNullable<AgentEditorValues['paperDesign']>={enabled:false,automatic:false,fileId:'',fileName:'',signature:'',visualStyle:paperVisualStyle};
const emptyValues: AgentEditorValues = {
  name: '',
  role: '',
  description: '',
  instructions: '',
  workspaceId: 'content',
  tools: ['web-search', 'files', 'canvas-context'],
  skillsDirectory: '',
  skills: [],
  disabledSkills: [],
  skillsInstallKey: '',
  avatarImage: '',
};

interface AgentEditorDrawerProps {
  agent?: Agent;
  initialValues?: Partial<AgentEditorValues>;
  onClose: () => void;
  onSave: (values: AgentEditorValues) => void;
  onDelete?: () => void;
  onOpenProviderSettings?:()=>void;
}

export function AgentEditorDrawer({ agent, initialValues, onClose, onSave, onDelete, onOpenProviderSettings }: AgentEditorDrawerProps) {
  const { workspaces, currentWorkspaceId } = useWorkspaces();
  const {locale,t,focusMode}=useLanguage();
  // Draft scope: profile + workspace + this agent, or this workspace's creation slot (never shared, never another workspace).
  const [draftScope]=useState(()=>({profile:storageProfile(),workspaceId:agent?.workspaceId??currentWorkspaceId,agentId:agent?.id,template:agent?undefined:initialValues?.name}));
  const [values, setValues] = useState<AgentEditorValues>(()=>{
    const fallback=agent ? pickValues(agent) : { ...emptyValues, ...initialValues, workspaceId: currentWorkspaceId };
    let drafts=readPersistentValue<AgentDraftMap>(agentDraftStorageKey,{});
    if(agent&&!drafts[agentDraftKey(draftScope)]){
      let raw:string|null=null;try{raw=sessionStorage.getItem(legacyAgentDraftKey(agent.id))}catch{/* Browser storage may be blocked. */}
      const legacy=adoptLegacyAgentDraft(raw,{...draftScope,agentWorkspaceId:agent.workspaceId});
      if(legacy){drafts=putAgentDraft(drafts,draftScope,{...fallback,...legacy});updatePersistentValue<AgentDraftMap>(agentDraftStorageKey,{},current=>putAgentDraft(current,draftScope,{...fallback,...legacy}));try{sessionStorage.removeItem(legacyAgentDraftKey(agent.id))}catch{/* Optional cleanup. */}}
    }
    return restoreAgentDraft(drafts,draftScope,fallback);
  });
  const [error, setError] = useState('');
  const [editorSection,setEditorSection]=useState('identity');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [skillCommands,setSkillCommands]=useState(()=>[{id:Date.now(),command:''}]);
  const [skillStatus, setSkillStatus] = useState('');
  const [installingSkill, setInstallingSkill] = useState(false);
  const [refreshingSkills,setRefreshingSkills]=useState(false);
  const [models,setModels]=useState<readonly {id:string;name:string}[]>([]);
  const [providerError,setProviderError]=useState('');
  const [connectingPaper,setConnectingPaper]=useState(false);
  const [paperStatus,setPaperStatus]=useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const avatarInputRef=useRef<HTMLInputElement>(null);
  const originRef = useRef<HTMLElement|null>(document.activeElement as HTMLElement);
  const editing = Boolean(agent);
  const providerId=values.providerId??'codex';
  const sectionComplete:Record<string,boolean>={identity:!!values.name.trim()&&!!values.role.trim(),behavior:!!values.instructions.trim(),provider:providerId!=='gemini'||!!values.modelId,tools:true,skills:true,permissions:true,notion:!values.notionAutomation?.enabled||/^(?:collection:\/\/)?[a-f0-9-]{32,36}$/i.test(values.notionAutomation.dataSourceId.trim()),paper:!values.paperDesign?.enabled||!!values.paperDesign.fileId.trim(),publishing:!values.publishingAutomation?.enabled||validPublishingAutomation(values.publishingAutomation)};
  const completeSectionCount=Object.values(sectionComplete).filter(Boolean).length;
  const original=agent?pickValues(agent):{...emptyValues,...initialValues,workspaceId:currentWorkspaceId};
  const dirty=JSON.stringify(values)!==JSON.stringify(original);
  const close=()=>{if(dirty&&!window.confirm(locale==='pt-BR'?'Fechar e guardar este rascunho para continuar depois?':'Close and keep this draft for later?'))return;onClose();};
  const drawerRef=useRef<HTMLElement>(null);
  // Focus returns to the trigger however the drawer closes (Escape, close, save or delete).
  useEffect(()=>()=>{const origin=originRef.current;requestAnimationFrame(()=>{if(origin?.isConnected)origin.focus()})},[]);
  useEffect(()=>{updatePersistentValue<AgentDraftMap>(agentDraftStorageKey,{},current=>putAgentDraft(current,draftScope,dirty?values:undefined))},[dirty,draftScope,values]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();close();}
      // Tab stays inside the drawer (a dialog opened above it contains its own focus).
      if(event.key==='Tab'&&!event.defaultPrevented&&drawerRef.current&&!document.querySelector('.flow-dialog')){
        const elements=Array.from(drawerRef.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,a[href],[tabindex="0"]')).filter(item=>item.tabIndex>=0&&item.getClientRects().length);
        const first=elements[0],last=elements.at(-1),active=document.activeElement;
        if(!first)return;
        if(!drawerRef.current.contains(active)){event.preventDefault();first.focus();}
        else if(event.shiftKey&&active===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&active===last){event.preventDefault();first.focus();}
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });
  useEffect(()=>{requestAnimationFrame(()=>nameRef.current?.focus())},[]);
  useEffect(()=>{let active=true;setModels([]);setProviderError('');const url=providerId==='codex'?'/api/codex/models':`/api/providers/${providerId}/models`;void fetch(url).then(async(response)=>{const data=await response.json();if(!response.ok)throw new Error(data.error??'Could not list models');if(active)setModels(data.models??[])}).catch((error)=>{if(active)setProviderError(error instanceof Error?error.message:String(error))});return()=>{active=false}},[providerId]);

  const setField = <K extends keyof AgentEditorValues>(field: K, value: AgentEditorValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }));
    setError('');
  };

  const toggleTool = (tool: AgentTool) => {
    setField('tools', values.tools.includes(tool) ? values.tools.filter((item) => item !== tool) : [...values.tools, tool]);
  };
  const paper=values.paperDesign??defaultPaperDesign;
  // Always merged into the CURRENT values: a slow connection must not undo a signature or style typed meanwhile.
  const setPaper=(patch:Partial<typeof paper>)=>{setValues(current=>({...current,paperDesign:{...(current.paperDesign??defaultPaperDesign),...patch}}));setError('');};
  const latestPaper=useRef(paper);latestPaper.current=paper;
  const mounted=useRef(true),paperLookup=useRef(0);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const connectPaper=async()=>{
    const lookup=++paperLookup.current,current=()=>mounted.current&&lookup===paperLookup.current;
    setConnectingPaper(true);setPaperStatus('');
    try{const response=await fetch('/api/providers/claude/paper');const data=await response.json();if(!response.ok)throw Error(data.error??'Não foi possível conectar ao Paper.');
      // A closed drawer or a newer lookup owns the result.
      if(!current())return;
      const dropped=data.fileId!==latestPaper.current.fileId&&latestPaper.current.automatic;
      // A different file never inherits the no-repeat grant given to the previous one.
      setValues(values=>{const previous=values.paperDesign??defaultPaperDesign;return {...values,paperDesign:{...previous,fileId:data.fileId,fileName:data.fileName,enabled:true,...(data.fileId!==previous.fileId?{automatic:false}:{})}};});
      setError('');
      setPaperStatus(locale==='pt-BR'?`Arquivo conectado${dropped?'; confirme de novo a opção sem confirmações repetidas':''}. Salve o agente para usar no chat.`:`File connected${dropped?'; enable the no-repeat option again for this file':''}. Save the agent to use it in chat.`);}
    catch(error){if(current())setPaperStatus(error instanceof Error?error.message:String(error));}
    finally{if(current())setConnectingPaper(false);}
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!values.name.trim() || !values.role.trim()) {
      setError(t('Name and role are required.'));
      return;
    }
    if(providerId==='gemini'&&!values.modelId){setEditorSection('provider');setError(t('Choose a provider model after connecting it in Settings.'));return}
    if(values.paperDesign?.enabled&&(!values.paperDesign.fileId.trim()||providerId==='gemini')){setEditorSection('paper');setError(locale==='pt-BR'?'Conecte um arquivo do Paper e escolha Claude ou Codex.':'Connect a Paper file and choose Claude or Codex.');return;}
    if(providerId==='codex'&&values.fileAccess?.enabled&&(!values.tools.includes('files')||!(/^[a-z]:[\\/]/i.test(values.fileAccess.outputDirectory.trim())||values.fileAccess.outputDirectory.trim().startsWith('/')))){setEditorSection('permissions');setError(locale==='pt-BR'?'Escolha uma pasta de saída absoluta e mantenha Files habilitado.':'Choose an absolute output folder and keep Files enabled.');return;}
    if(values.notionAutomation?.enabled&&!/^(?:collection:\/\/)?[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}$/i.test(values.notionAutomation.dataSourceId.trim())){setEditorSection('notion');setError(locale==='pt-BR'?'Informe o ID da coleção ou sua URL collection://, e não o link de uma página.':'Enter the data source ID or collection:// URL, not a page link.');return;}
    if(values.publishingAutomation&&!validPublishingAutomation(values.publishingAutomation)){setEditorSection('publishing');setError(locale==='pt-BR'?'Use um fuso IANA válido no Agendamento, como America/Sao_Paulo.':'Use a valid IANA time zone in Scheduling, such as America/Sao_Paulo.');return;}
    updatePersistentValue<AgentDraftMap>(agentDraftStorageKey,{},current=>putAgentDraft(current,draftScope,undefined));
    onSave({ ...values, skillsInstallKey:values.skillsInstallKey||agent?.id||`agent-${Date.now().toString(36)}`, name: values.name.trim(), role: values.role.trim(), description: values.description.trim(), instructions: values.instructions.trim() });
  };

  const applySkillResult = (result: SkillDirectoryResult,skillsInstallKey?:string,resetExclusions=false) => {
    setValues((current) => {
      const disabled=resetExclusions?[]:(current.disabledSkills??[]);
      return { ...current, skillsDirectory: result.directory, skills: result.skills.map((skill) => skill.name).filter((name)=>!disabled.includes(name)), skillFiles:Object.fromEntries(result.skills.filter(skill=>skill.filePath).map(skill=>[skill.name,skill.filePath!])), disabledSkills:disabled,...(skillsInstallKey?{skillsInstallKey}:{}) };
    });
    setSkillStatus(result.skills.length ? `${result.skills.length} skill${result.skills.length === 1 ? '' : 's'}.` : t('No Markdown skills found in this folder.'));
  };

  const selectSkillDirectory = async () => {
    if (!window.mainsAgentsDesktop) { setSkillStatus(t('Folder selection is available in the desktop app.')); return; }
    const result = await window.mainsAgentsDesktop.selectSkillDirectory();
    if (result) applySkillResult(result,undefined,true);
  };

  const installAgentSkill = async (id:number) => {
    const command=skillCommands.find((item)=>item.id===id)?.command.trim()??'';
    if (!command || !window.mainsAgentsDesktop) { setSkillStatus(t(window.mainsAgentsDesktop ? 'Enter an npx skills add command.' : 'Skill installation is available in the desktop app.')); return; }
    setInstallingSkill(true);
    setSkillStatus(t('Installing…'));
    try { const key=values.skillsInstallKey||agent?.id||values.name;const result = await window.mainsAgentsDesktop.installSkill(command,key,values.skillsDirectory||undefined); applySkillResult(result,key);setSkillCommands((current)=>current.map((item)=>item.id===id?{...item,command:''}:item)); }
    catch (error) { setSkillStatus(error instanceof Error ? error.message : t('Could not install this skill.')); }
    finally { setInstallingSkill(false); }
  };

  const refreshSkills=async()=>{
    if(!values.skillsDirectory||!window.mainsAgentsDesktop)return;
    setRefreshingSkills(true);
    try{applySkillResult(await window.mainsAgentsDesktop.refreshSkillDirectory(values.skillsDirectory));}
    catch(error){setSkillStatus(error instanceof Error?error.message:t('Could not refresh skills.'));}
    finally{setRefreshingSkills(false);}
  };

  const addSkillCommand=()=>setSkillCommands((current)=>[...current,{id:Date.now()+current.length,command:''}]);
  const removeAssociatedSkill=(skill:string)=>setValues((current)=>({...current,skills:(current.skills??[]).filter((name)=>name!==skill),disabledSkills:[...new Set([...(current.disabledSkills??[]),skill])]}));
  const restoreAssociatedSkill=(skill:string)=>setValues((current)=>({...current,skills:[...new Set([...(current.skills??[]),skill])],disabledSkills:(current.disabledSkills??[]).filter((name)=>name!==skill)}));

  const chooseAvatar=async(event:ChangeEvent<HTMLInputElement>)=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;if(!file.type.startsWith('image/')){setError(t('Choose an image file.'));return}if(file.size>10*1024*1024){setError(t('Choose an image smaller than 10 MB.'));return}try{const image=await createImageBitmap(file);const size=256;const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;const context=canvas.getContext('2d');if(!context)throw new Error('Could not read this image.');const crop=Math.min(image.width,image.height);context.drawImage(image,(image.width-crop)/2,(image.height-crop)/2,crop,crop,0,0,size,size);setField('avatarImage',canvas.toDataURL('image/jpeg',.84));image.close()}catch(error){setError(error instanceof Error?error.message:t('Could not read this image.'))}};

  return (
    <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <aside ref={drawerRef} className={`agent-drawer ${focusMode?'focus-writing':''}`} role="dialog" aria-modal="true" aria-labelledby="agent-editor-title">
        <header className="drawer-head">
          <div className="drawer-identity">
            <AgentAvatar name={values.name || (locale==='pt-BR'?'Novo Agente':'New Agent')} image={values.avatarImage} />
            <div><p>{t(editing ? 'Agent configuration' : 'New specialist')}</p><h2 id="agent-editor-title">{editing ? agent?.name : t('Create agent')}</h2></div>
          </div>
          <button className="icon-button" type="button" onClick={close} aria-label="Close agent editor">×</button>
        </header>

        <form className="drawer-form" onSubmit={submit} onInvalidCapture={event=>{event.preventDefault();const target=event.target as HTMLInputElement,section=target.closest<HTMLElement>('[data-editor-section]')?.dataset.editorSection;if(section)setEditorSection(section);setError(t('Name and role are required.'));requestAnimationFrame(()=>target.focus());}}>
          <nav className="agent-editor-nav" aria-label={locale==='pt-BR'?'Seções da configuração':'Configuration sections'}>{[
            ['identity','users',t('Identity')],['behavior','note',t('Behavior')],['provider','spark',locale==='pt-BR'?'Provedor de IA':'AI provider'],['tools','settings',t('Tools')],['skills','folder',t('Skills')],['permissions','settings',locale==='pt-BR'?'Permissões MCP':'MCP permissions'],['notion','link','Notion'],['paper','note','Paper'],['publishing','calendar',locale==='pt-BR'?'Agendamento':'Scheduling'],
          ].map(([id,,label],index)=><button key={id} type="button" aria-pressed={editorSection===id} onClick={()=>setEditorSection(id)}><span className="agent-section-marker" data-complete={sectionComplete[id]} aria-hidden="true">{sectionComplete[id]?'✓':index+1}</span>{label}</button>)}</nav>
          <div className="drawer-scroll">
            {providerId==='codex'&&editorSection==='permissions'&&<section className="drawer-section" data-editor-section="permissions"><div className="drawer-section-title"><b>{locale==='pt-BR'?'Arquivos locais':'Local files'}</b><span>{locale==='pt-BR'?'Autorize este agente a criar arquivos na pasta escolhida.':'Allow this agent to create files in the chosen folder.'}</span></div><label className="delivery-notion-choice"><input type="checkbox" checked={values.fileAccess?.enabled??false} onChange={event=>setValues(current=>({...current,fileAccess:{enabled:event.target.checked,outputDirectory:current.fileAccess?.outputDirectory??''},tools:event.target.checked?[...new Set([...current.tools,'files' as const])]:current.tools}))}/>{locale==='pt-BR'?'Permitir salvar e editar arquivos locais':'Allow saving and editing local files'}</label>{values.fileAccess?.enabled&&<label className="field"><span>{locale==='pt-BR'?'Pasta de saída autorizada':'Authorized output folder'}</span><div className="skill-path-row"><input value={values.fileAccess.outputDirectory} onChange={event=>setField('fileAccess',{enabled:true,outputDirectory:event.target.value})} placeholder="C:\…"/><button className="soft-button" type="button" disabled={!window.mainsAgentsDesktop?.selectOutputDirectory} onClick={()=>void window.mainsAgentsDesktop?.selectOutputDirectory?.().then(path=>{if(path)setField('fileAccess',{enabled:true,outputDirectory:path})})}>{locale==='pt-BR'?'Escolher pasta':'Choose folder'}</button></div></label>}<p className="skill-status">{locale==='pt-BR'?'O Codex usará esta pasta como diretório de trabalho. Os originais em outras pastas permanecem somente leitura. Publicar agora continua pedindo sua aprovação; agendamentos seguem a seção Agendamento.':'Codex uses this folder as its working directory. Originals in other folders remain read-only. Publishing now still asks for your approval; scheduling follows the Scheduling section.'}</p></section>}
            {editorSection==='skills'&&providerId==='gemini'&&<p className="skill-status">{locale==='pt-BR'?'As skills locais são disponibilizadas pelos provedores CLI, Codex e Claude.':'Local skills are provided by the Codex and Claude CLI providers.'}</p>}
            {editorSection==='notion'&&providerId==='gemini'&&<p className="skill-status">{locale==='pt-BR'?'A autorização automática Notion deste app está disponível para agentes Codex CLI e Claude Code CLI.':'This app’s automatic Notion permission is available to Codex CLI and Claude Code CLI agents.'}</p>}
            <section className="drawer-section" data-editor-section="identity" hidden={editorSection!=='identity'}>
              <div className="drawer-section-title"><b>{t('Identity')}</b><span>{t('How this agent appears across the workspace.')}</span></div>
              <div className="agent-avatar-editor"><AgentAvatar name={values.name||(locale==='pt-BR'?'Novo Agente':'New Agent')} image={values.avatarImage}/><div><b>{t('Profile image')}</b><span>{t('Add a photo or illustrated icon to recognize this agent.')}</span><div><button className="soft-button" type="button" onClick={()=>avatarInputRef.current?.click()}>{t(values.avatarImage?'Change image':'Choose image')}</button>{values.avatarImage&&<button className="soft-button" type="button" onClick={()=>setField('avatarImage','')}>{t('Remove')}</button>}</div><input ref={avatarInputRef} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event)=>void chooseAvatar(event)}/></div></div>
              <label className="field"><span>{t('Name')} *</span><input ref={nameRef} required value={values.name} onChange={(event) => setField('name', event.target.value)} placeholder={locale==='pt-BR'?'ex.: Editor de Pesquisa':'e.g. Research Editor'} /></label>
              <label className="field"><span>{t('Role')} *</span><input required value={values.role} onChange={(event) => setField('role', event.target.value)} placeholder={locale==='pt-BR'?'ex.: Pesquisador editorial':'e.g. Editorial researcher'} /></label>
              <label className="field"><span>{t('Description')}</span><textarea rows={3} value={values.description} onChange={(event) => setField('description', event.target.value)} placeholder={locale==='pt-BR'?'Uma explicação breve do que este agente faz.':'A concise explanation of what this agent does.'} /></label>
            </section>

            <section className="drawer-section" data-editor-section="behavior" hidden={editorSection!=='behavior'}>
              <div className="drawer-section-title"><b>{t('Behavior')}</b><span>{t('Set the permanent context this agent should follow.')}</span></div>
              <label className="field"><span>{t('Instructions')}</span><textarea className="instructions-input" rows={7} value={values.instructions} onChange={(event) => setField('instructions', event.target.value)} placeholder={locale==='pt-BR'?'Descreva objetivos, processo, restrições e resultado esperado.':'Describe goals, process, constraints, and expected output.'} /></label>
              <div className="field"><span>{t('Workspace')}</span><SelectMenu className="field-select" value={values.workspaceId} onChange={(value) => setField('workspaceId', value)} ariaLabel={t('Workspace')} options={workspaces.map((workspace)=>({value:workspace.id,label:workspace.name}))}/></div>
            </section>

            <section className="drawer-section" data-editor-section="provider" hidden={editorSection!=='provider'}>
              <div className="drawer-section-title"><b>{t('AI provider')}</b><span>{t('Choose who answers and how usage is billed.')}</span></div>
              <div className="field"><span>{t('Provider')}</span><SelectMenu className="field-select" value={providerId} onChange={(value)=>{setField('providerId',value as AgentEditorValues['providerId']);setField('modelId','')}} ariaLabel={t('Provider')} options={[{value:'codex',label:'Codex CLI · ChatGPT/Codex'},{value:'claude',label:'Claude Code CLI'},{value:'gemini',label:'Gemini · Google AI API'}]}/></div>
              <div className="field"><span>{t('Model')}</span><SelectMenu className="field-select" value={values.modelId??''} onChange={(value)=>setField('modelId',value)} ariaLabel={t('Model')} options={[{value:'',label:t(providerId==='gemini'?'Choose a model':'Provider default')},...models.map((model)=>({value:model.id,label:model.name}))]}/></div>
              <p className="provider-billing">{t(providerId==='codex'?'Uses your Codex CLI login and plan.':providerId==='claude'?'Uses your Claude Code CLI authentication and provider billing.':'Uses your own API key and provider billing.')}</p>
              {providerError&&<div className="provider-error"><span>{providerError}</span>{onOpenProviderSettings&&<button type="button" onClick={onOpenProviderSettings}>{t('Open connection settings')}</button>}</div>}
            </section>

            <section className="drawer-section" data-editor-section="tools" hidden={editorSection!=='tools'}>
              <div className="drawer-section-title"><b>{t('Tools')}</b><span>{t('Choose what this agent can access in the prototype.')}</span></div>
              {providerId!=='gemini'?<div className="tool-grid">{tools.map((tool) => { const detail = agentToolDetails[tool]; const selected = values.tools.includes(tool); return <button className={`tool-option ${selected ? 'selected' : ''}`} type="button" aria-pressed={selected} key={tool} onClick={() => toggleTool(tool)}><span className="tool-check">{selected ? '✓' : ''}</span><span><b>{t(detail.label)}</b><small>{providerId==='claude'&&tool==='subagents'?(locale==='pt-BR'?'Envio manual ao especialista pelo app.':'Manual handoff to a specialist from the app.'):t(detail.description)}</small></span></button>; })}</div>:<p className="provider-billing">{t('Canvas context is sent as text. Web, file and subagent tools are unavailable for this provider.')}</p>}
            </section>

            {(providerId==='codex'||providerId==='claude')&&<section className="drawer-section" data-editor-section="skills" hidden={editorSection!=='skills'}>
              <div className="drawer-section-title"><b>{t('Skills')}</b><span>{t('Install skills for this agent using an npx command, or point it to an existing skills folder.')}</span></div>
              <label className="field"><span>{t('Skills folder')}</span><div className="skill-path-row"><input value={values.skillsDirectory ?? ''} readOnly placeholder={t('No folder selected')}/><button className="soft-button" type="button" disabled={installingSkill||refreshingSkills} onClick={selectSkillDirectory}>{t('Choose folder')}</button><button className="soft-button" type="button" disabled={!values.skillsDirectory||installingSkill||refreshingSkills} onClick={refreshSkills}>{t(refreshingSkills?'Refreshing…':'Reload skills')}</button></div></label>
              <p className="skill-status">{t('Choose a folder with .md files or SKILL.md skill folders.')}</p>
              <div className="agent-skill-installer"><span className="field-label">{t('Install with npx')}</span>{skillCommands.map((item,index)=><div className="skill-command-row" key={item.id}><input aria-label={`${t('Skill install command')} ${index+1}`} value={item.command} onChange={(event)=>setSkillCommands((current)=>current.map((row)=>row.id===item.id?{...row,command:event.target.value}:row))} onKeyDown={(event)=>{if(event.key==='Enter'){event.preventDefault();void installAgentSkill(item.id)}}} placeholder="npx skills add owner/repository"/><button className="soft-button" type="button" disabled={installingSkill} onClick={()=>void installAgentSkill(item.id)}>{t(installingSkill?'Installing…':'Add & install')}</button>{skillCommands.length>1&&<button className="icon-button remove-skill-command" type="button" disabled={installingSkill} aria-label={t('Remove skill command')} onClick={()=>setSkillCommands((current)=>current.filter((row)=>row.id!==item.id))}>×</button>}</div>)}<button className="add-skill-command" type="button" disabled={installingSkill} onClick={addSkillCommand}><Icon name="plus"/>{t('Add another skill')}</button></div>
              {(values.skills?.length??0)>0&&<div className="agent-skill-list" aria-label={locale==='pt-BR'?'Skills vinculadas':'Associated skills'}>{values.skills?.map((skill)=><div className="agent-skill-item" key={skill}><span className="agent-skill-glyph">/</span><span className="agent-skill-name">{skill}</span><button className="agent-skill-remove" type="button" onClick={()=>removeAssociatedSkill(skill)} aria-label={locale==='pt-BR'?`Desvincular ${skill} deste agente`:`Remove ${skill} from this agent`} title={locale==='pt-BR'?'Desvincular do agente':'Remove from agent'}>×</button></div>)}</div>}
              {(values.disabledSkills?.length??0)>0&&<div className="agent-skill-disabled"><span>{locale==='pt-BR'?'Desvinculadas deste agente':'Removed from this agent'}</span>{values.disabledSkills?.map((skill)=><button key={skill} className="soft-button" type="button" onClick={()=>restoreAssociatedSkill(skill)}>{locale==='pt-BR'?`Restaurar /${skill}`:`Restore /${skill}`}</button>)}</div>}
              <p className="skill-status">{locale==='pt-BR'?'Desvincular não apaga os arquivos da skill. Salve o agente para aplicar a mudança.':'Removing a skill does not delete its files. Save the agent to apply the change.'}</p>
              {skillStatus&&<p className="skill-status">{skillStatus}</p>}
            </section>}

          {(providerId==='codex'||providerId==='claude')&&<section className="drawer-section" data-editor-section="permissions" hidden={editorSection!=='permissions'} style={{padding:'0 24px 16px'}}><h3>{locale==='pt-BR'?'Permissões das ferramentas MCP':'MCP tool permissions'}</h3><p className="skill-status">{locale==='pt-BR'?'Ações desmarcadas nunca rodam. As permitidas pedem sua aprovação a cada chamada, exceto o que você liberou nas seções Notion, Paper e Agendamento.':'Unchecked actions never run. Permitted ones ask for your approval on each call, except what you enabled in the Notion, Paper and Scheduling sections.'}</p>{(['read','write','schedule','publish','delete','unknown'] as const).map((kind,index)=><label className="delivery-notion-choice" key={kind}><input type="checkbox" checked={(values.mcpPermissions??['read','write','schedule','publish','delete','unknown']).includes(kind)} onChange={event=>setField('mcpPermissions',event.target.checked?[...(values.mcpPermissions??['read','write','schedule','publish','delete','unknown']),kind].filter((value,i,all)=>all.indexOf(value)===i):(values.mcpPermissions??['read','write','schedule','publish','delete','unknown']).filter(value=>value!==kind))}/>{(locale==='pt-BR'?['Consultar dados','Criar ou alterar dados','Agendar','Publicar ou enviar','Excluir ou cancelar','Ferramentas não classificadas']:['Read data','Create or change data','Schedule','Publish or send','Delete or cancel','Unclassified tools'])[index]}</label>)}</section>}
            {editing && onDelete && <section className="drawer-danger" data-editor-section="permissions" hidden={editorSection!=='permissions'}><div><b>{t('Delete agent')}</b><span>{t('This permanently removes the local agent and its configuration.')}</span></div>{confirmDelete ? <div className="delete-confirm"><button className="soft-button" type="button" onClick={() => setConfirmDelete(false)}>{t('Cancel')}</button><button className="danger-button" type="button" onClick={()=>{updatePersistentValue<AgentDraftMap>(agentDraftStorageKey,{},current=>putAgentDraft(current,draftScope,undefined));onDelete()}}>{t('Confirm delete')}</button></div> : <button className="danger-button" type="button" onClick={() => setConfirmDelete(true)}>{t('Delete')}</button>}</section>}
          {(providerId==='codex'||providerId==='claude')&&<section className="drawer-section" data-editor-section="notion" hidden={editorSection!=='notion'} style={{padding:'0 24px 16px'}}>
            <div className="drawer-section-title"><b>{locale==='pt-BR'?'Notion sem confirmações repetidas':'Notion without repeated confirmations'}</b></div>
            <label className="delivery-notion-choice"><input type="checkbox" checked={values.notionAutomation?.enabled??false} onChange={event=>setField('notionAutomation',{enabled:event.target.checked,dataSourceId:values.notionAutomation?.dataSourceId??''})}/>{locale==='pt-BR'?'Permitir consultas e criação de cards como Ideia':'Allow reads and creation of Idea cards'}</label>
            {values.notionAutomation?.enabled&&<label className="field"><span>{locale==='pt-BR'?'Coleção Notion autorizada':'Authorized Notion data source'}</span><input value={values.notionAutomation.dataSourceId} onChange={event=>setField('notionAutomation',{enabled:true,dataSourceId:event.target.value})} placeholder="collection://…"/></label>}
            <p className="skill-status">{locale==='pt-BR'?'Revise os novos cards no Notion. Esta autorização vale para consultas e novos cards com Status = Idea na coleção escolhida. Atualizações, exclusões, agendamentos e publicações continuam exigindo confirmação. As permissões MCP acima também se aplicam.':'Review new cards in Notion. This permission covers reads and new cards with Status = Idea in the selected data source. Updates, deletion, scheduling and publishing still require confirmation. The MCP permissions above also apply.'}</p>
          </section>}
          <section className="drawer-section" data-editor-section="paper" hidden={editorSection!=='paper'}>
            <div className="drawer-section-title"><b>{locale==='pt-BR'?'Carrosséis no Paper':'Carousels in Paper'}</b><span>{locale==='pt-BR'?'Guarde a direção visual e escolha onde o agente cria os slides.':'Save the visual direction and choose where the agent creates slides.'}</span></div>
            {providerId==='gemini'?<p className="skill-status">{locale==='pt-BR'?'Escolha Claude ou Codex na seção Provedor de IA para usar o Paper.':'Choose Claude or Codex in AI provider to use Paper.'}</p>:<>
              <label className="delivery-notion-choice"><input type="checkbox" checked={paper.enabled} onChange={event=>setPaper({enabled:event.target.checked})}/>{locale==='pt-BR'?'Usar Paper para criar carrosséis':'Use Paper to create carousels'}</label>
              <div className="field"><span>{locale==='pt-BR'?'Arquivo de destino':'Destination file'}</span><p>{paper.fileName||(locale==='pt-BR'?'Abra no Paper o arquivo em que deseja criar os carrosséis.':'Open the file where you want to create carousels in Paper.')}</p><button type="button" className="soft-button" disabled={connectingPaper} onClick={()=>void connectPaper()}>{connectingPaper?(locale==='pt-BR'?'Conectando…':'Connecting…'):(locale==='pt-BR'?'Conectar arquivo aberto no Paper':'Connect the open Paper file')}</button></div>
              <label className="field"><span>{locale==='pt-BR'?'Sua assinatura ou @':'Your signature or handle'}</span><input maxLength={120} value={paper.signature} onChange={event=>setPaper({signature:event.target.value})} placeholder={locale==='pt-BR'?'Opcional':'Optional'}/></label>
              <label className="field"><span>{locale==='pt-BR'?'Direção visual dos carrosséis':'Carousel visual direction'}</span><textarea rows={9} maxLength={12000} value={paper.visualStyle} onChange={event=>setPaper({visualStyle:event.target.value})}/></label>
              <button type="button" className="soft-button" onClick={()=>setPaper({visualStyle:paperVisualStyle})}>{locale==='pt-BR'?'Usar base editorial':'Use editorial base'}</button>
              <label className="delivery-notion-choice"><input type="checkbox" checked={paper.automatic} disabled={!paper.fileId} onChange={event=>setPaper({automatic:event.target.checked})}/>{locale==='pt-BR'?'Produção automática neste arquivo (sem confirmações a cada passo)':'Automatic production in this file (no confirmation for each step)'}</label>
              <p className="skill-status">{locale==='pt-BR'?'A direção salva é a base de cada carrossel; cores, referências ou um estilo pedidos para um carrossel valem para ele sem alterar esta base. Com a produção automática, o agente lê, cria páginas e slides, edita e substitui layout, ajusta tokens, insere imagens verificadas pelo app (como imagens GPT que você pediu) e exporta, só no arquivo escolhido, sem pedir aprovação a cada passo. Apagar camadas, outros arquivos, exportação de vídeo, imagens não verificadas, operações não reconhecidas e geração paper-gen:// (consome créditos) continuam pedindo confirmação. Backups importados chegam com esta opção desligada. As permissões MCP do agente também se aplicam.':'The saved direction is the base for every carousel; colors, references or a style requested for one carousel apply to it without changing this base. With automatic production, the agent reads, creates pages and slides, edits and replaces layout, adjusts tokens, places images the app verified (such as GPT images you asked for) and exports, only in the selected file, without asking at each step. Deleting layers, other files, video export, unverified images, unrecognized operations and paper-gen:// generation (uses credits) still ask for confirmation. Imported backups arrive with this option off. The agent’s MCP permissions also apply.'}</p>
              {paper.enabled&&values.mcpPermissions&&(!values.mcpPermissions.includes('read')||!values.mcpPermissions.includes('write'))&&<p className="form-error">{locale==='pt-BR'?'Habilite Consultar dados e Criar ou alterar dados nas Permissões MCP.':'Enable Read data and Create or change data in MCP permissions.'}</p>}
              {paperStatus&&<p className="skill-status" role="status">{paperStatus}</p>}
            </>}
          </section>
          <section className="drawer-section" data-editor-section="publishing" hidden={editorSection!=='publishing'}>
            <div className="drawer-section-title"><b>{locale==='pt-BR'?"Agendar posts pelo chat":"Schedule posts from chat"}</b><span>{locale==='pt-BR'?"Quando você pede no chat para agendar um post pronto, o pedido é a autorização.":"When you ask in chat to schedule a finished post, the request is the authorization."}</span></div>
            {providerId==='gemini'?<p className="skill-status">{locale==='pt-BR'?"Escolha Claude ou Codex na seção Provedor de IA para agendar pelo chat.":"Choose Claude or Codex in AI provider to schedule from chat."}</p>:<>
              <label className="delivery-notion-choice"><input type="checkbox" checked={values.publishingAutomation?.enabled??false} onChange={event=>setField('publishingAutomation',{provider:'',timeZone:'America/Sao_Paulo',...values.publishingAutomation,enabled:event.target.checked})}/>{locale==='pt-BR'?"Agendar quando eu pedir, sem confirmação extra":"Schedule when I ask, without an extra confirmation"}</label>
              <label className="field"><span>{locale==='pt-BR'?"Serviço de agendamento":"Scheduling service"}</span><select value={values.publishingAutomation?.provider??''} onChange={event=>setField('publishingAutomation',{enabled:false,timeZone:'America/Sao_Paulo',...values.publishingAutomation,provider:event.target.value as ''|'publora'|'zernio'})}><option value="">{locale==='pt-BR'?"Padrão da rede (Publora; TikTok pelo Zernio)":"Network default (Publora; TikTok via Zernio)"}</option><option value="publora">Publora</option><option value="zernio">Zernio</option></select></label>
              <label className="field"><span>{locale==='pt-BR'?"Fuso horário padrão":"Default time zone"}</span><input maxLength={100} value={values.publishingAutomation?.timeZone??''} onChange={event=>setField('publishingAutomation',{enabled:false,provider:'',...values.publishingAutomation,timeZone:event.target.value.trim()})} placeholder="America/Sao_Paulo"/></label>
              {values.publishingAutomation&&!validPublishingAutomation(values.publishingAutomation)&&<p className="form-error">{locale==='pt-BR'?"Use um fuso IANA válido, como America/Sao_Paulo.":"Use a valid IANA time zone, such as America/Sao_Paulo."}</p>}
              <p className="skill-status">{locale==='pt-BR'?"O agente pergunta de uma vez só o que faltar (rede, conta, data e hora), envia os slides na ordem, agenda e confere o resultado no serviço. Ele usa só a legenda e os arquivos já mostrados no chat; se algo não foi mostrado ou esta opção estiver desligada, você confirma um único resumo. Nunca publica na hora, não apaga nem altera outros posts e não repete um envio com resultado incerto. As contas precisam estar conectadas no Publora ou no Zernio: o app não faz login nem guarda tokens por você. Limites do plano (como horizonte e vagas de agendamento) são conferidos antes do envio. Backups importados chegam com esta opção desligada.":"The agent asks once for anything missing (network, account, date and time), uploads the slides in order, schedules and checks the result with the service. It only uses the caption and files already shown in the chat; if something was not shown or this option is off, you confirm a single summary. It never publishes immediately, never deletes or changes other posts and never repeats a send whose result is uncertain. Accounts must be connected in Publora or Zernio: the app does not sign in or keep tokens for you. Plan limits (such as horizon and scheduling slots) are checked before sending. Imported backups arrive with this option off."}</p>
              {values.mcpPermissions&&!values.mcpPermissions.includes('schedule')&&<p className="form-error">{locale==='pt-BR'?"Habilite Agendar nas Permissões MCP.":"Enable Schedule in MCP permissions."}</p>}
            </>}
          </section>
          </div>
          <footer className="drawer-footer">
            <span className="form-error" role="alert">{error}</span>
            <span className="agent-editor-completion" title={locale==='pt-BR'?'Configuração dos campos; não confirma conexão com o provedor.':'Field configuration; does not confirm provider connection.'}>{completeSectionCount} {locale==='pt-BR'?'de 9 seções configuradas':'of 9 sections configured'}</span>
            <button className="soft-button" type="button" onClick={close}>{t('Cancel')}</button>
            <button className="primary-button" type="submit">{t(editing ? 'Save changes' : 'Create agent')}</button>
          </footer>
        </form>
      </aside>
    </div>
  );
}

function pickValues(agent: Agent): AgentEditorValues {
  return {
    name: agent.name,
    role: agent.role,
    description: agent.description,
    instructions: agent.instructions,
    workspaceId: agent.workspaceId,
    tools: [...agent.tools],
    providerId:agent.providerId??'codex',
    mcpPermissions:agent.mcpPermissions,
    notionAutomation:agent.notionAutomation,
    fileAccess:agent.fileAccess,
    paperDesign:agent.paperDesign,
    publishingAutomation:agent.publishingAutomation,
    modelId:agent.modelId??'',
    skillsDirectory: agent.skillsDirectory ?? '',
    skillFiles: agent.skillFiles ?? {},
    skills: [...(agent.skills ?? [])],
    disabledSkills: [...(agent.disabledSkills ?? [])],
    skillsInstallKey:agent.skillsInstallKey??agent.id,
    avatarImage: agent.avatarImage ?? '',
  };
}
