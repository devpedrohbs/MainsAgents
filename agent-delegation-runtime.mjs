export const delegateTool = {
  type: 'function', name: 'mainsagents_delegate',
  description: 'Delegate a bounded task to an existing MainsAgents agent in this workspace. Opens that specialist chat, sends instructions and local file references, waits for its actual result, and returns it. Only use a target from the current available-agent catalog. Respect user approval gates; never invent approval or inaccessible video files.',
  inputSchema: {type:'object', additionalProperties:false, required:['targetAgentId','title','instructions','files'], properties:{
    targetAgentId:{type:'string',description:'ID from the available MainsAgents agent catalog.'},
    title:{type:'string',maxLength:120}, instructions:{type:'string',maxLength:32000},
    files:{type:'array',maxItems:20,items:{type:'string'},description:'Absolute paths to local files already supplied by the user, or an empty array.'},
    sessionMode:{type:'string',enum:['continue','new'],description:'Continue the connected specialist conversation by default. Use new only when the user explicitly requests another specialist session.'},
  }},
};

/** Pending app-server requests belong to one execution. Never route by agent name or last-open chat. */
export class DelegationCalls {
  constructor({reply,publish,dispatch,onCancel,timeoutMs=30*60*1000}) { this.reply=reply; this.publish=publish;this.dispatch=dispatch;this.onCancel=onCancel; this.timeoutMs=timeoutMs; this.pending=new Map(); this.seen=new Set(); }
  receive(message,config) {
    const params=message.params??{};
    const reject=(text)=>this.reply(message.id,{success:false,contentItems:[{type:'inputText',text}]});
    const input=params.arguments;
    if(params.tool!==delegateTool.name) return reject('Unsupported application tool.');
    if(!config?.targets?.some(target=>target.id===input?.targetAgentId)||!config.sourceAgentId||!config.workspaceId) return reject('Delegation is disabled or the target is outside this workspace.');
    if(typeof input.title!=='string'||!input.title.trim()||input.title.length>120||typeof input.instructions!=='string'||!input.instructions.trim()||input.instructions.length>32000||!Array.isArray(input.files)||input.files.length>20||input.files.some(file=>typeof file!=='string'||file.length>2048||!/^(?:[a-z]:[\\/]|\/[^/])[^\r\n\0]*$/i.test(file))) return reject('Invalid briefing or local file paths.');
    if(input.sessionMode!==undefined&&!['continue','new'].includes(input.sessionMode))return reject('Invalid specialist session mode.');
    const key=`${params.turnId}:${params.callId}`;
    if(this.seen.has(key))return reject('This handoff has already been dispatched.');
    this.seen.add(key);
    const timer=setTimeout(()=>this.resolve(params.turnId,params.callId,{success:false,content:'The specialist did not return a result within 30 minutes. Check its saved chat before retrying.'}),this.timeoutMs);
    timer.unref?.();
    this.pending.set(key,{id:message.id,timer,executionId:params.turnId});
    if(this.dispatch){
      this.publish(params.turnId,{type:'agent.delegation-queued',executionId:params.turnId,callId:params.callId});
      Promise.resolve().then(()=>this.dispatch(params,config)).then(result=>this.resolve(params.turnId,params.callId,result),error=>this.resolve(params.turnId,params.callId,{success:false,content:error.message}));
    }else this.publish(params.turnId,{type:'agent.delegate',executionId:params.turnId,callId:params.callId,request:input});
  }
  resolve(executionId,callId,result) {
    const key=`${executionId}:${callId}`, call=this.pending.get(key);
    if(!call)return false;
    clearTimeout(call.timer); this.pending.delete(key);
    this.reply(call.id,{success:result.success===true,contentItems:[{type:'inputText',text:String(result.content??'').slice(0,64000)}]});
    return true;
  }
  cancel(executionId) {
    this.onCancel?.(executionId);
    for(const [key,call] of this.pending)if(call.executionId===executionId){clearTimeout(call.timer);this.pending.delete(key);this.reply(call.id,{success:false,contentItems:[{type:'inputText',text:'Delegation cancelled. Do not retry automatically.'}]});}
  }
  close() { for(const call of this.pending.values())clearTimeout(call.timer);this.pending.clear();this.seen.clear(); }
}
