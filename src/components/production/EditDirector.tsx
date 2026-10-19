import {useEffect,useState} from 'react';
import {SelectMenu} from '../common/SelectMenu';
import {useChoiceCatalogs,choiceStatus} from '../chat/ProviderChoice';
import {useProduction,type EditDirector} from '../../features/production/ProductionProvider';
import type {ProductionRun} from '../../features/production/model';

const providerName=(id:string,pt:boolean)=>id==='claude'?'Claude Code':id==='codex'?'Codex':id==='agent'?(pt?'o próprio agente editor':'the editor agent itself'):id;
/** Director sent with the video for THIS production only (never the workspace default). */
export type PendingDirector={providerId:EditDirector['providerId'];modelId?:string};
export const directorPayload=(value?:PendingDirector)=>value?{providerId:value.providerId,...(value.modelId&&value.providerId!=='agent'?{modelId:value.modelId}:{})}:undefined;

/**
 * Who directs the edit and the motion (a function choice, not an agent change; the editor agent's role, instructions and skills
 * are always used). Three modes, each saying what it changes:
 * - no run (recorded entry): the workspace default;
 * - run still recording: a choice for this production only, sent with the video (`pending`/`onPending`); unchanged = workspace default;
 * - edit being planned, blocked or paused: changes this run explicitly (`set-edit-director`). Afterwards it is read-only.
 */
export function EditDirectorField({run,pt,busy,act,editorName,editorProvider,workspaceId:workspace,pending,onPending}:{run?:ProductionRun;pt:boolean;busy:boolean;act?:(type:string,data:Record<string,unknown>)=>Promise<unknown>;editorName?:string;editorProvider?:string;workspaceId?:string;pending?:PendingDirector;onPending?:(value?:PendingDirector)=>void}){
 const {editDirector,setEditDirector}=useProduction(),workspaceId=run?.workspaceId??workspace,catalogs=useChoiceCatalogs();
 const [saved,setSaved]=useState<EditDirector|null>(null),[error,setError]=useState('');
 const perRun=!!run&&(run.stage==='planning-edit'||['blocked','paused'].includes(run.stage)&&['planning-edit','editing'].includes(run.resumeStage??''));
 const beforeSend=!!run&&run.stage==='recording'&&!!onPending;
 const preference=!run;
 const editable=perRun||beforeSend||preference;
 useEffect(()=>{let live=true;if(workspaceId&&(preference||beforeSend))void editDirector(workspaceId).then(value=>{if(live)setSaved(value)}).catch(()=>{});return()=>{live=false};},[workspaceId,preference,beforeSend]);// eslint-disable-line react-hooks/exhaustive-deps
 const fromRun=!!run?.editDirector&&!beforeSend;
 const current:PendingDirector=beforeSend&&pending?pending:fromRun?{providerId:run!.editDirector!.choice,modelId:run!.editDirector!.choice==='agent'?undefined:run!.editDirector!.model}:{providerId:saved?.providerId??'claude',modelId:saved?.modelId};
 const agentProvider=editorProvider??run?.editorAgent?.providerId??run?.providers?.editor;
 const label=fromRun?`${run!.editDirector!.name} · ${providerName(run!.editDirector!.provider,pt)} · ${run!.editDirector!.model||(pt?'modelo padrão do CLI':'CLI default model')}`:undefined;
 const same=(next:PendingDirector)=>next.providerId===current.providerId&&(next.providerId==='agent'||(next.modelId??'')===(current.modelId??''));
 const apply=async(next:PendingDirector)=>{setError('');const director=directorPayload(next)!;
  // Picking the same (normalized) choice is a no-op: no command, so the run's checkpoint and diagnostics stay as they are.
  if(perRun&&same(next))return;
  try{if(beforeSend)onPending!(next);else if(perRun&&act)await act('set-edit-director',{authorize:true,director});else if(workspaceId)setSaved(await setEditDirector(workspaceId,director));}catch(failure){setError((failure as Error).message)}};
 // Changing who directs resets the model: a Codex model is never kept for Claude (or vice versa).
 const changeProvider=(value:string)=>{if(value!==current.providerId)void apply({providerId:value as EditDirector['providerId']});};
 const changeModel=(modelId:string)=>void apply({providerId:current.providerId,...(modelId?{modelId}:{})});
 const catalog=current.providerId==='agent'?undefined:catalogs[current.providerId];
 const agentLabel=`${editorName?` (${editorName}${agentProvider?` · ${providerName(String(agentProvider),pt)}`:''})`:''}`;
 const scopeText=beforeSend?(pt?'Vale só para esta produção e é enviado junto com o vídeo; o padrão do espaço não muda.':'Applies to this production only and is sent with the video; the workspace default does not change.')
  :perRun&&run!.stage!=='planning-edit'?(pt?'Muda só esta produção. Nada roda agora: ao retomar, a edição recomeça o planejamento com este diretor e modelo (o plano anterior serve de referência). Repetir a escolha atual não muda nada.':'Changes this production only. Nothing runs now: on resume, the edit plans again with this director and model (the previous plan is a reference). Re-picking the current choice changes nothing.')
  :perRun?(pt?'Muda só esta produção; a edição recomeça do planejamento sem refazer o roteiro.':'Changes this production only; the edit restarts from planning without redoing the script.')
  :preference?(pt?'Padrão do espaço para novas edições.':'Workspace default for new edits.'):'';
 return <div className="edit-director" data-od-id="edit-director" data-mode={beforeSend?'production':perRun?'run':preference?'workspace':'read-only'}>
  <label>{pt?'Quem dirige os cortes e o motion':'Who directs cuts and motion'}
   <SelectMenu ariaLabel={pt?'Quem dirige a edição':'Edit director'} value={current.providerId} disabled={busy||!editable} onChange={changeProvider} options={[
    {value:'claude',label:pt?'Claude Code (recomendado para edição/motion)':'Claude Code (recommended for editing/motion)'},
    {value:'codex',label:'Codex'},
    {value:'agent',label:pt?`Próprio agente editor${agentLabel}`:`Editor agent itself${agentLabel}`}]}/>
  </label>
  {catalog&&editable&&<label>{pt?'Modelo da direção':'Director model'}
   <SelectMenu ariaLabel={pt?'Modelo de quem dirige a edição':'Edit director model'} value={current.modelId??''} disabled={busy||catalog.state==='checking'} onChange={changeModel} options={[{value:'',label:pt?'Modelo padrão (do agente editor se for o mesmo provedor)':'Default model (the editor agent’s when same provider)'},...(current.modelId&&!catalog.models.some(model=>model.id===current.modelId)?[{value:current.modelId,label:current.modelId}]:[]),...catalog.models.map(model=>({value:model.id,label:model.name}))]}/>
  </label>}
  {catalog&&editable&&catalog.state!=='connected'&&<p role="status">{providerName(current.providerId,pt)}: {choiceStatus(catalog.state,pt)}{pt?'. Conecte antes de editar; senão a edição para e mostra o motivo.':'. Connect before editing; otherwise the edit stops and shows why.'}</p>}
  <p className="editorial-hint">{label?(pt?`Direção desta edição: ${label}. `:`This edit is directed by ${label}. `):''}{scopeText?`${scopeText} `:''}{pt?'Usa o papel, as instruções e as skills do agente editor; nenhum agente ou conversa é alterado.':'Uses the editor agent role, instructions and skills; no agent or chat is changed.'}</p>
  {error&&<p role="alert">{error}</p>}
 </div>;
}
