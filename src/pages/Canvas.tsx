import { Canvas as CanvasWorkspace } from '../components/canvas/Canvas';

export function Canvas({onToast,onAskAgent,onSendToAgent}:{onToast:(message:string)=>void;onAskAgent:(nodeIds:string[])=>void;onSendToAgent:(nodeIds:string[])=>void}) {
  return <div className="page full"><CanvasWorkspace onToast={onToast} onAskAgent={onAskAgent} onSendToAgent={onSendToAgent}/></div>;
}
