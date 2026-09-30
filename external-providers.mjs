import { randomUUID } from 'node:crypto';

const providers={
  gemini:{name:'Gemini Developer API',billing:'Billed or quota-limited by your Google AI project',models:'https://generativelanguage.googleapis.com/v1beta/models'},
};
function json(response,status,value){response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});response.end(JSON.stringify(value))}
async function body(request){let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>2_000_000)throw new Error('Message exceeds 2 MB');chunks.push(chunk)}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}
function credentials(_provider,key){return {'x-goog-api-key':key}}
function requestError(response){return new Error(`Provider returned ${response.status}`)}
async function* sse(response){if(!response.body)throw new Error('Provider did not return a stream');const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';while(true){const {done,value}=await reader.read();buffer+=decoder.decode(value,{stream:!done});const frames=buffer.split(/\r?\n\r?\n/);buffer=frames.pop()??'';for(const frame of frames){const data=frame.split(/\r?\n/).filter((line)=>line.startsWith('data:')).map((line)=>line.slice(5).trim()).join('\n');if(!data||data==='[DONE]')continue;try{yield JSON.parse(data)}catch{}}if(done)break}}

export function geminiThinkingConfig(modelId,effort){
  if(!['low','medium','high','xhigh'].includes(effort))return undefined;
  const model=String(modelId??'').toLowerCase();
  if(model.startsWith('gemini-3'))return {thinkingLevel:effort==='xhigh'?'high':effort};
  if(model.startsWith('gemini-2.5'))return {thinkingBudget:({low:1024,medium:8192,high:16384,xhigh:24576})[effort]};
  return undefined;
}

export function createExternalProviderBridge({getKey,fetchImpl=fetch}){
  const executions=new Map();
  const publish=(record,event)=>{if(record.done)return;record.events.push(event);for(const listener of record.listeners)listener(event);if(['execution.completed','execution.cancelled','execution.failed'].includes(event.type))record.done=true};
  const listModels=async(provider,key)=>{const response=await fetchImpl(providers[provider].models,{headers:credentials(provider,key),signal:AbortSignal.timeout(15000)});if(!response.ok)throw requestError(response);const data=await response.json();return (data.models??[]).filter((item)=>(item.supportedGenerationMethods??[]).includes('generateContent')).map((item)=>({id:item.name.replace(/^models\//,''),name:item.displayName??item.name}))};
  const run=async(record,input,key)=>{
    const {provider,id,controller}=record;
    const history=Array.isArray(input.history)?input.history.filter((item)=>['user','agent'].includes(item.role)&&typeof item.content==='string').slice(-30):[];
    const context=Array.isArray(input.context)?input.context.map((item)=>`[${String(item.kind??'note')}] ${String(item.label??'')}${item.content?`\n${String(item.content)}`:''}`).join('\n\n'):'';
    const content=context?`${input.content}\n\nWorkspace context:\n${context}`:input.content;
    const messages=[...history,{role:'user',content}];
    try{
      publish(record,{type:'execution.started',executionId:id,threadId:record.remoteSessionId});
      let response;
      const thinkingConfig=geminiThinkingConfig(input.modelId,input.reasoningEffort);
      const generationConfig=thinkingConfig?{thinkingConfig}:{};
      response=await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.modelId)}:streamGenerateContent?alt=sse`,{method:'POST',headers:{'content-type':'application/json',...credentials(provider,key)},body:JSON.stringify({systemInstruction:{parts:[{text:input.instructions??''}]},contents:messages.map((item)=>({role:item.role==='agent'?'model':'user',parts:[{text:item.content}]})),...(Object.keys(generationConfig).length?{generationConfig}:{})}),signal:controller.signal});
      if(!response.ok)throw requestError(response);
      let full='';
      for await(const chunk of sse(response)){
        if(chunk.type==='error')throw new Error(chunk.error?.message??'Provider stream error');
        const delta=(chunk.candidates?.[0]?.content?.parts??[]).map((part)=>part.text??'').join('');
        if(delta){full+=delta;publish(record,{type:'message.delta',executionId:id,delta})}
      }
      publish(record,{type:'message.completed',executionId:id,content:full});
      publish(record,{type:'execution.completed',executionId:id});
    }catch(error){publish(record,controller.signal.aborted?{type:'execution.cancelled',executionId:id}:{type:'execution.failed',executionId:id,code:'provider_error',message:error instanceof Error?error.message:'Provider request failed',retryable:true})}
  };
  const handle=async(request,response,url)=>{
    const match=url.pathname.match(/^\/api\/providers\/(gemini)(?:\/(.*))?$/);
    if(!match)return json(response,404,{error:'Provider not found'});
    const [,provider,route='']=match;
    try{
      const key=await getKey(provider);
      if(request.method==='GET'&&route==='status'){
        if(!key)return json(response,200,{providerId:provider,state:'login-required',authMode:'api-key',billingDescription:providers[provider].billing});
        try{await listModels(provider,key);return json(response,200,{providerId:provider,state:'connected',authMode:'api-key',billingDescription:providers[provider].billing})}catch(error){return json(response,200,{providerId:provider,state:'error',authMode:'api-key',billingDescription:providers[provider].billing,message:error.message})}
      }
      if(!key)return json(response,401,{error:`Add your ${providers[provider].name} key in Settings`});
      if(request.method==='GET'&&route==='models')return json(response,200,{models:await listModels(provider,key)});
      if(request.method==='POST'&&route==='executions'){
        const input=await body(request);
        if(typeof input.modelId!=='string'||!/^[\w.-]+$/.test(input.modelId)||typeof input.content!=='string'||!input.content.trim())return json(response,400,{error:'Choose a model and enter a message'});
        const id=randomUUID(),remoteSessionId=String(input.remoteSessionId??randomUUID());
        const record={provider,id,remoteSessionId,events:[],listeners:new Set(),done:false,controller:new AbortController()};
        executions.set(id,record);
        void run(record,input,key);
        return json(response,200,{executionId:id,remoteSessionId});
      }
      const events=route.match(/^executions\/([^/]+)\/events$/);
      if(request.method==='GET'&&events){const record=executions.get(events[1]);if(!record||record.provider!==provider)return json(response,404,{error:'Execution not found'});response.writeHead(200,{'content-type':'application/x-ndjson; charset=utf-8','cache-control':'no-store'});const write=(event)=>response.write(`${JSON.stringify(event)}\n`);record.events.forEach(write);if(record.done)return response.end();const finish=(event)=>{if(['execution.completed','execution.cancelled','execution.failed'].includes(event.type)){record.listeners.delete(write);record.listeners.delete(finish);response.end()}};record.listeners.add(write);record.listeners.add(finish);request.on('close',()=>{record.listeners.delete(write);record.listeners.delete(finish)});return}
      const cancel=route.match(/^executions\/([^/]+)\/cancel$/);
      if(request.method==='POST'&&cancel){const record=executions.get(cancel[1]);if(!record||record.provider!==provider)return json(response,404,{error:'Execution not found'});record.controller.abort();return json(response,200,{})}
      return json(response,404,{error:'Not found'});
    }catch(error){return json(response,500,{error:error instanceof Error?error.message:'Provider request failed'})}
  };
  return {handle};
}
