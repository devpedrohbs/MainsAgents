import {readFileSync,statSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

const modelId=value=>typeof value==='string'&&/^[a-zA-Z0-9_.:-]{1,120}$/.test(value.trim())?value.trim():undefined;
export function claudeModelLabel(id){
 const aliases={opus:'Claude Opus',sonnet:'Claude Sonnet',haiku:'Claude Haiku',opusplan:'Claude Opus / Sonnet'};
 if(aliases[id])return aliases[id];
 const full=/^claude-(opus|sonnet|haiku)-(\d+)-(\d+)(?:-\d{8})?$/.exec(id);
 return full?`Claude ${full[1][0].toUpperCase()+full[1].slice(1)} ${full[2]}.${full[3]}`:id;
}

/** Read only the model choice, never credentials. An alias is not a verified runtime version. */
export function readClaudeDefaults({env=process.env,home=homedir()}={}){
 let settings={};
 try{
  const path=join(env.CLAUDE_CONFIG_DIR||join(home,'.claude'),'settings.json');
  if(statSync(path).size<=1_000_000)settings=JSON.parse(readFileSync(path,'utf8'));
 }catch{/* Missing or unreadable config leaves the account's runtime default unresolved. */}
 const choices=[['environment',env.ANTHROPIC_MODEL],['user-settings',settings?.model],['default-environment',env.ANTHROPIC_DEFAULT_MODEL]];
 for(const [source,value] of choices){
  const id=modelId(value);if(!id)continue;
  if(id==='default')break;
  return {connectionName:'Claude Code',defaultModel:{id,name:claudeModelLabel(id),source}};
 }
 return {connectionName:'Claude Code'};
}
