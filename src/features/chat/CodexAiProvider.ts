import type { AiProvider, ProviderStatus } from './AiProvider';
import type { CodexService } from './CodexService';

export class CodexAiProvider implements AiProvider {
  readonly id='codex' as const;
  constructor(private readonly service:CodexService){}
  async getStatus():Promise<ProviderStatus>{
    try{const response=await fetch('/api/codex/health');const data=await response.json();return {providerId:'codex',state:data.ready?'connected':data.status==='login-required'?'login-required':'not-installed',authMode:data.accountType==='chatgpt'?'chatgpt':data.accountType==='apiKey'?'api-key':'unknown',billingDescription:data.accountType==='apiKey'?'OpenAI API billing':'ChatGPT/Codex account',capabilities:{streaming:true,cancellation:true,remoteResume:true,webSearch:true,files:true,tools:['web-search','files','canvas-context','subagents']},message:data.error}}catch(error){return {providerId:'codex',state:'error',authMode:'unknown',billingDescription:'ChatGPT/Codex account',capabilities:{streaming:true,cancellation:true,remoteResume:true,webSearch:true,files:true,tools:['web-search','files','canvas-context','subagents']},message:error instanceof Error?error.message:String(error)}}
  }
  async listModels(){const response=await fetch('/api/codex/models');if(!response.ok)throw new Error('Could not list Codex models');const data=await response.json();return data.models as {id:string;name:string}[]}
  async createSession(input:Parameters<AiProvider['createSession']>[0]){const result=await this.service.createSession({...input});return {remoteSessionId:result.threadId}}
  async resumeSession(remoteSessionId:string){const result=await this.service.resumeSession({threadId:remoteSessionId});return {remoteSessionId:result.threadId}}
  async sendMessage(input:Parameters<AiProvider['sendMessage']>[0]){const result=await this.service.sendMessage({threadId:input.remoteSessionId,content:input.content,modelId:input.modelId,reasoningEffort:input.reasoningEffort,context:input.context});return {executionId:result.executionId,remoteSessionId:result.threadId}}
  cancelExecution(executionId:string){return this.service.cancelExecution(executionId)}
  streamEvents(input:Parameters<AiProvider['streamEvents']>[0]){return this.service.streamEvents(input)}
}
