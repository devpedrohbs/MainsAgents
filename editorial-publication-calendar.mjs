/** Separate cache: remote posts never create local approvals or overwrite agent data. */
export function createPublicationCalendar(db,{getConnector,getCurrentProfile,clock=Date.now}={}){
 db.exec('CREATE TABLE IF NOT EXISTS publication_calendar (profile_id TEXT NOT NULL, workspace_id TEXT NOT NULL, provider TEXT NOT NULL, snapshot_json TEXT NOT NULL, PRIMARY KEY(profile_id,workspace_id,provider))');
 const read=db.prepare('SELECT snapshot_json FROM publication_calendar WHERE profile_id=? AND workspace_id=? AND provider=?');
 const put=db.prepare('INSERT INTO publication_calendar VALUES(?,?,?,?) ON CONFLICT(profile_id,workspace_id,provider) DO UPDATE SET snapshot_json=excluded.snapshot_json');
 const running=new Set(),pending=new Set();let closed=false;
 const check=(profile,workspace,provider)=>{
  if(closed)throw Error('Calendar is closing.');
  if(getCurrentProfile&&getCurrentProfile()!==profile)throw Error('Active profile changed.');
  if(typeof workspace!=='string'||!workspace||workspace.length>200||!['publora','zernio'].includes(provider))throw Error('Invalid calendar destination.');
 };
 const snapshot=(profile,workspace,provider)=>{check(profile,workspace,provider);const row=read.get(profile,workspace,provider);return row?JSON.parse(row.snapshot_json):{provider,workspaceId:workspace,items:[],accountIds:[],complete:false};};
 const task=async operation=>{const promise=operation();pending.add(promise);try{return await promise}finally{pending.delete(promise)}};
 return {
  snapshot(profile,workspace){return {sources:['publora','zernio'].map(provider=>snapshot(profile,workspace,provider))};},
  accounts(profile,workspace,provider){return task(async()=>{check(profile,workspace,provider);const connector=getConnector?.(provider,profile);if(!connector)throw Error('Connect Codex CLI and authenticate the provider MCP first.');const accounts=await connector.accounts();check(profile,workspace,provider);return {accounts};});},
  sync(profile,{workspaceId,provider,accountIds}){return task(async()=>{
   check(profile,workspaceId,provider);
   if(!Array.isArray(accountIds)||!accountIds.length||accountIds.length>100||accountIds.some(x=>typeof x!=='string'||!x||x.length>500)||new Set(accountIds).size!==accountIds.length)throw Error('Choose the accounts to display in this workspace.');
   const key=JSON.stringify([profile,workspaceId,provider]);if(running.has(key))throw Error('Calendar query already running.');running.add(key);
   try{
    const connector=getConnector?.(provider,profile);if(!connector)throw Error('Provider connection is unavailable.');
    const accounts=await connector.accounts();check(profile,workspaceId,provider);
    if(accountIds.some(id=>!accounts.some(x=>x.id===id)))throw Error('A selected provider account is unavailable.');
    const result=await connector.list(accountIds);check(profile,workspaceId,provider);
    const at=new Date(clock()).toISOString(),previous=snapshot(profile,workspaceId,provider);
    // Limited queries cannot remove older posts. Their old checkedAt remains visible.
    const merged=new Map((result.complete?[]:previous.items.filter(x=>accountIds.includes(x.accountId))).map(x=>[x.key,x]));
    for(const item of result.items)merged.set(item.key,{...item,checkedAt:at});
    const next={provider,workspaceId,accountIds,accounts:accounts.filter(x=>accountIds.includes(x.id)),items:[...merged.values()],complete:result.complete,checkedAt:at,transport:connector.transport??'mcp'};
    put.run(profile,workspaceId,provider,JSON.stringify(next));return next;
   }catch(error){
    // Fixed local message: don't persist credential-bearing server errors.
    if(!closed&&(!getCurrentProfile||getCurrentProfile()===profile)){
     const previous=snapshot(profile,workspaceId,provider);put.run(profile,workspaceId,provider,JSON.stringify({...previous,error:'Calendar query failed. Previous data was preserved. Check MCP authentication and supported tools.',failedAt:new Date(clock()).toISOString()}));
    }
    throw error;
   }finally{running.delete(key)}
  });},
  async close(){closed=true;await Promise.allSettled([...pending]);}
 };
}
