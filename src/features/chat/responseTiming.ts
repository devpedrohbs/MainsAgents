import type {AgentSession} from './model/Chat.ts';

export function responseElapsedMs(timing:AgentSession['responseTiming'],now=Date.now()):number {
  if(!timing)return 0;
  const start=Date.parse(timing.startedAt),end=timing.endedAt?Date.parse(timing.endedAt):now;
  return Number.isFinite(start)&&Number.isFinite(end)?Math.max(0,end-start):0;
}
export function formatResponseDuration(milliseconds:number):string {
  const seconds=Math.floor(Math.max(0,Number.isFinite(milliseconds)?milliseconds:0)/1000);
  const hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),rest=seconds%60;
  return `${hours?`${hours}:`:''}${String(hours?minutes:Math.floor(seconds/60)).padStart(2,'0')}:${String(rest).padStart(2,'0')}`;
}
export function finishResponseTiming(session:AgentSession,id:string,outcome:'completed'|'interrupted'|'error',endedAt:string,executionId?:string):AgentSession {
  if(session.responseTiming?.id!==id||session.responseTiming.endedAt)return session;
  const responseTiming={...session.responseTiming,endedAt,outcome},duration=responseElapsedMs(responseTiming);
  return {...session,responseTiming,messages:session.messages.map(item=>item.type==='message'&&item.id===`codex-${executionId}`?{...item,responseDurationMs:duration}:item)};
}
export function recoverResponseTiming(session:AgentSession):AgentSession {
  return session.responseTiming&&!session.responseTiming.endedAt?finishResponseTiming(session,session.responseTiming.id,'interrupted',session.updatedAt):session;
}
