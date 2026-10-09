import type {AgentSession,ChatActivityItem,ChatItem,ChatRunOutcome} from './model/Chat.ts';

export function responseElapsedMs(timing:{startedAt:string;endedAt?:string}|undefined,now=Date.now()):number {
  if(!timing)return 0;
  const start=Date.parse(timing.startedAt),end=timing.endedAt?Date.parse(timing.endedAt):now;
  return Number.isFinite(start)&&Number.isFinite(end)?Math.max(0,end-start):0;
}
export function formatResponseDuration(milliseconds:number):string {
  const seconds=Math.floor(Math.max(0,Number.isFinite(milliseconds)?milliseconds:0)/1000);
  const hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),rest=seconds%60;
  return `${hours?`${hours}:`:''}${String(hours?minutes:Math.floor(seconds/60)).padStart(2,'0')}:${String(rest).padStart(2,'0')}`;
}

export const runItemId=(timingId:string)=>`run-${timingId}`;
/** The one status line shown for an execution, created when the turn starts. */
export function startRunItem(timingId:string,startedAt:string):ChatActivityItem {
  return {id:runItemId(timingId),type:'activity',kind:'run',label:'',status:'running',startedAt};
}
export const isRunItem=(item:ChatItem):item is ChatActivityItem=>item.type==='activity'&&item.kind==='run';
/** Per-tool progress rows (thinking, commands, file edits). Saved for diagnostics, never rendered as feed rows. */
export const isToolStep=(item:ChatItem):item is ChatActivityItem=>item.type==='activity'&&item.kind!=='run'&&item.id.startsWith('codex-activity-');

export function finishResponseTiming(session:AgentSession,id:string,outcome:ChatRunOutcome,endedAt:string,executionId?:string):AgentSession {
  if(session.responseTiming?.id!==id||session.responseTiming.endedAt)return session;
  const responseTiming={...session.responseTiming,endedAt,outcome},duration=responseElapsedMs(responseTiming);
  return {...session,responseTiming,messages:session.messages.map(item=>item.type==='message'&&item.id===`codex-${executionId}`?{...item,responseDurationMs:duration}:item.type==='activity'&&item.id===runItemId(id)&&!item.endedAt?{...item,status:outcome==='error'?'error':'done',endedAt,outcome}:item)};
}
export function recoverResponseTiming(session:AgentSession):AgentSession {
  const recovered=session.responseTiming&&!session.responseTiming.endedAt?finishResponseTiming(session,session.responseTiming.id,'interrupted',session.updatedAt):session;
  // A run line left open by an older crash never keeps counting after a restart.
  return recovered.messages.some(item=>isRunItem(item)&&!item.endedAt)?{...recovered,messages:recovered.messages.map(item=>isRunItem(item)&&!item.endedAt?{...item,status:'done',endedAt:session.updatedAt,outcome:'interrupted'}:item)}:recovered;
}

export type ChatFeedEntry =
  | {kind:'item';item:ChatItem}
  | {kind:'run';run:ChatActivityItem;steps:ChatActivityItem[]};
/** Main chat feed: messages, real errors and one status line per execution with its tool steps folded inside. */
export function chatFeed(messages:readonly ChatItem[]):ChatFeedEntry[] {
  const feed:ChatFeedEntry[]=[];let current:Extract<ChatFeedEntry,{kind:'run'}>|undefined;
  for(const item of messages){
    if(isRunItem(item)){current={kind:'run',run:item,steps:[]};feed.push(current);continue;}
    if(isToolStep(item)){current?.steps.push(item);continue;}
    feed.push({kind:'item',item});
  }
  return feed;
}
