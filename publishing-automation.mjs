// Browser-safe (imported by the agent editor and backups): no Node imports.
/**
 * Per-agent scheduling preference saved by the person in Configure → Publishing. It is the standing authority that
 * lets an explicit scheduling request in chat run without a second confirmation. It never enables publish-now,
 * deletion, other accounts or invented material, and a model cannot set it.
 */
const keys=['enabled','provider','timeZone'];
export const publishingProviders=['','publora','zernio'];
const zone=value=>{try{new Intl.DateTimeFormat('en',{timeZone:value}).format();return true;}catch{return false;}};
export function validPublishingAutomation(value){
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key))&&typeof value.enabled==='boolean'&&publishingProviders.includes(value.provider)&&typeof value.timeZone==='string'&&value.timeZone.length<=100&&(value.timeZone===''||zone(value.timeZone));
}
/** Imported or restored configuration never carries the scheduling grant: the person re-enables it in this app. */
export function withoutPublishingAutomation(agent){
 return agent&&typeof agent==='object'&&!Array.isArray(agent)&&agent.publishingAutomation&&typeof agent.publishingAutomation==='object'&&agent.publishingAutomation.enabled!==false?{...agent,publishingAutomation:{...agent.publishingAutomation,enabled:false}}:agent;
}
export const publishingAutomationEnabled=agent=>validPublishingAutomation(agent?.publishingAutomation)&&agent.publishingAutomation.enabled&&['claude','codex'].includes(agent?.providerId??'codex');

/**
 * The scheduling preference grants no MCP calls. Chat connectors (claude.ai Publora, a CLI's own publora/zernio) may be
 * signed in to a different account than the app's native executor, so account and post reads go through
 * mainsagents_schedule_post action "accounts"/"status", which use the same transport as the writes.
 * Kept for the approval gate's call shape; always null (normal per-call review).
 */
export function publishingAutomaticDecision(){return null;}

export function publishingInstructions(agent){
 const value=agent?.publishingAutomation??{enabled:false,provider:'',timeZone:''};if(!validPublishingAutomation(value)||!['claude','codex'].includes(agent?.providerId??'codex'))return '';
 return `\n\nScheduling posts (MainsAgents): to schedule a finished post or carousel, use only the mainsagents_schedule_post tool (not other Publora/Zernio connectors in this chat, which may be signed in to a different account) (action "accounts" lists the real connected accounts; action "schedule" uploads the files in order, schedules and verifies). ${value.enabled?'The user saved a preference that an explicit scheduling request in this chat is the authorization for that exact future post: do not ask for step-by-step approvals.':'This agent has no saved scheduling preference: the app asks the user for one confirmation of the full summary before sending.'} Collect only what is genuinely missing (network, account when more than one, date and time, time zone) in one short question. Use the caption and exported files already shown to the user in this chat; never invent a caption, a date, an account or a file path. The network, date and time must be ones the user stated; pass them as they said them and let the tool ask for anything it could not read. If the tool answers "stopped", the user said not to schedule: do not ask for a confirmation. Never publish immediately, delete or change other posts with this tool. Report only the result the tool confirmed; if it says the outcome is uncertain, do not schedule again — tell the user to check the provider. If an account is not connected, relay the tool's concrete connection step; never claim you can log in or obtain tokens.${value.timeZone?` Default time zone: ${JSON.stringify(value.timeZone)}.`:''}`;
}
