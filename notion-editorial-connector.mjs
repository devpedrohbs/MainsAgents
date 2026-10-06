const uuid = /[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}/i;
const normalizeId=value=>String(value??'').match(uuid)?.[0].replaceAll('-','').toLowerCase();

export function unpackNotion(result) {
  if(result.isError)throw new Error(result.content?.filter(item=>item.type==='text').map(item=>item.text).join('\n')||'Notion rejected the operation.');
  if(result.structuredContent)return result.structuredContent;
  const text=result.content?.filter(item=>item.type==='text').map(item=>item.text).join('\n')??'';
  try{return JSON.parse(text)}catch{return {text}}
}
function documentText(result){return typeof result.text==='string'?result.text:JSON.stringify(result);}
function schemaFrom(result){
  const match=documentText(result).match(/<data-source-state>\s*([\s\S]*?)\s*<\/data-source-state>/);
  if(!match)throw new Error('Choose the Notion data source (collection://…), not a page or card.');
  return JSON.parse(match[1]).schema;
}
function pageUrl(result){
  const entries=Array.isArray(result.pages)?result.pages:[result];
  const candidate=entries.find(item=>item.url||item.id);
  const raw=candidate?.url??candidate?.id;
  const id=normalizeId(raw);
  if(!id)throw new Error('Notion did not return a page identifier. Verify before retrying.');
  if(candidate.url){const url=new URL(candidate.url);if(url.protocol!=='https:'||!['app.notion.com','www.notion.com','notion.com','www.notion.so','notion.so'].includes(url.hostname))throw new Error('Notion returned an unexpected destination.');}
  return {pageId:id,url:candidate.url??`https://www.notion.so/${id}`};
}
const escape=value=>String(value??'').replaceAll('<','&lt;').replaceAll('>','&gt;');
export function notionEditorialBody(payload){
  const {content,topic,artifact}=payload,script=artifact.data;
  const identity=`MainsAgents content: ${content.id}`;
  const version=`MainsAgents version: ${artifact.id}`;
  return `${identity}\n${version}\n\n## ${artifact.type==='script-draft'?'Roteiro gerado para gravação':'Roteiro aprovado'} · versão ${artifact.version}\n\n### Objetivo\n${escape(topic?.summary??content.title)}\n\n### Hook\n${escape(script.hook)}\n\n### Estrutura\n${escape(script.path.title)}\n${escape(script.path.outline)}\n\n### Roteiro\n${escape(script.text)}\n\n### CTA\n${escape(script.cta)}\n\n### Tópicos de improvisação\n${script.improvisationTopics.map(item=>`- ${escape(item)}`).join('\n')}\n\n### Direção de thumbnail\n${escape(script.thumbnailDirection)}\n\n### Checklist de gravação\n- [ ] Conferir roteiro e fatos pendentes\n- [ ] Preparar referências e materiais\n- [ ] Gravar o vídeo\n- [ ] Associar o arquivo no MainsAgents\n- [ ] Encaminhar ao Editor de Vídeo\n\n### Fontes\n${(topic?.sources??[]).map(item=>`- ${escape(item.title)}: ${item.url}`).join('\n')}\n\nMainsAgents end: ${artifact.id}`;
}

/** Uses the user's existing Codex MCP login. No LLM turn or token extraction. */
export function createNotionEditorialConnector(getMcp){
  return {
    async readCard(pageId,dataSourceId,contentId){const mcp=getMcp();if(!mcp)throw Error('Reconecte Notion pelo Codex.');const threadId=await mcp.thread(),data=unpackNotion(await mcp.call({threadId,tool:'notion-fetch',arguments:{id:pageId}})),text=documentText(data),ids=[...text.matchAll(new RegExp(uuid.source,'ig'))].map(match=>normalizeId(match[0]));if(text.length>1000000||!ids.includes(normalizeId(dataSourceId))||!ids.includes(normalizeId(pageId)))throw Error('Não foi possível verificar o card e a base atuais.');return {pageId,contentId,text:text.slice(0,64000),hash:normalizeId(pageId),fetchedAt:new Date().toISOString()};},
    async upsert(payload,{checkpoint,previous,saveCheckpoint,authorize}){
      const mcp=getMcp();
      if(!mcp)throw new Error('Reconnect Codex CLI to access the Notion MCP.');
      const threadId=await mcp.thread();
      const invoke=async(tool,args)=>unpackNotion(await mcp.call({threadId,tool,arguments:args}));
      await invoke('notion-fetch',{id:'notion://docs/enhanced-markdown-spec'});
      const schema=schemaFrom(await invoke('notion-fetch',{id:`collection://${payload.dataSourceId}`}));
      if(schema['Post Title']?.type!=='title'||schema.Status?.type!=='status'||schema.Channel?.type!=='multi_select')throw new Error('This Notion base does not match the editorial mapping. Check Post Title, Status and Channel.');
      const status=payload.notionStatus==='Idea'||payload.content.format==='carousel'?'Idea':'Gravando';
      const statusOptions=Object.values(schema.Status.groups??{}).flat().map(item=>item.name);
      if(!statusOptions.includes(status)||!payload.content.platforms.every(platform=>schema.Channel.options.some(item=>item.name===platform)))throw new Error('The Notion base is missing the required stage or channel.');
      const identity=`MainsAgents content: ${payload.content.id}`;
      const version=`MainsAgents version: ${payload.artifact.id}`;
      const body=notionEditorialBody(payload);
      let binding=checkpoint.pageId?{pageId:checkpoint.pageId,url:checkpoint.url}:previous;
      if(!binding){
        const result=await invoke('notion-search',{query:payload.content.title,query_type:'internal',data_source_url:`collection://${payload.dataSourceId}`,page_size:50});
        if(result.has_more||result.hasMore)throw new Error('Too many matching Notion cards. Link an existing card before retrying.');
        const matches=[];
        for(const candidate of result.results??[]){
          const page=await invoke('notion-fetch',{id:candidate.url??candidate.id});
          if(documentText(page).includes(identity))matches.push(pageUrl(page));
        }
        if(matches.length>1)throw new Error('More than one Notion card matches this content. Resolve duplicates before retrying.');
        binding=matches[0];
        if(!binding&&checkpoint.phase==='creating')throw new Error('The previous create request has an uncertain result. Verify again after Notion indexes the card; a duplicate will not be created automatically.');
      }
      if(!binding){
        authorize();
        saveCheckpoint({phase:'creating'});
        const properties={'Post Title':payload.content.title,Status:status,Channel:JSON.stringify(payload.content.platforms),'Post Type':payload.content.format==='carousel'?'Carousel':payload.content.format==='long-video'?'Video':'Reel'};
        const created=await invoke('notion-create-pages',{parent:{data_source_id:payload.dataSourceId},pages:[{properties,content:body}]});
        binding=pageUrl(created);
        saveCheckpoint({phase:'created',...binding});
      }
      let fetched=await invoke('notion-fetch',{id:binding.pageId});
      let text=documentText(fetched);
      const sourceIds=[...text.matchAll(new RegExp(uuid.source,'ig'))].map(match=>normalizeId(match[0]));
      if(!text.includes(identity)||!sourceIds.includes(normalizeId(payload.dataSourceId)))throw new Error('The Notion card identity or destination could not be verified.');
      if(!text.includes(version)){
        authorize();
        saveCheckpoint({phase:'updating',...binding});
        await invoke('notion-update-page',{page_id:binding.pageId,command:'insert_content',content:`\n\n${body}`,position:{type:'end'}});
        fetched=await invoke('notion-fetch',{id:binding.pageId});text=documentText(fetched);
      }
      if(!text.includes(version)||!text.includes(`MainsAgents end: ${payload.artifact.id}`))throw new Error('Notion has not confirmed the complete approved version. Retry verification.');
      const section=text.slice(text.indexOf(version),text.indexOf(`MainsAgents end: ${payload.artifact.id}`));
      const compact=value=>value.replace(/\s+/g,' ').trim();
      if(![payload.artifact.data.hook,payload.artifact.data.cta,payload.artifact.data.text].every(value=>compact(section).includes(compact(escape(value)))))throw new Error('The Notion card markers exist, but the approved text could not be verified. Review the card before retrying.');
      saveCheckpoint({phase:'verified',...binding});
      return {...binding,verifiedAt:new Date().toISOString(),artifactVersion:payload.artifact.version};
    },
  };
}
