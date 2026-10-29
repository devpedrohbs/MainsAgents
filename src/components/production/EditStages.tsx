import {useState} from 'react';
import type {ProductionRun} from '../../features/production/model';
import {SrtWorkbench} from '../content/SrtWorkbench';
import {DeliveryReceiptCard} from '../chat/DeliveryReceiptCard';
import {storageProfile} from '../../data/IndexedDbStateStore';
import {ProjectEditingKnowledge} from '../references/ProjectEditingKnowledge';

/** Stages advance only on explicit, version-bound commands. The SRT panel receives only the chosen final video. */
export function EditStages({run,pt,busy,act,onReview}:{run:ProductionRun;pt:boolean;busy:boolean;act:(action:string,data?:Record<string,unknown>)=>Promise<ProductionRun|undefined>;onReview:()=>void}){
 const [notes,setNotes]=useState(''),[visual,setVisual]=useState('');
 const phase=run.editWorkflow?.phase,video=run.outputVideo;
 const t=(a:string,b:string)=>pt?a:b;
 if(!video)return null;
 const receipts=[...run.editorSession.messages].reverse().find(item=>item.type==='message'&&item.receipts?.some(receipt=>receipt.sha256===video.sha256));
 const name=receipts?.type==='message'?receipts.receipts?.find(item=>item.sha256===video.sha256)?.name:undefined;
 const open=()=>void window.mainsAgentsDesktop?.files?.open(storageProfile(),run.contentId,video.assetId);
 return <section className="production-section" data-od-id="edit-stages">
  <p aria-label={t('Etapas da edição','Editing stages')}>{t('1. Cortes → 2. Visual → 3. Legendas CapCut','1. Cuts → 2. Visuals → 3. CapCut captions')}</p>
  <h3>{phase==='cuts'?t('1. Revise o corte base','1. Review the cut base'):phase==='visual'?t('2. Revise o acabamento visual','2. Review the visual edit'):t('3. Legendas SRT para o CapCut','3. SRT captions for CapCut')}</h3>
  <button className="soft-button" onClick={open}>{t('Abrir esta versão do vídeo','Open this video version')}</button>
  {phase==='cuts'&&run.videoJobId&&<button className="soft-button" onClick={onReview}>{t('Conferir cortes (bruto × editado)','Review cuts (raw × edited)')}</button>}
  {receipts?.type==='message'&&receipts.receipts&&<DeliveryReceiptCard receipts={receipts.receipts.filter(receipt=>receipt.sha256===video.sha256)}/>}
  <p>{phase==='cuts'?t('Confira a fala e as emendas. O acabamento só começa depois do seu pedido.','Check speech and joins. Visual editing starts only when you request it.'):phase==='visual'?t('Os cortes, a duração e a voz são os do corte base escolhido.','Cuts, duration and voice follow the chosen cut base.'):t('Gere as legendas no CapCut sobre esta versão e importe o SRT abaixo. Corrija e baixe o arquivo para importar no mesmo projeto.','Generate captions in CapCut from this version and import the SRT below. Correct and download it for the same project.')}</p>
  {phase==='cuts'&&<>
   <ProjectEditingKnowledge contentId={run.contentId} workspaceId={run.workspaceId} pt={pt}/>
   <label>{t('Como você quer o acabamento visual?','How should the visual edit look?')}<textarea value={visual} maxLength={5000} disabled={busy} onChange={event=>setVisual(event.target.value)} placeholder={t('Ex.: aos 8 s mostre a tela da ferramenta; destaque os três passos.','E.g. at 8 s show the tool screen; highlight the three steps.')}/></label>
   <button className="primary-button" disabled={busy||!visual.trim()} onClick={()=>void act('start-visual-edit',{authorize:true,expectedVideo:video,notes:visual})}>{t('Aprovar este corte e iniciar visual','Approve this cut and start visuals')}</button>
  </>}
  {phase==='visual'&&<ProjectEditingKnowledge contentId={run.contentId} workspaceId={run.workspaceId} pt={pt} onCompose={text=>setNotes(current=>current.trim()?`${current.trim()}
${text}`:text)}/>}
  {phase!=='captions'&&<>
   <label>{phase==='cuts'?t('O que corrigir nos cortes?','What should change in the cuts?'):t('O que ajustar no visual?','What should change visually?')}<textarea value={notes} maxLength={5000} disabled={busy} onChange={event=>setNotes(event.target.value)}/></label>
   <button className="soft-button" disabled={busy||!notes.trim()} onClick={()=>void act('revise-video',{notes})}>{t('Pedir nova versão desta etapa','Request a new version of this stage')}</button>
   <button className="soft-button" disabled={busy} onClick={()=>void act('finish-visual-edit',{authorize:true,expectedVideo:video})}>{phase==='cuts'?t('Usar só os cortes e ir para legendas','Use cuts only and continue to captions'):t('Aprovar visual e ir para legendas','Approve visuals and continue to captions')}</button>
  </>}
  {phase==='captions'&&<SrtWorkbench key={`${run.contentId}:${video.sha256}`} contentId={run.contentId} workspaceId={run.workspaceId} videos={[{...video,name:name??t('Vídeo final escolhido','Chosen final video')}]} defaultVideo={video} pt={pt} embedded/>}
 </section>;
}
