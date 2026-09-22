import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Agent, AgentEditorValues, AgentTool } from '../../features/agents/model/Agent';
import { agentToolDetails, getAgentInitials } from '../../features/agents/model/Agent';
import { Icon } from '../common/Icon';
import { useWorkspaces } from '../../app/WorkspaceProvider';

const tools = Object.keys(agentToolDetails) as AgentTool[];
const emptyValues: AgentEditorValues = {
  name: '',
  role: '',
  description: '',
  instructions: '',
  workspaceId: 'content',
  tools: ['web-search', 'files', 'canvas-context'],
};

interface AgentEditorDrawerProps {
  agent?: Agent;
  onClose: () => void;
  onSave: (values: AgentEditorValues) => void;
  onDelete?: () => void;
}

export function AgentEditorDrawer({ agent, onClose, onSave, onDelete }: AgentEditorDrawerProps) {
  const { workspaces, currentWorkspaceId } = useWorkspaces();
  const [values, setValues] = useState<AgentEditorValues>(agent ? pickValues(agent) : { ...emptyValues, workspaceId: currentWorkspaceId });
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
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
      setError('Name and role are required.');
      return;
    }
    onSave({ ...values, name: values.name.trim(), role: values.role.trim(), description: values.description.trim(), instructions: values.instructions.trim() });
  };

  return (
    <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="agent-drawer" role="dialog" aria-modal="true" aria-labelledby="agent-editor-title">
        <header className="drawer-head">
          <div className="drawer-identity">
            <span className="agent-monogram">{values.name ? getAgentInitials({ name: values.name }) : <Icon name="users" />}</span>
            <div><p>{editing ? 'Agent configuration' : 'New specialist'}</p><h2 id="agent-editor-title">{editing ? agent?.name : 'Create agent'}</h2></div>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close agent editor">×</button>
        </header>

        <form className="drawer-form" onSubmit={submit}>
          <div className="drawer-scroll">
            <section className="drawer-section">
              <div className="drawer-section-title"><b>Identity</b><span>How this agent appears across the workspace.</span></div>
              <label className="field"><span>Name</span><input ref={nameRef} value={values.name} onChange={(event) => setField('name', event.target.value)} placeholder="e.g. Research Editor" /></label>
              <label className="field"><span>Role</span><input value={values.role} onChange={(event) => setField('role', event.target.value)} placeholder="e.g. Editorial researcher" /></label>
              <label className="field"><span>Description</span><textarea rows={3} value={values.description} onChange={(event) => setField('description', event.target.value)} placeholder="A concise explanation of what this agent does." /></label>
            </section>

            <section className="drawer-section">
              <div className="drawer-section-title"><b>Behavior</b><span>Set the permanent context this agent should follow.</span></div>
              <label className="field"><span>Instructions</span><textarea className="instructions-input" rows={7} value={values.instructions} onChange={(event) => setField('instructions', event.target.value)} placeholder="Describe goals, process, constraints, and expected output." /></label>
              <label className="field"><span>Workspace</span><select value={values.workspaceId} onChange={(event) => setField('workspaceId', event.target.value)}>{workspaces.map((workspace)=><option value={workspace.id} key={workspace.id}>{workspace.name}</option>)}</select></label>
            </section>

            <section className="drawer-section">
              <div className="drawer-section-title"><b>Tools</b><span>Choose what this agent can access in the prototype.</span></div>
              <div className="tool-grid">{tools.map((tool) => { const detail = agentToolDetails[tool]; const selected = values.tools.includes(tool); return <button className={`tool-option ${selected ? 'selected' : ''}`} type="button" aria-pressed={selected} key={tool} onClick={() => toggleTool(tool)}><span className="tool-check">{selected ? '✓' : ''}</span><span><b>{detail.label}</b><small>{detail.description}</small></span></button>; })}</div>
            </section>

            {editing && onDelete && <section className="drawer-danger"><div><b>Delete agent</b><span>This only removes the local mock and resets after a refresh.</span></div>{confirmDelete ? <div className="delete-confirm"><button className="soft-button" type="button" onClick={() => setConfirmDelete(false)}>Cancel</button><button className="danger-button" type="button" onClick={onDelete}>Confirm delete</button></div> : <button className="danger-button" type="button" onClick={() => setConfirmDelete(true)}>Delete</button>}</section>}
          </div>

          <footer className="drawer-footer">
            <span className="form-error" role="alert">{error}</span>
            <button className="soft-button" type="button" onClick={onClose}>Cancel</button>
            <button className="primary-button" type="submit">{editing ? 'Save changes' : 'Create agent'}</button>
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
  };
}
