/**
 * Plan usage read from the providers' own structured streams, never estimated:
 *  - Claude Code CLI stream-json `rate_limit_event.rate_limit_info` (verified on the installed CLI 2.1.310): optional
 *    `unifiedWindows.{five_hour,seven_day}.{utilization,resetsAt}`, else one window as `rateLimitType` + `utilization` + `resetsAt`.
 *    `utilization` is a 0–1 fraction, `resetsAt` unix seconds. Claude has no "read limits" call: the snapshot is only as fresh
 *    as the last turn that reported it (`observedAt`), and a window never reported stays null.
 *  - Codex app-server `thread/tokenUsage/updated` (`tokenUsage.last` = the latest model request of the turn): summed per turn and
 *    reported once when the turn ends. Cached input is part of `inputTokens`, so it is split out like Claude's cache reads.
 */
const fraction=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?Math.min(100,value*100):null;
const unix=value=>Number.isSafeInteger(value)&&value>1e9&&value<1e11?value:null;
const windowOf=item=>{const usedPercent=fraction(item?.utilization);return usedPercent===null?null:{usedPercent,resetsAt:unix(item?.resetsAt)};};
const WINDOW_KEYS={five_hour:'fiveHours',seven_day:'weekly'};

export function createClaudeLimitSnapshot(now=()=>new Date().toISOString()){
 let snapshot={fiveHours:null,weekly:null,plan:null,observedAt:null};
 return {
  observe(message){
   if(message?.type!=='rate_limit_event')return;
   const info=message.rate_limit_info;if(!info||typeof info!=='object')return;
   const next={...snapshot};let seen=false;
   for(const [key,field] of Object.entries(WINDOW_KEYS)){const value=windowOf(info.unifiedWindows?.[key]);if(value){next[field]=value;seen=true;}}
   const single=WINDOW_KEYS[info.rateLimitType],value=single&&windowOf(info);
   if(value){next[single]=value;seen=true;}
   if(seen)snapshot={...next,observedAt:now()};
  },
  read:()=>({...snapshot,fetchedAt:snapshot.observedAt??now()}),
 };
}

const count=value=>Number.isSafeInteger(value)&&value>=0?value:0;
export function createCodexTurnUsage(){
 const turns=new Map();
 return {
  observe(params){
   const last=params?.tokenUsage?.last,turnId=params?.turnId;if(!turnId||!last||typeof last!=='object')return;
   const cached=count(last.cachedInputTokens),current=turns.get(turnId)??{input:0,output:0,cacheRead:0};
   turns.set(turnId,{input:current.input+Math.max(0,count(last.inputTokens)-cached),output:current.output+count(last.outputTokens),cacheRead:current.cacheRead+cached});
  },
  /** One report per turn (the accumulator is cleared), or undefined when Codex sent no token usage for it. */
  finish(turnId){
   const tokens=turns.get(turnId);turns.delete(turnId);
   return tokens?{version:1,status:'reported',provider:'codex',tokens}:undefined;
  },
 };
}
