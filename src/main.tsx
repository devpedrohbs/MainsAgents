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
import '@xyflow/react/dist/style.css';

const root=document.getElementById('root');
if(!root)throw new Error('Missing #root element');
const desktopProfile=window.mainsAgentsDesktop?.state?.profile;
if(desktopProfile){
  try{
    if(desktopProfile==='default')localStorage.removeItem('mainsagents-profile');
    else localStorage.setItem('mainsagents-profile',desktopProfile);
  }catch{/* Native workspace persistence remains available without browser storage. */}
}
const codexService=new HttpCodexService();
const providers=[new CodexAiProvider(codexService),new ClaudeCliProvider(),new HttpApiProvider('gemini')];
createRoot(root).render(<StrictMode><LanguageProvider><WorkspaceProvider><AgentsProvider><CanvasProvider><ChatProvider providers={providers}><ContentWorkflowProvider><App/></ContentWorkflowProvider></ChatProvider></CanvasProvider></AgentsProvider></WorkspaceProvider></LanguageProvider></StrictMode>);
