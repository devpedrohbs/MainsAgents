import { useState } from 'react';
import { useWorkspaces } from '../app/WorkspaceProvider';

function Toggle({initial,label}:{initial:boolean;label:string}) { const [on,setOn]=useState(initial);return <button className={`toggle ${on?'on':''}`} aria-label={label} aria-pressed={on} onClick={()=>setOn(!on)}/> }
export function Settings() {
  const {currentWorkspace}=useWorkspaces();
  return <div className="page"><div className="page-head"><div><p className="eyebrow">Workspace</p><h1>Settings</h1><p>General preferences for {currentWorkspace.name} and its agents.</p></div></div><div className="settings-grid"><nav className="settings-nav"><button className="active">General</button><button>Agents</button><button>Models</button><button>Shortcuts</button></nav><section className="settings-panel"><div className="setting-row"><div className="setting-copy"><b>Agent activity</b><p>Show concise tool activity inside conversations.</p></div><Toggle initial label="Agent activity"/></div><div className="setting-row"><div className="setting-copy"><b>Keep canvas context</b><p>Attach selected canvas objects when starting a new session.</p></div><Toggle initial label="Keep canvas context"/></div><div className="setting-row"><div className="setting-copy"><b>Reduced motion</b><p>Minimize interface transitions and canvas feedback.</p></div><Toggle initial={false} label="Reduced motion"/></div></section></div></div>;
}
