/** Classification never auto-approves an operation. Unknown tools require review. */
export const mcpActionKinds=['read','write','schedule','publish','delete','unknown'];
export function classifyMcpAction(tool,args={}) {
 const name=String(tool).toLowerCase();
 if(/(?:^|_)(delete|remove|cancel|destroy)(?:_|$)/.test(name))return 'delete';
 if(name==='posts_create')return args.is_draft===true?'write':args.publish_now===true?'publish':'schedule';
 if(/(?:^|_)(publish|send|reply)(?:_|$)/.test(name))return 'publish';
 if(/(?:^|_)(schedule|reschedule)(?:_|$)/.test(name))return 'schedule';
 if(/(?:^|_)(create|update|edit|upload|append|insert|set)(?:_|$)/.test(name))return 'write';
 if(['accounts_list','posts_list','posts_get','get_social_accounts','list_posts','get_post','list_scheduled_posts','get_scheduled_posts','get_post_analytics','get_account_analytics','get-profile','list-accounts','retrieve-a-page','retrieve-a-database','query-a-data-source'].includes(name))return 'read';
 return 'unknown';
}
export function permittedMcpAction(agent,kind){
 const permissions=agent?.mcpPermissions;if(permissions===undefined)return true;
 if(!Array.isArray(permissions)||!permissions.includes(kind))return false;
 // Generic execution tools can hide a write/publish/delete; restrictive policies cannot grant them.
 return kind!=='unknown'||['write','schedule','publish','delete'].every(action=>permissions.includes(action));
}
