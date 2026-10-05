/** Publora MCP contract. No model turn, token extraction or arbitrary tool names. */
export function unpackPublication(result){
  const value=result?.result??result;
  if(value?.isError)throw Error('Publora rejected the operation. Check its connection and limits.');
  let data=value?.structuredContent;
  if(!data){try{data=JSON.parse(value?.content?.filter(item=>item.type==='text').map(item=>item.text).join('\n')??'')}catch{throw Error('Publora did not return a verifiable JSON result. Inspect the provider before retrying.')}}
  if(!data||data.success===false)throw Error('Publora did not confirm this operation. Inspect the provider before retrying.');
  return data;
}
export function createPublicationConnector(getMcp){
  const invoke=async(tool,args)=>{const mcp=getMcp();if(!mcp)throw Error('Reconnect Codex CLI to use the Publora MCP.');return unpackPublication(await mcp.call(tool,args));};
  return {
    async accounts(){const data=await invoke('list_connections',{});if(!Array.isArray(data.connections))throw Error('Publora returned an unsupported account list.');return data.connections.filter(item=>typeof item.platformId==='string'&&item.platformId.startsWith('linkedin-')&&item.tokenStatus==='valid'&&item.connectionStatus==='active').map(item=>({id:item.platformId,name:String(item.displayName??item.username??item.platformId).slice(0,200)}));},
    async create(operation){const data=await invoke('create_post',operation.arguments);if(typeof data.postGroupId!=='string'||!data.postGroupId||data.postGroupId.length>500)throw Error('Publora returned no post identifier. Do not repeat the create operation.');return data.postGroupId;},
    async read(id){return invoke('get_post',{postGroupId:id});},
    async cancel(id,key){return invoke('update_post',{postGroupId:id,status:'draft',idempotencyKey:key});},
  };
}

/** A group status alone is insufficient: account, text, media and target must match. */
export function verifiedPublication(data,operation){
  const args=operation.arguments,id=operation.externalId;
  if(data.postGroupId!==id||!Array.isArray(data.platforms)||data.platforms.length!==1||data.platforms[0]!==args.platforms[0]||!Array.isArray(data.posts)||data.posts.length!==1||data.posts[0].platform!=='linkedin'||data.posts[0].content!==args.content||!Array.isArray(data.media)||data.media.length)throw Error('The external post differs from the approved text, account or media. Review it in Publora.');
  const post=data.posts[0],account=args.platforms[0].slice('linkedin-'.length);
  if(post.platformId!==account&&post.platformId!==args.platforms[0])throw Error('The external account could not be verified.');
  if(data.status==='published'&&post.status==='published'&&post.postedId)return {status:'published',scheduledAt:data.scheduledTime,platformPostId:String(post.postedId)};
  if(data.status==='scheduled'&&post.status==='scheduled'&&args.scheduledTime&&Date.parse(data.scheduledTime)===Date.parse(args.scheduledTime))return {status:'scheduled',scheduledAt:data.scheduledTime};
  if(data.status==='draft'&&post.status==='draft')return {status:'draft'};
  if(data.status==='failed'||post.status==='failed')return {status:'failed'};
  throw Error('Publora has not confirmed a supported final state. Check again without recreating the post.');
}
