import {readFileSync,statSync} from 'node:fs';
import {findSkills} from './skill-discovery.mjs';
import {chatActionConfig,chatApprovalPolicy} from './codex-action-policy.mjs';
export function declaredSkillRequirements(text){
 const block=text.match(/```mainsagents-requirements\s*\n([\s\S]*?)\n```/i);if(!block)return null;
 try{const value=JSON.parse(block[1]);if(!value||typeof value!=='object'||Array.isArray(value)||!Array.isArray(value.mcp??[])||(value.mcp??[]).length>20||(value.mcp??[]).some(item=>!item||typeof item.server!=='string'||!item.server||item.server.length>120||!Array.isArray(item.tools??[])||(item.tools??[]).length>50||(item.tools??[]).some(tool=>typeof tool!=='string'||tool.length>200))||!Array.isArray(value.commands??[])||(value.commands??[]).length>20||(value.commands??[]).some(command=>!['ffmpeg','ffprobe'].includes(command)))throw new Error();return {mcp:value.mcp??[],commands:value.commands??[]};}catch{return {invalid:true};}
}
export function skillRequirementStatus(requirements,servers){
 if(!requirements)return [];
 if(requirements.invalid)return [{name:'requirements',status:'invalid-declaration'}];
 return [...requirements.mcp.map(required=>{const server=servers.find(item=>item.name===required.server);const missing=(required.tools??[]).filter(tool=>!server?.tools.includes(tool));return {name:required.server,status:!server?'not-discovered':server.status!=='discovered'?server.status:missing.length?'missing-tools':'discovered',missingTools:missing};}),...requirements.commands.map(command=>({name:command,status:'check-in-media-editor'}))];
}

export function diagnoseSkills(agent){
 const found=new Map(findSkills(agent.skillsDirectory).map(skill=>[skill.name,skill.filePath]));
 return (agent.skills??[]).map(name=>{
  const path=agent.skillFiles?.[name]??found.get(name),disabled=agent.disabledSkills?.includes(name);
  if(disabled)return {name,status:'disabled',path};
  try{if(!path||statSync(path).size>1_000_000)return {name,path,status:path?'too-large':'missing'};
   const text=readFileSync(path,'utf8');if(!text.trim())return {name,path,status:'empty'};
   const mentions=['notion','apify','publora','zernio','ffmpeg'].filter(value=>new RegExp(`\\b${value}\\b`,'i').test(text));
   return {name,path,status:'readable',mentions,requirements:declaredSkillRequirements(text)};
  }catch{return {name,path,status:'unreadable'};}
 });
}
export function summarizeMcp(config,inventory){
 const rows=new Map((inventory??[]).map(server=>[server.name,server]));
 return [...new Set([...Object.keys(config.mcp_servers??{}),...rows.keys()])].map(name=>{
  const row=rows.get(name),setting=config.mcp_servers?.[name];
  const tools=Object.keys(row?.tools??{}),status=setting?.enabled===false||row?.runtimeStatus==='disabled'?'disabled':row?.authStatus==='notLoggedIn'||row?.runtimeStatus==='authenticationRequired'?'login-required':row?.toolsError||row?.runtimeStatus==='failed'?'unavailable':tools.length?'discovered':row?'empty':'not-discovered';
  return {name,status,tools,approval:'each-call',authStatus:row?.authStatus??'unknown',runtimeStatus:row?.runtimeStatus??null,readVerified:false};
 });
}
export async function diagnoseCodex(client,{cwd,agents=[],evidence=[]}){
 const results=await Promise.allSettled([client.request('account/read',{refreshToken:false}),client.request('model/list',{limit:100,includeHidden:false}),client.request('config/read',{includeLayers:false})]);
 const account=results[0].status==='fulfilled'?results[0].value:null,models=results[1].status==='fulfilled'?results[1].value.data??[]:[];
 const config=results[2].status==='fulfilled'?results[2].value.config??{}:{};
 let inventory=[],discovery='failed',cursor,thread;
 if(results[2].status==='fulfilled')try{
  thread=(await client.request('thread/start',{cwd,ephemeral:true,sandbox:'read-only',approvalPolicy:chatApprovalPolicy,config:await chatActionConfig(client),serviceName:'mainsagents-diagnostics'})).thread.id;
  do{const result=await client.request('mcpServerStatus/list',{threadId:thread,detail:'full',limit:100,...(cursor?{cursor}:{})});inventory.push(...result.data??[]);cursor=result.nextCursor;}while(cursor);
  discovery='completed';
 }catch{/* Do not expose credentials, endpoints or raw server logs in diagnostics. */}
 return {checkedAt:new Date().toISOString(),runtime:'running',account:account?account.account||account.requiresOpenaiAuth===false?'authenticated':'login-required':'check-failed',accountType:account?.account?.type??null,models:models.map(item=>({id:item.model??item.id,name:item.displayName??item.model??item.id})),modelCheck:results[1].status==='fulfilled'?'completed':'failed',discovery,servers:summarizeMcp(config,inventory).map(server=>({...server,readEvidence:evidence.filter(proof=>proof.server===server.name)})),agents:agents.map(agent=>({id:agent.id,name:agent.name,provider:agent.providerId??'codex',skills:diagnoseSkills(agent).map(skill=>({...skill,dependencies:skillRequirementStatus(skill.requirements,summarizeMcp(config,inventory)).map(dep=>(agent.providerId??'codex')!=='codex'&&skill.requirements?.mcp?.some(item=>item.server===dep.name)?{...dep,status:'unsupported-provider'}:dep)}))})),policy:{mcp:'approve-each-call',apps:'disabled-in-chat',plugins:'disabled-in-chat',shell:'read-only',businessReadTested:false}};
}
