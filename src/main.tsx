import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { AgentsProvider } from './features/agents/AgentsProvider';
import { ChatProvider } from './features/chat/ChatProvider';
import { CanvasProvider } from './components/canvas/CanvasProvider';
import { WorkspaceProvider } from './app/WorkspaceProvider';
import { HttpCodexService } from './features/chat/HttpCodexService';
import { CodexAiProvider } from './features/chat/CodexAiProvider';
import { HttpApiProvider } from './features/chat/HttpApiProvider';
import { ClaudeCliProvider } from './features/chat/ClaudeCliProvider';
import { LanguageProvider } from './app/LanguageProvider';
import { ContentWorkflowProvider } from './features/content/ContentWorkflowProvider';
import { restoreLocalPersistence, saveNow } from './data/localPersistence';
import { storageProfile } from './data/IndexedDbStateStore';
import { recoverPendingBackup } from './data/backup';
import '@xyflow/react/dist/style.css';

const root=document.getElementById('root');
if(!root)throw new Error('Missing #root element');
const reactRoot = createRoot(root);
const pt = navigator.language.startsWith('pt');
async function openWorkspace() {
  reactRoot.render(<div role="status" style={{ padding: '48px', fontFamily: 'system-ui', color: 'GrayText' }}>{pt ? 'Abrindo seus dados salvos…' : 'Opening your saved data…'}</div>);
  try {
    if(document.querySelector('meta[name="mainsagents-storage"]')?.getAttribute('content')==='desktop-sqlite'&&!window.mainsAgentsDesktop?.state) {
      throw new Error('Desktop storage bridge is unavailable. Browser data will not replace the saved workspace.');
    }
    await recoverPendingBackup();
    await restoreLocalPersistence();
    window.mainsAgentsSaveNow=saveNow;
    const desktopProfile = window.mainsAgentsDesktop?.state ? storageProfile() : undefined;
    if (desktopProfile) {
      try {
        if (desktopProfile === 'default') localStorage.removeItem('mainsagents-profile');
        else localStorage.setItem('mainsagents-profile', desktopProfile);
      } catch {/* Native persistence remains available without browser storage. */}
    }
    const codexService = new HttpCodexService();
    const providers = [new CodexAiProvider(codexService), new ClaudeCliProvider(), new HttpApiProvider('gemini')];
    reactRoot.render(<StrictMode><LanguageProvider><WorkspaceProvider><AgentsProvider><CanvasProvider><ChatProvider providers={providers}><ContentWorkflowProvider><App/></ContentWorkflowProvider></ChatProvider></CanvasProvider></AgentsProvider></WorkspaceProvider></LanguageProvider></StrictMode>);
  } catch (error) {
    console.error('[MainsAgents] Could not open saved workspace', error);
    reactRoot.render(<div role="alert" style={{ padding: '48px', fontFamily: 'system-ui', maxWidth: '640px', color: 'GrayText' }}>
      <h1>{pt ? 'Não foi possível abrir seus dados' : 'Could not open your saved data'}</h1>
      <p>{pt ? 'Os dados salvos foram preservados. Tente novamente; o app não criará um workspace vazio por cima deles.' : 'Your saved data has been preserved. Retry opening it; the app will not replace it with an empty workspace.'}</p>
      <button onClick={() => void openWorkspace()}>{pt ? 'Tentar novamente' : 'Try again'}</button>
    </div>);
  }
}
void openWorkspace();
