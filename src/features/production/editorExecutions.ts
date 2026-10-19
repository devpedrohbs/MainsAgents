// Pure (type-only imports): also loaded by node tests.
import type {EditorExecution,EditorStop,ProductionRun} from './model';

/**
 * What the edit director really ran, read from the runtime's own execution records (`run.authoring`). The configured choice
 * (`run.editDirector`) says who SHOULD direct; an execution says who DID. A model is shown only when the provider reported it;
 * a requested model is labelled as requested, never as confirmed.
 */
export const lastExecution=(run:Pick<ProductionRun,'authoring'>):EditorExecution|undefined=>run.authoring?.executions?.at(-1);
const provider=(id:string|null|undefined,pt:boolean)=>id==='claude'?'Claude Code':id==='codex'?'Codex':id||(pt?'provedor não registrado':'provider not recorded');
export function executionModel(item:EditorExecution,pt:boolean){
 if(item.model)return item.model;
 if(item.requestedModel)return pt?`${item.requestedModel} (pedido; não confirmado pelo provedor)`:`${item.requestedModel} (requested; not confirmed by the provider)`;
 return pt?'modelo não informado pelo provedor':'model not reported by the provider';
}
export function executionOutcome(item:EditorExecution,pt:boolean){
 const turns=item.maxTurns?` (${item.numTurns??'?'}/${item.maxTurns} ${pt?'turnos':'turns'})`:'';
 return item.outcome==='completed'?(pt?'concluída':'completed'):item.outcome==='turn_limit'?`${pt?'parou no limite de turnos':'stopped at the turn limit'}${turns}`:`${pt?'falhou':'failed'}${item.code?` · ${item.code}`:''}`;
}
/** Short line: "Claude Code · claude-x · parou no limite de turnos (20/20 turnos)". */
export const executionText=(item:EditorExecution,pt:boolean)=>`${provider(item.providerId,pt)} · ${executionModel(item,pt)} · ${executionOutcome(item,pt)}`;
export const executionKind=(item:EditorExecution,pt:boolean)=>item.kind==='continuation'?(pt?`continuação ${item.continuation}`:`continuation ${item.continuation}`):(pt?'execução inicial':'initial run');
export const executionProgress=(item:EditorExecution,pt:boolean)=>{
 const revision=item.revisionBefore!=null&&item.revisionAfter!=null&&item.revisionBefore!==item.revisionAfter?`${pt?'revisão':'revision'} ${item.revisionBefore}→${item.revisionAfter}`:item.revisionAfter!=null?`${pt?'revisão':'revision'} ${item.revisionAfter}`:'';
 const calls=item.callsAfter!=null?`${item.callsBefore!=null?`${item.callsBefore}→`:''}${item.callsAfter} ${pt?'chamada(s) de ferramenta':'tool call(s)'}`:'';
 return [revision,calls].filter(Boolean).join(' · ');
};
const stopReasons:Record<string,[string,string]>={
 turn_limit:['a execução atingiu o limite de turnos','the run reached its turn limit'],
 no_progress:['a última execução não avançou o checkpoint','the last run did not advance the checkpoint'],
 continuation_cap:['as continuações desta edição já foram usadas','this edit’s continuations are used up'],
 host_budget:['o orçamento de ferramentas do editor está no fim','the editor’s tool budget is exhausted'],
 cancelled:['a edição foi cancelada','the edit was canceled'],
 no_checkpoint:['não há checkpoint válido desta revisão','there is no valid checkpoint for this revision'],
 finalized:['a exportação final já foi pedida','the final export was already requested'],
};
/** Turn-limit stop: the useful facts and what Resume will do (continue from the checkpoint, or not). */
export function stopSummary(stop:EditorStop,pt:boolean){
 const turns=stop.maxTurns?`${stop.numTurns??'?'}/${stop.maxTurns} ${pt?'turnos':'turns'}`:(pt?'limite de turnos':'turn limit');
 const facts=[turns,stop.revision!=null?`${pt?'revisão':'revision'} ${stop.revision}`:'',stop.calls!=null?`${stop.calls} ${pt?'chamada(s) de ferramenta':'tool call(s)'}`:'',stop.callsLeft!=null?`${stop.callsLeft} ${pt?'restante(s)':'left'}`:'',stop.maxContinuations!=null?`${pt?'continuações':'continuations'} ${stop.continuationsUsed??0}/${stop.maxContinuations}`:''].filter(Boolean).join(' · ');
 const reason=stopReasons[stop.reason??'']?.[pt?0:1]??stop.reason??'';
 const next=stop.continuable?(pt?'Retomar continua do checkpoint salvo, sem refazer o que foi feito (usa mais tokens).':'Resume continues from the saved checkpoint without redoing work (uses more tokens).'):(pt?'Retomar não continua esta edição: escolha outro diretor ou peça um ajuste.':'Resume will not continue this edit: choose another director or request a revision.');
 return {facts,reason,next};
}
/**
 * How Resume behaves for an edit stopped by the director, from the runtime's public records only:
 * - 'restart': the director/model changed after the stop (`authoring.restartPending`); Resume starts a new plan (previous plan as
 *   reference), so the old checkpoint is NOT promised;
 * - 'checkpoint': confirmed turn-limit stop that can continue from the saved checkpoint;
 * - 'stopped': confirmed turn-limit stop that Resume will not continue;
 * - undefined: any other interruption (generic, uncertain flow with the resend authorization).
 */
export type ResumeMode='restart'|'checkpoint'|'stopped'|'provider-wait';
export function resumeMode(run:Pick<ProductionRun,'authoring'|'resumeStage'|'stage'>&{blockReason?:ProductionRun['blockReason'];providerWait?:ProductionRun['providerWait']}):ResumeMode|undefined{
 // 'provider-wait': stopped by a provider usage limit; Resume (explicit) continues from what was kept, nothing restarts.
 if(run.stage==='blocked'&&run.blockReason==='provider-limit'&&run.providerWait)return 'provider-wait';
 if(!['blocked','paused'].includes(run.stage)||!['planning-edit','editing'].includes(run.resumeStage??''))return undefined;
 if(run.authoring?.restartPending)return 'restart';
 const stop=run.authoring?.lastStop;
 if(stop?.code!=='editor_turn_limit')return undefined;
 return stop.continuable?'checkpoint':'stopped';
}
