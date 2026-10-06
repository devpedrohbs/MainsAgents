/** Classification never auto-approves an operation. Unknown tools require review. */
export const mcpActionKinds=['read','write','schedule','publish','delete','unknown'];
/** Paper Desktop tools, trusted only for the server registered as "paper". readOnlyHint is not trusted:
 * open_file and finish_working_on_nodes change the Desktop UI/document state and exports write local files. */
const paperActions={
 read:['list_resources','get_basic_info','get_selection','get_node_info','get_children','get_tree_summary','get_screenshot','get_jsx','get_computed_styles','get_fill_image','find_nodes','get_tokens','get_font_family_info','get_guide','list_comment_threads','get_comment_thread','list_comment_thread_authors'],
 write:['open_file','finish_working_on_nodes','export','export_combined_pdf','write_html','create_file','create_page','create_artboard','create_tokens','set_tokens','set_text_content','set_comment_thread_status','update_styles','duplicate_nodes','move_nodes','rename_nodes','rename_pages','rename_resource'],
 delete:['delete_nodes'],
};
export function classifyMcpAction(tool,args={},server) {
 const name=String(tool).toLowerCase();
 if(typeof server==='string'&&server.toLowerCase()==='paper')return Object.keys(paperActions).find(kind=>paperActions[kind].includes(name))??'unknown';
 if(['notion-fetch','notion-search','notion-ai-search','notion-get-tool-access','notion-query-data-sources'].includes(name))return 'read';
 if(['notion-create-pages','notion-update-page'].includes(name))return 'write';
 if(/(?:^|_)(delete|remove|cancel|destroy)(?:_|$)/.test(name))return 'delete';
 if(name==='posts_create')return args.is_draft===true?'write':args.publish_now===true?'publish':'schedule';
 if(/(?:^|_)(publish|send|reply)(?:_|$)/.test(name))return 'publish';
 if(/(?:^|_)(schedule|reschedule)(?:_|$)/.test(name))return 'schedule';
 if(/(?:^|_)(create|update|edit|upload|append|insert|set)(?:_|$)/.test(name))return 'write';
 if(['accounts_list','accounts_list_accounts','list_connections','posts_list','posts_list_posts','posts_get','get_social_accounts','list_posts','get_post','list_scheduled_posts','get_scheduled_posts','get_post_analytics','get_account_analytics','get-profile','list-accounts','retrieve-a-page','retrieve-a-database','query-a-data-source'].includes(name))return 'read';
 return 'unknown';
}
export function permittedMcpAction(agent,kind){
 const permissions=agent?.mcpPermissions;if(permissions===undefined)return true;
 if(!Array.isArray(permissions)||!permissions.includes(kind))return false;
 // Generic execution tools can hide a write/publish/delete; restrictive policies cannot grant them.
 return kind!=='unknown'||['write','schedule','publish','delete'].every(action=>permissions.includes(action));
}
