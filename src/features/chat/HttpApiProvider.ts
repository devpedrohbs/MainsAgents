import type { AiProvider, ProviderId, ProviderStatus } from './AiProvider';
import type { CodexEvent } from './CodexService';

export class HttpApiProvider implements AiProvider {
  constructor(readonly id:Extract<ProviderId,'gemini'>){}
  private get base(){return `/api/providers/${this.id}`}
  private async json<T>(path:string,init?:RequestInit):Promise<T>{const response=await fetch(`${this.base}${path}`,{...init,headers:{'content-type':'application/json',...(init?.headers??{})}});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error??`${this.id} returned ${response.status}`);return data as T}
  async getStatus():Promise<ProviderStatus>{try{const data=await this.json<Omit<ProviderStatus,'capabilities'>>('/status');return {...data,capabilities:{streaming:true,cancellation:true,remoteResume:false,webSearch:false,files:false,tools:['canvas-context']}}}catch(error){return {providerId:this.id,state:'error',authMode:'api-key',billingDescription:'Google AI project quota/billing',capabilities:{streaming:true,cancellation:true,remoteResume:false,webSearch:false,files:false,tools:['canvas-context']},message:error instanceof Error?error.message:String(error)}}}
  async listModels(){const data=await this.json<{models:{id:string;name:string}[]}>('/models');return data.models}
  async createSession(){return {remoteSessionId:crypto.randomUUID()}}
  async resumeSession(remoteSessionId:string){return {remoteSessionId}}
  sendMessage(input:Parameters<AiProvider['sendMessage']>[0]){return this.json<{executionId:string;remoteSessionId:string}>('/executions',{method:'POST',body:JSON.stringify(input)})}
  cancelExecution(executionId:string){return this.json<void>(`/executions/${encodeURIComponent(executionId)}/cancel`,{method:'POST'})}
  async *streamEvents(input:Parameters<AiProvider['streamEvents']>[0]):AsyncIterable<CodexEvent>{const response=await fetch(`${this.base}/executions/${encodeURIComponent(input.executionId)}/events`,{signal:input.signal});if(!response.ok||!response.body)throw new Error(`Could not open ${this.id} stream`);const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';while(true){const {done,value}=await reader.read();buffer+=decoder.decode(value,{stream:!done});const lines=buffer.split('\n');buffer=lines.pop()??'';for(const line of lines)if(line.trim())yield JSON.parse(line) as CodexEvent;if(done)break}if(buffer.trim())yield JSON.parse(buffer) as CodexEvent}
}
