import type { AiProvider, ProviderStatus } from './AiProvider';
import type { CodexEvent } from './CodexService';

export class ClaudeCliProvider implements AiProvider {
  readonly id='claude' as const;
  private get base(){return '/api/providers/claude'}
  private async json<T>(path:string,init?:RequestInit):Promise<T>{
    const response=await fetch(`${this.base}${path}`,{...init,headers:{'content-type':'application/json',...(init?.headers??{})}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error??`Claude Code CLI returned ${response.status}`);
    return data as T;
  }
  async getStatus():Promise<ProviderStatus>{
    try{
      const data=await this.json<Omit<ProviderStatus,'capabilities'>>('/status');
      return {...data,capabilities:{streaming:true,cancellation:true,remoteResume:true,webSearch:true,files:true,tools:['web-search','files','canvas-context']}};
    }catch(error){
      return {providerId:'claude',state:'error',authMode:'cli',billingDescription:'Uses Claude Code CLI authentication and billing.',capabilities:{streaming:true,cancellation:true,remoteResume:true,webSearch:true,files:true,tools:['web-search','files','canvas-context']},message:error instanceof Error?error.message:String(error)};
    }
  }
  async listModels(){const data=await this.json<{models:{id:string;name:string}[]}>('/models');return data.models}
  async createSession(input:Parameters<AiProvider['createSession']>[0]){
    const data=await this.json<{remoteSessionId:string}>('/sessions',{method:'POST',body:JSON.stringify(input)});
    return {remoteSessionId:data.remoteSessionId};
  }
  async resumeSession(remoteSessionId:string){
    const data=await this.json<{remoteSessionId:string}>(`/sessions/${encodeURIComponent(remoteSessionId)}/resume`,{method:'POST'});
    return {remoteSessionId:data.remoteSessionId};
  }
  sendMessage(input:Parameters<AiProvider['sendMessage']>[0]){
    return this.json<{executionId:string;remoteSessionId:string}>('/executions',{method:'POST',body:JSON.stringify(input)});
  }
  cancelExecution(executionId:string){return this.json<void>(`/executions/${encodeURIComponent(executionId)}/cancel`,{method:'POST'})}
  async *streamEvents(input:Parameters<AiProvider['streamEvents']>[0]):AsyncIterable<CodexEvent>{
    const response=await fetch(`${this.base}/executions/${encodeURIComponent(input.executionId)}/events`,{signal:input.signal});
    if(!response.ok||!response.body)throw new Error('Could not open the Claude Code CLI stream');
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
    while(true){
      const {done,value}=await reader.read();
      buffer+=decoder.decode(value,{stream:!done});
      const lines=buffer.split('\n');buffer=lines.pop()??'';
      for(const line of lines)if(line.trim())yield JSON.parse(line) as CodexEvent;
      if(done)break;
    }
    if(buffer.trim())yield JSON.parse(buffer) as CodexEvent;
  }
}
