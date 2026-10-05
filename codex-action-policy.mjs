/** These overrides apply to this app's threads only, never the user's CLI config. */
export const chatApprovalPolicy={granular:{sandbox_approval:false,rules:false,mcp_elicitations:true,request_permissions:false,skill_approval:false}};
const omitNulls=value=>Array.isArray(value)?value.filter(item=>item!==null).map(omitNulls):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,item])=>item!==null).map(([key,item])=>[key,omitNulls(item)])):value;
export async function chatActionConfig(client){
 const {config={}}=await client.request('config/read',{includeLayers:false});
 const servers=Object.fromEntries(Object.entries(config.mcp_servers??{}).map(([name,server])=>[name,{...omitNulls(server),default_tools_approval_mode:'prompt',tools:Object.fromEntries(Object.entries(server.tools??{}).map(([tool,setting])=>[tool,{...omitNulls(setting),approval_mode:'prompt'}]))}]));
 return {mcp_servers:servers,approvals_reviewer:'user',features:{...omitNulls(config.features??{}),apps:false,plugins:false,multi_agent:false}};
}
