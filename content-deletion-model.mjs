/** Pure, environment-free part of the local content deletion (shared by the host and the renderer). */
/** Renderer state keys that may point at a content's chats; all of them are cleaned in the same transaction. */
export const linkedStateKeys=Object.freeze(['sessions','active-sessions','content-scopes','production-flows','chat-drafts','studio-drafts']);
const draftParts=key=>{try{const parts=JSON.parse(key);return Array.isArray(parts)?parts:[];}catch{return [];}};
/**
 * Removes every entry of a linked renderer key that belongs to deleted ids. Pure and idempotent; returns the same object
 * when nothing changes (the state store then keeps the caller's revision chain untouched).
 */
export function sanitizeLinkedValue(key,value,ids){
 const {sessions=new Set(),contents=new Set(),runs=new Set(),artifacts=new Set()}=ids;
 if(!sessions.size&&!contents.size)return value;
 const goneSession=id=>typeof id==='string'&&sessions.has(id);
 const goneScope=scope=>typeof scope==='string'&&scope.startsWith('content:')&&contents.has(scope.slice(8));
 if(key==='sessions'&&Array.isArray(value)){
  const kept=value.filter(session=>!goneSession(session?.id)&&!(session?.contentId&&contents.has(session.contentId)));
  const next=kept.map(session=>goneSession(session?.agentConnection?.targetSessionId)?{...session,agentConnection:{...session.agentConnection,targetSessionId:undefined}}:session);
  return next.length===value.length&&next.every((item,index)=>item===value[index])?value:next;
 }
 if(key==='active-sessions'&&value&&typeof value==='object'){
  const entries=Object.entries(value).filter(([,id])=>!goneSession(id));
  return entries.length===Object.keys(value).length?value:Object.fromEntries(entries);
 }
 if(key==='content-scopes'&&value&&typeof value==='object'&&value.selected&&value.active){
  const selected=Object.fromEntries(Object.entries(value.selected).map(([workspace,scope])=>[workspace,goneScope(scope)?'general':scope]));
  const active=Object.fromEntries(Object.entries(value.active).filter(([slot,id])=>!goneSession(id)&&!goneScope(draftParts(slot)[2])&&!goneScope(slot.split('|')[2])));
  return JSON.stringify(selected)===JSON.stringify(value.selected)&&Object.keys(active).length===Object.keys(value.active).length?value:{...value,selected,active};
 }
 if(key==='production-flows'&&value&&Array.isArray(value.flows)){
  let changed=false;
  const flows=value.flows.map(flow=>{
   const nodes=Array.isArray(flow.nodes)?flow.nodes.map(node=>{if(!goneSession(node?.sessionId))return node;changed=true;const {sessionId:_s,...rest}=node;return rest;}):flow.nodes;
   if(flow.contentId&&contents.has(flow.contentId)){changed=true;const {contentId:_c,...rest}=flow;return {...rest,nodes};}
   return nodes===flow.nodes?flow:{...flow,nodes};
  });
  return changed?{...value,flows}:value;
 }
 if(key==='chat-drafts'&&value&&typeof value==='object'){
  const entries=Object.entries(value).filter(([draft])=>{const parts=draftParts(draft);return !goneSession(parts[1])&&!goneScope(parts[3]);});
  return entries.length===Object.keys(value).length?value:Object.fromEntries(entries);
 }
 if(key==='studio-drafts'&&value&&typeof value==='object'){
  const gone=part=>typeof part==='string'&&(sessions.has(part)||contents.has(part)||runs.has(part)||artifacts.has(part));
  const entries=Object.entries(value).filter(([draft])=>!draftParts(draft).some(gone));
  return entries.length===Object.keys(value).length?value:Object.fromEntries(entries);
 }
 return value;
}

/**
 * Drops every record of deleted contents from an editorial state (a stale window's copy, or a backup being restored) and
 * the topic's pointer to them; the idea/topic itself stays. Returns the same object when nothing belongs to them.
 */
export function stripDeletedEditorial(state,ids){
 const {contents=new Set(),artifacts=new Set()}=ids;
 if(!state||typeof state!=='object'||!contents.size)return state;
 const gone=item=>contents.has(item?.contentId);
 const filters={contents:item=>!contents.has(item?.id),artifacts:item=>!gone(item)&&!artifacts.has(item?.id),approvals:item=>!gone(item)&&!artifacts.has(item?.artifactId),runs:item=>!gone(item),assets:item=>!gone(item),publications:item=>!gone(item)};
 let changed=false;const next={...state};
 for(const [key,keep] of Object.entries(filters))if(Array.isArray(state[key])){const kept=state[key].filter(keep);if(kept.length!==state[key].length){next[key]=kept;changed=true;}}
 if(Array.isArray(state.topics)&&state.topics.some(gone)){changed=true;next.topics=state.topics.map(topic=>{if(!gone(topic))return topic;const {contentId:_c,...rest}=topic;return rest;});}
 return changed?next:state;
}

