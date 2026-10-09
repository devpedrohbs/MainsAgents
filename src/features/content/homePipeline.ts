// B01 — Home pipeline projection. Pure: the active production run (same workspace + content) decides the column;
// the content's own productionStage is only the fallback for manual contents or runs without usable evidence.
import {productionProgress} from '../production/productionProgress.ts';

export type PipelineColumnId='ideas'|'research'|'script'|'recording'|'editing'|'package'|'schedule'|'published';
export const pipelineColumnIds:PipelineColumnId[]=['ideas','research','script','recording','editing','package','schedule','published'];
const labels:Record<PipelineColumnId,[string,string]>={ideas:['Pauta','Ideas'],research:['Pesquisa','Research'],script:['Roteiro','Script'],recording:['Gravação','Recording'],editing:['Edição','Editing'],package:['Capas e pacote','Covers and package'],schedule:['Agendamento','Scheduling'],published:['Publicação','Publishing']};
export const pipelineColumnLabel=(id:PipelineColumnId,pt=true)=>labels[id][pt?0:1];

export interface PipelineRun {id?:string;workspaceId:string;contentId:string;stage:string;resumeStage?:string;imported?:boolean;updatedAt?:string;events?:Array<{action:string;detail?:string;at?:string}>;error?:string}
export interface PipelineContent {id:string;title:string;topicId?:string;workspaceId:string;productionStage?:string}
export interface PipelineTopic {id:string;title:string;workspaceId:string;status?:string}
export interface PipelineItem {id:string;title:string;topicId?:string;contentId?:string;runId?:string;/** 'run' when a production run decided the column. */source?:'run'|'content'|'topic'}

/** Coordinator linear stage → column. Unknown stages return undefined so the caller can fall back. */
const stageColumn:Record<string,PipelineColumnId>={
 writing:'script','script-review':'script',notion:'script',recording:'recording',
 'planning-edit':'editing',editing:'editing','video-review':'editing',
 platforms:'package','preparing-package':'package','generating-cover':'package','covers-review':'package','package-review':'package',
 schedule:'schedule',scheduling:'schedule',complete:'published',
};
export const columnForRunStage=(stage?:string):PipelineColumnId|undefined=>stage?stageColumn[stage]:undefined;

/** Fallback for manual contents (no run): the stored productionStage. Same buckets the Home always had. */
export function columnForContentStage(stage?:string):PipelineColumnId{
 if(stage==='ready')return 'published';
 if(stage==='editing'||stage==='video-review')return 'editing';
 if(stage==='recording'||stage==='ready-to-record')return 'recording';
 return 'script';
}

const time=(value?:string)=>{const parsed=Date.parse(value??'');return Number.isFinite(parsed)?parsed:0;};
const phaseColumn:Record<string,PipelineColumnId>={script:'script',recording:'recording',editing:'editing',package:'package',schedule:'schedule',complete:'published'};
/**
 * Column for one run, or undefined when it must not decide (canceled, imported history that cannot run,
 * or stage evidence that cannot be located). Paused/blocked runs stay where they stopped.
 */
export function runColumn(run:PipelineRun):PipelineColumnId|undefined{
 if(run.stage==='canceled')return undefined;
 const halted=run.stage==='paused'||run.stage==='blocked';
 if(halted&&run.imported)return undefined;
 if(!halted)return columnForRunStage(run.stage);
 // productionProgress owns the "where did it stop" evidence (resumeStage, then the audit trail).
 const view=productionProgress({...run,events:run.events??[],updatedAt:run.updatedAt??''} as never,true);
 const phase=view.phases.find(item=>item.status==='stopped');
 return phase?phaseColumn[phase.id]:undefined;
}

/**
 * The run that owns a content. An unfinished run always beats a completed one (a finished earlier run must not
 * pin a content that was reopened); among equals the most recently updated wins, ties by id.
 */
export function activeRunFor(contentId:string,workspaceId:string,runs:readonly PipelineRun[]):PipelineRun|undefined{
 const usable=runs.filter(run=>run&&run.contentId===contentId&&run.workspaceId===workspaceId&&runColumn(run)!==undefined);
 const rank=(run:PipelineRun)=>run.stage==='complete'?0:1;
 return [...usable].sort((a,b)=>rank(b)-rank(a)||time(b.updatedAt)-time(a.updatedAt)||String(b.id??'').localeCompare(String(a.id??'')))[0];
}

export function projectHomePipeline(input:{contents:readonly PipelineContent[];topics:readonly PipelineTopic[];runs?:readonly PipelineRun[];workspaceId:string}){
 const {workspaceId,runs=[]}=input;
 const columns=Object.fromEntries(pipelineColumnIds.map(id=>[id,[] as PipelineItem[]])) as Record<PipelineColumnId,PipelineItem[]>;
 const contents=input.contents.filter(content=>content.workspaceId===workspaceId&&content.productionStage!=='archived');
 const owned=new Set(contents.map(content=>content.topicId));
 for(const topic of input.topics.filter(item=>item.workspaceId===workspaceId&&item.status!=='rejected'&&!owned.has(item.id)))
  columns[topic.status==='researching'?'research':'ideas'].push({id:topic.id,title:topic.title,topicId:topic.id,source:'topic'});
 for(const content of contents){
  const run=activeRunFor(content.id,workspaceId,runs),column=run?runColumn(run)!:columnForContentStage(content.productionStage);
  columns[column].push({id:content.id,title:content.title,topicId:content.topicId,contentId:content.id,runId:run?.id,source:run?'run':'content'});
 }
 return columns;
}
export const pipelineCount=(columns:Record<PipelineColumnId,PipelineItem[]>)=>pipelineColumnIds.reduce((total,id)=>total+columns[id].length,0);
