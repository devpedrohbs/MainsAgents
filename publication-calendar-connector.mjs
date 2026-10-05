/** Read-only provider contracts. Never infer posts from prose or start a model turn. */
export const calendarTools={publora:['list_connections','list_posts'],zernio:['accounts_list_accounts','posts_list_posts']};
const id=value=>typeof value==='string'&&value.length>0&&value.length<=500;
const instant=value=>typeof value==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));
function json(result){
 const value=result?.result??result;
 if(value?.isError)throw Error('Provider rejected the calendar query.');
 let data=value?.structuredContent;
 if(!data){try{data=JSON.parse(value?.content?.filter(x=>x.type==='text').map(x=>x.text).join('\n')??'')}catch{throw Error('Provider returned no structured calendar data.');}}
 if(typeof data?.result==='string'){try{data=JSON.parse(data.result)}catch{throw Error('Provider returned no structured calendar data.');}}
 if(!data||data.success===false||data.error)throw Error('Provider did not confirm the calendar query.');
 return data;
}
export function createCalendarConnector(getMcp,provider){
 if(!calendarTools[provider])throw Error('Unsupported calendar provider.');
 const invoke=async(tool,args)=>{const mcp=getMcp();if(!mcp)throw Error('Connect Codex CLI and authenticate this provider MCP first.');return json(await mcp.call(tool,args,provider));};
 return {
  transport:'mcp',
  async accounts(){
   const data=await invoke(provider==='publora'?'list_connections':'accounts_list_accounts',{}),raw=provider==='publora'?data.connections:data.accounts;
   if(!Array.isArray(raw)||raw.length>2000)throw Error('Unsupported provider account list.');
   return raw.filter(x=>provider==='publora'?x.tokenStatus==='valid'&&x.connectionStatus==='active':x.isActive===true).map(x=>{
    const key=provider==='publora'?x.platformId:x._id,platform=x.platform??(provider==='publora'&&typeof key==='string'?key.match(/^(linkedin|instagram|tiktok|twitter|threads|youtube|facebook|bluesky|mastodon|telegram)-/)?.[1]:undefined);
    if(!id(key)||!id(platform))throw Error('Provider account has no verifiable identity.');
    return {id:key,platform,name:String(x.displayName??x.username??key).slice(0,200)};
   });
  },
  async list(accountIds){
   const items=new Map();let complete=false,bytes=0;
   for(let page=1;page<=20;page++){
    const data=await invoke(provider==='publora'?'list_posts':'posts_list_posts',provider==='publora'?{page,limit:100,responseFormat:'detailed',sortBy:'scheduledTime',sortOrder:'asc'}:{page,limit:100,sort_by:'scheduled-asc'});
    bytes+=Buffer.byteLength(JSON.stringify(data));if(bytes>8_000_000)throw Error('Calendar query exceeds the local size limit.');
    if(!Array.isArray(data.posts)||data.posts.length>100||!data.pagination)throw Error('Unsupported paginated calendar response.');
    const p=data.pagination,pages=provider==='publora'?p.totalPages:p.pages;
    if(p.page!==page||!Number.isSafeInteger(pages)||pages<0||pages>100000||typeof (provider==='publora'?p.hasNextPage:false)!=='boolean')throw Error('Provider pagination could not be verified.');
    const more=provider==='publora'?p.hasNextPage:page<pages;
    if(more&&!data.posts.length||provider==='publora'&&more!==(page<pages))throw Error('Provider returned inconsistent pagination.');
    for(const post of data.posts){
     const postId=provider==='publora'?post.postGroupId:post._id;
     if(!id(postId)||!Array.isArray(post.platforms)||post.platforms.length>100||typeof post.content!=='string'||post.content.length>100000)throw Error('Unsupported provider post.');
     for(const target of post.platforms){
      const accountId=provider==='publora'?target.platformId:typeof target.accountId==='string'?target.accountId:target.accountId?._id;
      if(!id(accountId)||!id(target.platform))throw Error('Provider post has an unverifiable account.');
      if(!accountIds.includes(accountId))continue;
      const raw=target.status==='pending'?post.status:target.status;
      const status=raw==='partially_published'||raw==='partial'?'partial':raw==='processing'?'publishing':raw;
      if(!['draft','scheduled','published','failed','cancelled','publishing','partial'].includes(status))throw Error('Unsupported provider post status.');
      const time=provider==='publora'?post.scheduledTime:target.scheduledFor??post.scheduledFor;
      if(time!=null&&!instant(time)||status==='scheduled'&&!instant(time))throw Error('Provider returned an ambiguous schedule time.');
      const text=provider==='zernio'?target.customContent??post.content:post.content;
      if(typeof text!=='string'||text.length>100000)throw Error('Unsupported provider caption.');
      const item={key:JSON.stringify([provider,postId,accountId]),provider,postId,accountId,platform:target.platform,status,text,...(time?{scheduledAt:new Date(time).toISOString()}:{}),...(instant(target.publishedAt??post.publishedAt)?{publishedAt:new Date(target.publishedAt??post.publishedAt).toISOString()}:{}),...(instant(post.updatedAt)?{updatedAt:new Date(post.updatedAt).toISOString()}: {})};
      if(items.has(item.key))throw Error('Provider pages overlap. Retry the calendar query.');
      items.set(item.key,item);
     }
    }
    if(!more){complete=true;break;}
   }
   return {items:[...items.values()],complete};
  }
 };
}
