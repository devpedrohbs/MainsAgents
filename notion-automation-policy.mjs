const uuid=/^(?:collection:\/\/)?([a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12})$/i;
export function notionDataSourceId(value){return typeof value==='string'?value.trim().match(uuid)?.[1].replaceAll('-','').toLowerCase():undefined;}
const readTools=new Set(['notion-fetch','notion-search','notion-ai-search','notion-get-tool-access','notion-query-data-sources']);

/** An explicit per-agent preference. It never changes the CLI's global grants. */
export function notionAutomaticDecision(agent,server,tool,args){
 const preference=agent?.notionAutomation,source=notionDataSourceId(preference?.dataSourceId);
 if(server!=='notion'||(agent?.providerId??'codex')!=='codex'||preference?.enabled!==true||!source)return null;
 if(readTools.has(tool))return 'Configured Notion read access';
 if(tool!=='notion-create-pages'||!args||args.creation_mode||args.allow_async===true)return null;
 const parent=args.parent;
 if(!parent||Object.keys(parent).some(key=>!['data_source_id','type'].includes(key))||parent.type&&parent.type!=='data_source_id'||notionDataSourceId(parent.data_source_id)!==source)return null;
 if(!Array.isArray(args.pages)||!args.pages.length||args.pages.length>20)return null;
 if(args.pages.some(page=>!page||page.template_id||page.is_skill||page.properties?.Status!=='Idea'||typeof page.properties?.['Post Title']!=='string'||!page.properties['Post Title'].trim()))return null;
 return 'Configured creation of Idea cards in the selected Notion data source';
}
export function notionAutomationInstructions(agent){
 const preference=agent?.notionAutomation,source=notionDataSourceId(preference?.dataSourceId);
 if(preference?.enabled!==true||!source)return '';
 return `\n\nCurrent user-configured MainsAgents Notion preference (takes precedence over older Notion skill instructions): Notion reads and creation of Idea cards are pre-authorized for this agent. Use collection://${source} as the creation parent data_source_id. Save requested content ideas or drafts with the exact property Status="Idea" and Post Title; the user reviews those cards in Notion. Do not ask for another chat approval for these authorized operations. Do not create as Gravando, Pronto or Published automatically. Read the schema and check duplicates before creating; do not create if duplicate checking failed. Use the actual MCP catalog and prefer scoped keyword search when SQL access is unavailable. Include useful context, sources and next steps. Preserve existing cards and manual notes; updating, moving, archiving or deleting existing cards still requires confirmation. Never fabricate a Publish Date to make a card appear in a filtered view. Verify the new card and return its actual URL. A failed or uncertain create result must be reconciled before retrying. This permission does not authorize scheduling, publishing, payments or other providers.`;
}
