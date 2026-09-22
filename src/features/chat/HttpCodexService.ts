import type { CodexEvent, CodexExecutionHandle, CodexExecutionId, CodexService, CodexSessionHandle, CreateCodexSessionInput, ResumeCodexSessionInput, SendCodexMessageInput, StreamCodexEventsInput } from './CodexService';

async function requestJson<T>(url:string, init?:RequestInit):Promise<T> {
  const response=await fetch(url,{...init,headers:{'content-type':'application/json',...(init?.headers??{})}});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(payload.error??`Codex bridge returned ${response.status}`);
  return payload as T;
}

export class HttpCodexService implements CodexService {
  constructor(private readonly baseUrl='/api/codex') {}

  createSession(input:CreateCodexSessionInput):Promise<CodexSessionHandle> {
    return requestJson(`${this.baseUrl}/sessions`,{method:'POST',body:JSON.stringify({config:input})});
  }

  resumeSession(input:ResumeCodexSessionInput):Promise<CodexSessionHandle> {
    return requestJson(`${this.baseUrl}/sessions`,{method:'POST',body:JSON.stringify({threadId:input.threadId})});
  }

  sendMessage(input:SendCodexMessageInput):Promise<CodexExecutionHandle> {
    return requestJson(`${this.baseUrl}/executions`,{method:'POST',body:JSON.stringify(input)});
  }

  cancelExecution(executionId:CodexExecutionId):Promise<void> {
    return requestJson(`${this.baseUrl}/executions/${encodeURIComponent(executionId)}/cancel`,{method:'POST'});
  }

  async *streamEvents(input:StreamCodexEventsInput):AsyncIterable<CodexEvent> {
    const response=await fetch(`${this.baseUrl}/executions/${encodeURIComponent(input.executionId)}/events`,{signal:input.signal,headers:{accept:'application/x-ndjson'}});
    if(!response.ok||!response.body)throw new Error(`Could not open Codex event stream (${response.status})`);
    const reader=response.body.getReader();
    const decoder=new TextDecoder();
    let buffer='';
    while(true){
      const {done,value}=await reader.read();
      buffer+=decoder.decode(value,{stream:!done});
      const lines=buffer.split('\n');
      buffer=lines.pop()??'';
      for(const line of lines)if(line.trim())yield JSON.parse(line) as CodexEvent;
      if(done)break;
    }
    if(buffer.trim())yield JSON.parse(buffer) as CodexEvent;
  }
}
