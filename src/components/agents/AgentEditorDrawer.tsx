import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { Agent, AgentEditorValues, AgentTool } from '../../features/agents/model/Agent';
import { agentToolDetails } from '../../features/agents/model/Agent';
import { Icon } from '../common/Icon';
import { AgentAvatar } from './AgentAvatar';
import { useWorkspaces } from '../../app/WorkspaceProvider';
import { useLanguage } from '../../app/LanguageProvider';
import { SelectMenu } from '../common/SelectMenu';

const tools = Object.keys(agentToolDetails) as AgentTool[];
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
  const draftKey=`mainsagents:agent-draft:${agent?.id??initialValues?.name??'new'}`;
  const [values, setValues] = useState<AgentEditorValues>(()=>{const fallback=agent ? pickValues(agent) : { ...emptyValues, ...initialValues, workspaceId: currentWorkspaceId };try{const saved=sessionStorage.getItem(draftKey);return saved?{...fallback,...JSON.parse(saved)}:fallback}catch{return fallback}});
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [skillCommands,setSkillCommands]=useState(()=>[{id:Date.now(),command:''}]);
  const [skillStatus, setSkillStatus] = useState('');
  const [installingSkill, setInstallingSkill] = useState(false);
  const [refreshingSkills,setRefreshingSkills]=useState(false);
  const [models,setModels]=useState<readonly {id:string;name:string}[]>([]);
  const [providerError,setProviderError]=useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const avatarInputRef=useRef<HTMLInputElement>(null);
  const originRef = useRef<HTMLElement|null>(document.activeElement as HTMLElement);
  const editing = Boolean(agent);
  const providerId=values.providerId??'codex';
  const original=agent?pickValues(agent):{...emptyValues,...initialValues,workspaceId:currentWorkspaceId};
  const dirty=JSON.stringify(values)!==JSON.stringify(original);
  const close=()=>{if(dirty&&!window.confirm(locale==='pt-BR'?'Fechar e guardar este rascunho para continuar depois?':'Close and keep this draft for later?'))return;onClose();requestAnimationFrame(()=>originRef.current?.focus())};
  useEffect(()=>{if(dirty)sessionStorage.setItem(draftKey,JSON.stringify(values))},[dirty,draftKey,values]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();close();}};
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

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!values.name.trim() || !values.role.trim()) {
      setError(t('Name and role are required.'));
      return;
    }
    if(providerId==='gemini'&&!values.modelId){setError(t('Choose a provider model after connecting it in Settings.'));return}
    sessionStorage.removeItem(draftKey);
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
      <aside className={`agent-drawer ${focusMode?'focus-writing':''}`} role="dialog" aria-modal="true" aria-labelledby="agent-editor-title">
        <header className="drawer-head">
          <div className="drawer-identity">
            <AgentAvatar name={values.name || 'Agent'} image={values.avatarImage} />
            <div><p>{t(editing ? 'Agent configuration' : 'New specialist')}</p><h2 id="agent-editor-title">{editing ? agent?.name : t('Create agent')}</h2></div>
          </div>
          <button className="icon-button" type="button" onClick={close} aria-label="Close agent editor">×</button>
        </header>

        <form className="drawer-form" onSubmit={submit}>
          <div className="drawer-scroll">
            <section className="drawer-section">
              <div className="drawer-section-title"><b>{t('Identity')}</b><span>{t('How this agent appears across the workspace.')}</span></div>
              <div className="agent-avatar-editor"><AgentAvatar name={values.name||'Agent'} image={values.avatarImage}/><div><b>{t('Profile image')}</b><span>{t('Add a photo or illustrated icon to recognize this agent.')}</span><div><button className="soft-button" type="button" onClick={()=>avatarInputRef.current?.click()}>{t(values.avatarImage?'Change image':'Choose image')}</button>{values.avatarImage&&<button className="soft-button" type="button" onClick={()=>setField('avatarImage','')}>{t('Remove')}</button>}</div><input ref={avatarInputRef} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event)=>void chooseAvatar(event)}/></div></div>
              <label className="field"><span>{t('Name')} *</span><input ref={nameRef} required value={values.name} onChange={(event) => setField('name', event.target.value)} placeholder={locale==='pt-BR'?'ex.: Editor de Pesquisa':'e.g. Research Editor'} /></label>
              <label className="field"><span>{t('Role')} *</span><input required value={values.role} onChange={(event) => setField('role', event.target.value)} placeholder={locale==='pt-BR'?'ex.: Pesquisador editorial':'e.g. Editorial researcher'} /></label>
              <label className="field"><span>{t('Description')}</span><textarea rows={3} value={values.description} onChange={(event) => setField('description', event.target.value)} placeholder={locale==='pt-BR'?'Uma explicação breve do que este agente faz.':'A concise explanation of what this agent does.'} /></label>
            </section>

            <section className="drawer-section">
              <div className="drawer-section-title"><b>{t('Behavior')}</b><span>{t('Set the permanent context this agent should follow.')}</span></div>
              <label className="field"><span>{t('Instructions')}</span><textarea className="instructions-input" rows={7} value={values.instructions} onChange={(event) => setField('instructions', event.target.value)} placeholder={locale==='pt-BR'?'Descreva objetivos, processo, restrições e resultado esperado.':'Describe goals, process, constraints, and expected output.'} /></label>
              <div className="field"><span>{t('Workspace')}</span><SelectMenu className="field-select" value={values.workspaceId} onChange={(value) => setField('workspaceId', value)} ariaLabel={t('Workspace')} options={workspaces.map((workspace)=>({value:workspace.id,label:workspace.name}))}/></div>
            </section>

            <section className="drawer-section">
              <div className="drawer-section-title"><b>{t('AI provider')}</b><span>{t('Choose who answers and how usage is billed.')}</span></div>
              <div className="field"><span>{t('Provider')}</span><SelectMenu className="field-select" value={providerId} onChange={(value)=>{setField('providerId',value as AgentEditorValues['providerId']);setField('modelId','')}} ariaLabel={t('Provider')} options={[{value:'codex',label:'Codex CLI · ChatGPT/Codex'},{value:'claude',label:'Claude Code CLI'},{value:'gemini',label:'Gemini · Google AI API'}]}/></div>
              <div className="field"><span>{t('Model')}</span><SelectMenu className="field-select" value={values.modelId??''} onChange={(value)=>setField('modelId',value)} ariaLabel={t('Model')} options={[{value:'',label:t(providerId==='gemini'?'Choose a model':'Provider default')},...models.map((model)=>({value:model.id,label:model.name}))]}/></div>
              <p className="provider-billing">{t(providerId==='codex'?'Uses your Codex CLI login and plan.':providerId==='claude'?'Uses your Claude Code CLI authentication and provider billing.':'Uses your own API key and provider billing.')}</p>
              {providerError&&<div className="provider-error"><span>{providerError}</span>{onOpenProviderSettings&&<button type="button" onClick={onOpenProviderSettings}>{t('Open connection settings')}</button>}</div>}
            </section>

            <section className="drawer-section">
              <div className="drawer-section-title"><b>{t('Tools')}</b><span>{t('Choose what this agent can access in the prototype.')}</span></div>
              {providerId!=='gemini'?<div className="tool-grid">{tools.filter((tool)=>providerId!=='claude'||tool!=='subagents').map((tool) => { const detail = agentToolDetails[tool]; const selected = values.tools.includes(tool); return <button className={`tool-option ${selected ? 'selected' : ''}`} type="button" aria-pressed={selected} key={tool} onClick={() => toggleTool(tool)}><span className="tool-check">{selected ? '✓' : ''}</span><span><b>{t(detail.label)}</b><small>{t(detail.description)}</small></span></button>; })}</div>:<p className="provider-billing">{t('Canvas context is sent as text. Web, file and subagent tools are unavailable for this provider.')}</p>}
            </section>

            {(providerId==='codex'||providerId==='claude')&&<section className="drawer-section">
              <div className="drawer-section-title"><b>{t('Skills')}</b><span>{t('Install skills for this agent using an npx command, or point it to an existing skills folder.')}</span></div>
              <label className="field"><span>{t('Skills folder')}</span><div className="skill-path-row"><input value={values.skillsDirectory ?? ''} readOnly placeholder={t('No folder selected')}/><button className="soft-button" type="button" disabled={installingSkill||refreshingSkills} onClick={selectSkillDirectory}>{t('Choose folder')}</button><button className="soft-button" type="button" disabled={!values.skillsDirectory||installingSkill||refreshingSkills} onClick={refreshSkills}>{t(refreshingSkills?'Refreshing…':'Reload skills')}</button></div></label>
              <p className="skill-status">{t('Choose a folder with .md files or SKILL.md skill folders.')}</p>
              <div className="agent-skill-installer"><span className="field-label">{t('Install with npx')}</span>{skillCommands.map((item,index)=><div className="skill-command-row" key={item.id}><input aria-label={`${t('Skill install command')} ${index+1}`} value={item.command} onChange={(event)=>setSkillCommands((current)=>current.map((row)=>row.id===item.id?{...row,command:event.target.value}:row))} onKeyDown={(event)=>{if(event.key==='Enter'){event.preventDefault();void installAgentSkill(item.id)}}} placeholder="npx skills add owner/repository"/><button className="soft-button" type="button" disabled={installingSkill} onClick={()=>void installAgentSkill(item.id)}>{t(installingSkill?'Installing…':'Add & install')}</button>{skillCommands.length>1&&<button className="icon-button remove-skill-command" type="button" disabled={installingSkill} aria-label={t('Remove skill command')} onClick={()=>setSkillCommands((current)=>current.filter((row)=>row.id!==item.id))}>×</button>}</div>)}<button className="add-skill-command" type="button" disabled={installingSkill} onClick={addSkillCommand}><Icon name="plus"/>{t('Add another skill')}</button></div>
              {(values.skills?.length??0)>0&&<div className="agent-skill-list" aria-label={locale==='pt-BR'?'Skills vinculadas':'Associated skills'}>{values.skills?.map((skill)=><div className="agent-skill-item" key={skill}><span className="agent-skill-glyph">/</span><span className="agent-skill-name">{skill}</span><button className="agent-skill-remove" type="button" onClick={()=>removeAssociatedSkill(skill)} aria-label={locale==='pt-BR'?`Desvincular ${skill} deste agente`:`Remove ${skill} from this agent`} title={locale==='pt-BR'?'Desvincular do agente':'Remove from agent'}>×</button></div>)}</div>}
              {(values.disabledSkills?.length??0)>0&&<div className="agent-skill-disabled"><span>{locale==='pt-BR'?'Desvinculadas deste agente':'Removed from this agent'}</span>{values.disabledSkills?.map((skill)=><button key={skill} className="soft-button" type="button" onClick={()=>restoreAssociatedSkill(skill)}>{locale==='pt-BR'?`Restaurar /${skill}`:`Restore /${skill}`}</button>)}</div>}
              <p className="skill-status">{locale==='pt-BR'?'Desvincular não apaga os arquivos da skill. Salve o agente para aplicar a mudança.':'Removing a skill does not delete its files. Save the agent to apply the change.'}</p>
              {skillStatus&&<p className="skill-status">{skillStatus}</p>}
            </section>}

            {editing && onDelete && <section className="drawer-danger"><div><b>{t('Delete agent')}</b><span>{t('This permanently removes the local agent and its configuration.')}</span></div>{confirmDelete ? <div className="delete-confirm"><button className="soft-button" type="button" onClick={() => setConfirmDelete(false)}>{t('Cancel')}</button><button className="danger-button" type="button" onClick={()=>{sessionStorage.removeItem(draftKey);onDelete()}}>{t('Confirm delete')}</button></div> : <button className="danger-button" type="button" onClick={() => setConfirmDelete(true)}>{t('Delete')}</button>}</section>}
          </div>

          <footer className="drawer-footer">
            <span className="form-error" role="alert">{error}</span>
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
    modelId:agent.modelId??'',
    skillsDirectory: agent.skillsDirectory ?? '',
    skillFiles: agent.skillFiles ?? {},
    skills: [...(agent.skills ?? [])],
    disabledSkills: [...(agent.disabledSkills ?? [])],
    skillsInstallKey:agent.skillsInstallKey??agent.id,
    avatarImage: agent.avatarImage ?? '',
  };
}
