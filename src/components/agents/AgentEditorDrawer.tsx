import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Agent, AgentEditorValues, AgentTool } from '../../features/agents/model/Agent';
import { agentToolDetails, getAgentInitials } from '../../features/agents/model/Agent';
import { Icon } from '../common/Icon';
import { useWorkspaces } from '../../app/WorkspaceProvider';
import { useLanguage } from '../../app/LanguageProvider';

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
};

interface AgentEditorDrawerProps {
  agent?: Agent;
  onClose: () => void;
  onSave: (values: AgentEditorValues) => void;
  onDelete?: () => void;
}

export function AgentEditorDrawer({ agent, onClose, onSave, onDelete }: AgentEditorDrawerProps) {
  const { workspaces, currentWorkspaceId } = useWorkspaces();
  const {locale,t}=useLanguage();
  const [values, setValues] = useState<AgentEditorValues>(agent ? pickValues(agent) : { ...emptyValues, workspaceId: currentWorkspaceId });
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [skillSource, setSkillSource] = useState('');
  const [skillStatus, setSkillStatus] = useState('');
  const [installingSkill, setInstallingSkill] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const editing = Boolean(agent);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKeyDown);
    requestAnimationFrame(() => nameRef.current?.focus());
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

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
    onSave({ ...values, name: values.name.trim(), role: values.role.trim(), description: values.description.trim(), instructions: values.instructions.trim() });
  };

  const applySkillResult = (result: SkillDirectoryResult) => {
    setValues((current) => ({ ...current, skillsDirectory: result.directory, skills: result.skills.map((skill) => skill.name) }));
    setSkillStatus(result.skills.length ? `${result.skills.length} skill${result.skills.length === 1 ? '' : 's'}.` : t('No SKILL.md files found in this folder.'));
  };

  const selectSkillDirectory = async () => {
    if (!window.mainsAgentsDesktop) { setSkillStatus(t('Folder selection is available in the desktop app.')); return; }
    const result = await window.mainsAgentsDesktop.selectSkillDirectory();
    if (result) applySkillResult(result);
  };

  const installAgentSkill = async () => {
    const source = skillSource.trim();
    if (!source || !window.mainsAgentsDesktop) { setSkillStatus(t(window.mainsAgentsDesktop ? 'Enter a skill repository.' : 'Skill installation is available in the desktop app.')); return; }
    setInstallingSkill(true);
    setSkillStatus(t('Installing…'));
    try { const result = await window.mainsAgentsDesktop.installSkill(source); applySkillResult(result); setSkillSource(''); }
    catch (error) { setSkillStatus(error instanceof Error ? error.message : t('Could not install this skill.')); }
    finally { setInstallingSkill(false); }
  };

  return (
    <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="agent-drawer" role="dialog" aria-modal="true" aria-labelledby="agent-editor-title">
        <header className="drawer-head">
          <div className="drawer-identity">
            <span className="agent-monogram">{values.name ? getAgentInitials({ name: values.name }) : <Icon name="users" />}</span>
            <div><p>{t(editing ? 'Agent configuration' : 'New specialist')}</p><h2 id="agent-editor-title">{editing ? agent?.name : t('Create agent')}</h2></div>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close agent editor">×</button>
        </header>

        <form className="drawer-form" onSubmit={submit}>
          <div className="drawer-scroll">
            <section className="drawer-section">
              <div className="drawer-section-title"><b>{t('Identity')}</b><span>{t('How this agent appears across the workspace.')}</span></div>
              <label className="field"><span>{t('Name')}</span><input ref={nameRef} value={values.name} onChange={(event) => setField('name', event.target.value)} placeholder={locale==='pt-BR'?'ex.: Editor de Pesquisa':'e.g. Research Editor'} /></label>
              <label className="field"><span>{t('Role')}</span><input value={values.role} onChange={(event) => setField('role', event.target.value)} placeholder={locale==='pt-BR'?'ex.: Pesquisador editorial':'e.g. Editorial researcher'} /></label>
              <label className="field"><span>{t('Description')}</span><textarea rows={3} value={values.description} onChange={(event) => setField('description', event.target.value)} placeholder={locale==='pt-BR'?'Uma explicação breve do que este agente faz.':'A concise explanation of what this agent does.'} /></label>
            </section>

            <section className="drawer-section">
              <div className="drawer-section-title"><b>{t('Behavior')}</b><span>{t('Set the permanent context this agent should follow.')}</span></div>
              <label className="field"><span>{t('Instructions')}</span><textarea className="instructions-input" rows={7} value={values.instructions} onChange={(event) => setField('instructions', event.target.value)} placeholder={locale==='pt-BR'?'Descreva objetivos, processo, restrições e resultado esperado.':'Describe goals, process, constraints, and expected output.'} /></label>
              <label className="field"><span>{t('Workspace')}</span><select value={values.workspaceId} onChange={(event) => setField('workspaceId', event.target.value)}>{workspaces.map((workspace)=><option value={workspace.id} key={workspace.id}>{workspace.name}</option>)}</select></label>
            </section>

            <section className="drawer-section">
              <div className="drawer-section-title"><b>{t('Tools')}</b><span>{t('Choose what this agent can access in the prototype.')}</span></div>
              <div className="tool-grid">{tools.map((tool) => { const detail = agentToolDetails[tool]; const selected = values.tools.includes(tool); return <button className={`tool-option ${selected ? 'selected' : ''}`} type="button" aria-pressed={selected} key={tool} onClick={() => toggleTool(tool)}><span className="tool-check">{selected ? '✓' : ''}</span><span><b>{t(detail.label)}</b><small>{t(detail.description)}</small></span></button>; })}</div>
            </section>

            <section className="drawer-section">
              <div className="drawer-section-title"><b>{t('Skills')}</b><span>{t('Install a skill or point this agent to a folder containing SKILL.md files.')}</span></div>
              <label className="field"><span>{t('Skills folder')}</span><div className="skill-path-row"><input value={values.skillsDirectory ?? ''} readOnly placeholder={t('No folder selected')}/><button className="soft-button" type="button" onClick={selectSkillDirectory}>{t('Choose folder')}</button></div></label>
              <label className="field"><span>{t('Install from GitHub')}</span><div className="skill-path-row"><input value={skillSource} onChange={(event)=>setSkillSource(event.target.value)} placeholder="owner/repository or GitHub URL"/><button className="soft-button" type="button" disabled={installingSkill} onClick={installAgentSkill}>{t(installingSkill?'Installing…':'Install skill')}</button></div></label>
              {(values.skills?.length??0)>0&&<div className="skill-list">{values.skills?.map((skill)=><span key={skill}>{skill}</span>)}</div>}
              {skillStatus&&<p className="skill-status">{skillStatus}</p>}
            </section>

            {editing && onDelete && <section className="drawer-danger"><div><b>{t('Delete agent')}</b><span>{t('This permanently removes the local agent and its configuration.')}</span></div>{confirmDelete ? <div className="delete-confirm"><button className="soft-button" type="button" onClick={() => setConfirmDelete(false)}>{t('Cancel')}</button><button className="danger-button" type="button" onClick={onDelete}>{t('Confirm delete')}</button></div> : <button className="danger-button" type="button" onClick={() => setConfirmDelete(true)}>{t('Delete')}</button>}</section>}
          </div>

          <footer className="drawer-footer">
            <span className="form-error" role="alert">{error}</span>
            <button className="soft-button" type="button" onClick={onClose}>{t('Cancel')}</button>
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
    skillsDirectory: agent.skillsDirectory ?? '',
    skills: [...(agent.skills ?? [])],
  };
}
