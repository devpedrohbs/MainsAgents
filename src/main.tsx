import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { AgentsProvider } from './features/agents/AgentsProvider';
import { ChatProvider } from './features/chat/ChatProvider';
import { CanvasProvider } from './components/canvas/CanvasProvider';
import { WorkspaceProvider } from './app/WorkspaceProvider';
import { HttpCodexService } from './features/chat/HttpCodexService';
import { LanguageProvider } from './app/LanguageProvider';
import '@xyflow/react/dist/style.css';

const root=document.getElementById('root');
if(!root)throw new Error('Missing #root element');
const codexService=new HttpCodexService();
createRoot(root).render(<StrictMode><LanguageProvider><WorkspaceProvider><AgentsProvider><CanvasProvider><ChatProvider codexService={codexService}><App/></ChatProvider></CanvasProvider></AgentsProvider></WorkspaceProvider></LanguageProvider></StrictMode>);
