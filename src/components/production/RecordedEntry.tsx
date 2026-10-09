import {useEffect,useState} from 'react';
import type {Agent} from '../../features/agents/model/Agent';
import type {AgentSession} from '../../features/chat/model/Chat';
import type {EditorialContent} from '../../features/content/model';
import {useProduction} from '../../features/production/ProductionProvider';
import {useContentWorkflow} from '../../features/content/ContentWorkflowProvider';
import {useAgents} from '../../features/agents/AgentsProvider';
import {useLanguage} from '../../app/LanguageProvider';
import {FlowDialog} from '../common/FlowDialog';
import {SelectMenu} from '../common/SelectMenu';
import {ProductionPreflight} from './ProductionPreflight';
import {storageProfile} from '../../data/IndexedDbStateStore';
import {useStudioDraftField,clearStudioDraft,studioDraftKey} from '../../features/content/studioDrafts';
import {MotionIntensityField,motionIntensity} from './MotionIntensity';
import type {PreflightReport} from '../../../production-preflight.mjs';
import './production.css';

interface CardRead {pageId:string;url:string;chars:number;excerpt:string;fetchedAt:string}
const profile=()=>window.mainsAgentsDesktop?.state?storageProfile():localStorage.getItem('mainsagents-profile')||'default';

/**
 * Content session entry with a video the user already recorded: attach the video, link ONE existing Notion card
 * (read-only) or paste the context, review the links and authorize editing. No idea, script, card or approval is created.
 */
export function RecordedEntry({agent,session,content,onClose,onStarted}:{agent:Agent;session:AgentSession;content:EditorialContent;onClose:()=>void;onStarted:()=>void}){
 const production=useProduction(),editorial=useContentWorkflow(),{agents}=useAgents(),{locale}=useLanguage(),pt=locale==='pt-BR';
 // Every field is scoped to this content session: content A never sees B's video, card or text.
 const scope=studioDraftKey('content-entry',agent.workspaceId,session.id,content.id);
 const flows=production.flows.flows.filter(flow=>flow.workspaceId===agent.workspaceId&&flow.nodes.some(node=>node.kind==='content-agent'&&node.agentId===agent.id));
 const [savedFlow,setFlow]=useStudioDraftField(scope,'flow',flows[0]?.id??''),flowId=flows.some(flow=>flow.id===savedFlow)?savedFlow:flows[0]?.id??'';
 const [origin,setOrigin]=useStudioDraftField(scope,'origin','text'),[cardInput,setCardInput]=useStudioDraftField(scope,'card',''),[text,setText]=useStudioDraftField(scope,'text','');
 const [savedVideo,setVideo]=useStudioDraftField(scope,'video',''),[format,setFormat]=useStudioDraftField(scope,'format','original'),[editMode,setEditMode]=useStudioDraftField(scope,'editMode','smart'),[motion,setMotion]=useStudioDraftField(scope,'motion','balanced');
 const [card,setCard]=useState<CardRead|null>(null),[authorize,setAuthorize]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[preflight,setPreflight]=useState<PreflightReport|null>(null);
 const videos=(editorial.state.assets??[]).filter(asset=>asset.contentId===content.id&&asset.workspaceId===content.workspaceId&&asset.kind==='video'&&asset.role==='source');
 const video=videos.find(asset=>asset.id===savedVideo&&asset.status==='available')?.id??'';
 const flow=flows.find(item=>item.id===flowId),agentName=(kind:string)=>agents.find(item=>item.id===flow?.nodes.find(node=>node.kind===kind)?.agentId)?.name;
 const context=origin==='notion'?(card?{kind:'notion',pageId:card.pageId}:null):(text.trim().length>=20?{kind:'text',text:text.trim()}:null);
 // A card read belongs to the exact link typed; editing the link drops it.
 useEffect(()=>{setCard(current=>current&&cardInput.includes(current.pageId)?current:null)},[cardInput]);
 useEffect(()=>{setAuthorize(false)},[flowId,origin,card?.pageId,text,video,format,editMode,motion]);
 useEffect(()=>{if(!flowId){setPreflight(null);return;}let live=true;const timer=setTimeout(()=>void production.preflight({entry:'recorded',flowId,contentId:content.id,assetId:video,context:{kind:origin==='notion'?'notion':'text'},language:locale}).then(report=>{if(live)setPreflight(report)}).catch(failure=>{if(live)setError((failure as Error).message)}),250);return()=>{live=false;clearTimeout(timer)}},[flowId,content.id,video,origin,locale]);// eslint-disable-line react-hooks/exhaustive-deps
 const importVideo=async()=>{
  const native=window.mainsAgentsDesktop?.files;if(!native){setError(pt?'Associe o vídeo pelo app para desktop.':'Attach the video in the desktop app.');return;}
  setBusy(true);setError('');
  try{const files=await native.select(storageProfile(),content.id,false),file=files.find(item=>item.status==='available'&&item.kind==='video');if(!files.length)return;if(!file){setError(files.map(item=>item.error||(pt?`${item.name}: escolha um arquivo de vídeo.`:`${item.name}: choose a video file.`)).join('\n'));return;}
   await editorial.attachFiles(content.id,[file],'source');setVideo(`sha:${file.sha256}`);}
  catch(failure){setError((failure as Error).message)}finally{setBusy(false)}
 };
 // After attaching, select the asset whose current version has the imported bytes.
 useEffect(()=>{if(!savedVideo.startsWith('sha:'))return;const asset=videos.find(item=>item.versions.some(version=>version.id===item.currentVersionId&&version.sha256===savedVideo.slice(4)));if(asset)setVideo(asset.id);},[savedVideo,videos]);// eslint-disable-line react-hooks/exhaustive-deps
 const readCard=async()=>{setBusy(true);setError('');setCard(null);try{const response=await fetch(`/api/content/productions/import-card?profile=${encodeURIComponent(profile())}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({workspaceId:agent.workspaceId,contentId:content.id,card:cardInput})}),result=await response.json();if(!response.ok)throw Error(result.error??(pt?'Não foi possível ler o card.':'Could not read the card.'));setCard(result.card);}catch(failure){setError((failure as Error).message)}finally{setBusy(false)}};
 const start=async()=>{if(busy||!context||!video)return;setBusy(true);setError('');try{await production.start({entry:'recorded',flowId,contentId:content.id,sourceSessionId:session.id,assetId:video,context,format,editMode,motion:motionIntensity(motion),authorize,language:locale,timeZone:'America/Sao_Paulo',preflightFingerprint:preflight?.fingerprint});clearStudioDraft(scope);onStarted();}catch(failure){setError((failure as Error).message)}finally{setBusy(false)}};
 const selected=videos.find(asset=>asset.id===video);
 const missing=[...(!flows.length?[pt?`${agent.name} não é o agente de entrada de nenhum fluxo deste espaço. Configure o fluxo; nenhum agente novo é criado.`:`${agent.name} is not the entry agent of any flow in this workspace. Configure the flow; no new agent is created.`]:[]),...(!video?[pt?'Associe e escolha o vídeo já gravado.':'Attach and choose the recorded video.']:[]),...(!context?[origin==='notion'?(pt?'Leia o card escolhido ou mude para contexto colado.':'Read the chosen card or switch to pasted context.'):(pt?'Cole o contexto ou roteiro (mínimo de 20 caracteres).':'Paste the context or script (at least 20 characters).')]:[]),...(preflight?.blockers??[]).map(item=>item.message)];
 return <FlowDialog title={pt?`Começar pela edição · ${content.title}`:`Start at editing · ${content.title}`} description={pt?'Para um vídeo já gravado: nenhuma ideia ou roteiro é gerado e nenhum card é criado ou alterado.':'For a video already recorded: no idea or script is generated and no card is created or changed.'} onClose={()=>{if(!busy)onClose()}}>
  <div className="production-panel-body recorded-entry">
   <div className="production-section"><h3>{pt?'1. Vídeo gravado':'1. Recorded video'}</h3>
    <SelectMenu ariaLabel={pt?'Vídeo gravado':'Recorded video'} value={video} disabled={busy} onChange={setVideo} options={[{value:'',label:pt?'Escolher vídeo deste conteúdo':'Choose this content’s video'},...videos.map(asset=>({value:asset.id,label:asset.name,disabled:asset.status!=='available'}))]}/>
    <button className="soft-button" disabled={busy} onClick={()=>void importVideo()}>{pt?'Associar vídeo do computador':'Attach video from computer'}</button></div>
   <fieldset className="production-section production-mode" disabled={busy}><legend>{pt?'2. Contexto do vídeo':'2. Video context'}</legend>
    <label className="production-check"><input type="radio" name={`entry-origin-${session.id}`} checked={origin==='text'} onChange={()=>setOrigin('text')}/>{pt?'Colar contexto ou roteiro':'Paste context or script'}</label>
    <label className="production-check"><input type="radio" name={`entry-origin-${session.id}`} checked={origin==='notion'} onChange={()=>setOrigin('notion')}/>{pt?'Card do Notion existente (somente leitura)':'Existing Notion card (read-only)'}</label>
    {origin==='text'?<label>{pt?'Contexto do vídeo':'Video context'}<textarea aria-label={pt?'Contexto do vídeo':'Video context'} rows={6} value={text} onChange={event=>setText(event.target.value)} placeholder={pt?'Sobre o que é o vídeo, pontos principais, roteiro usado…':'What the video is about, key points, the script used…'}/></label>
    :<><label>{pt?'Link do card':'Card link'}<input aria-label={pt?'Link do card do Notion':'Notion card link'} value={cardInput} onChange={event=>setCardInput(event.target.value)} placeholder="https://www.notion.so/…"/></label>
     <button className="soft-button" disabled={busy||!cardInput.trim()} onClick={()=>void readCard()}>{busy?(pt?'Lendo…':'Reading…'):(pt?'Ler este card':'Read this card')}</button>
     <p className="editorial-hint">{pt?'Lê só este card com a conexão autorizada. Não procura outros cards nem altera nada. Se não for acessível, cole o contexto como texto.':'Reads only this card with the authorized connection. It does not search other cards or change anything. If it is not accessible, paste the context as text.'}</p>
     {card&&<blockquote className="recorded-entry-card" aria-label={pt?'Prévia do card':'Card preview'}><small>{pt?`Lido às ${new Date(card.fetchedAt).toLocaleTimeString('pt-BR')} · ${card.chars} caracteres`:`Read at ${new Date(card.fetchedAt).toLocaleTimeString('en-US')} · ${card.chars} characters`}</small><p>{card.excerpt}</p></blockquote>}</>}
   </fieldset>
   <div className="production-section"><h3>{pt?'3. Edição':'3. Editing'}</h3>
    {flows.length>1&&<label>{pt?'Fluxo':'Flow'}<SelectMenu ariaLabel={pt?'Fluxo do conteúdo':'Content flow'} value={flowId} disabled={busy} onChange={setFlow} options={flows.map(item=>({value:item.id,label:item.name}))}/></label>}
    <label>{pt?'Tipo de edição':'Editing mode'}<SelectMenu ariaLabel={pt?'Tipo de edição do vídeo gravado':'Recorded video editing mode'} value={editMode==='basic'?'basic':'smart'} disabled={busy} onChange={setEditMode} options={[{value:'smart',label:pt?'Automática: cortar silêncios e animar':'Automatic: cut silences and animate'},{value:'basic',label:pt?'Básica: um corte contínuo':'Basic: one continuous cut'}]}/></label>
    {editMode!=='basic'&&<MotionIntensityField value={motion} onChange={setMotion} pt={pt} disabled={busy} ariaLabel={pt?'Movimento na edição do vídeo gravado':'Recorded video motion'}/>}
    <label>{pt?'Formato autorizado':'Authorized format'}<SelectMenu ariaLabel={pt?'Formato do vídeo gravado':'Recorded video format'} value={format==='portrait'?'portrait':'original'} disabled={busy} onChange={setFormat} options={[{value:'original',label:pt?'Preservar enquadramento':'Keep framing'},{value:'portrait',label:pt?'Recortar para vertical 9:16':'Crop to vertical 9:16'}]}/></label></div>
   <div className="production-section recorded-entry-review" aria-label={pt?'Revisão antes de iniciar':'Review before starting'}><h3>{pt?'Revisão':'Review'}</h3>
    <ul>
     <li>{pt?'Conteúdo':'Content'}: <b>{content.title}</b> · {pt?'esta conversa':'this chat'}</li>
     <li>{pt?'Vídeo':'Video'}: {selected?`${selected.name} · #${selected.versions.find(version=>version.id===selected.currentVersionId)?.sha256.slice(0,8)??''}`:'—'}</li>
     <li>{pt?'Contexto':'Context'}: {origin==='notion'?(card?(pt?`card ${card.url} (lido, sem alterações)`:`card ${card.url} (read, unchanged)`):'—'):(text.trim()?(pt?`texto colado (${text.trim().length} caracteres)`:`pasted text (${text.trim().length} characters)`):'—')}</li>
     <li>{pt?'Quem executa':'Who runs it'}: {pt?'conversa':'chat'} {agent.name} · {pt?'edição':'editing'} {agentName('video-agent')??'—'} · {pt?'publicação':'publishing'} {agentName('publishing-agent')??agent.name}</li>
    </ul>
    <p className="editorial-hint">{pt?'O editor recebe metadados, a transcrição local quando houver e este contexto; nenhum agente vê a imagem do vídeo. Você revisa o vídeo editado antes de aprovar; nada é publicado sem sua autorização.':'The editor gets metadata, the local transcript when available and this context; no agent sees the video image. You review the edited video before approving; nothing is published without your authorization.'}</p>
    {preflight&&<ProductionPreflight report={preflight} pt={pt} busy={busy}/>}
    <label className="production-check"><input type="checkbox" checked={authorize} disabled={busy||missing.length>0} onChange={event=>setAuthorize(event.target.checked)}/>{pt?'Revisei os vínculos e autorizo iniciar a edição deste vídeo.':'I reviewed the links and authorize editing this video.'}</label>
    {missing.length>0&&<ul className="editorial-hint" aria-live="polite">{missing.map(item=><li key={item}>{item}</li>)}</ul>}
    <button className="primary-button" disabled={busy||missing.length>0||!authorize} onClick={()=>void start()}>{pt?'Iniciar edição do vídeo gravado':'Start editing the recorded video'}</button></div>
   {error&&<p className="delivery-error" role="alert">{error}</p>}{busy&&<p role="status">{pt?'Processando…':'Working…'}</p>}
  </div>
 </FlowDialog>;
}
