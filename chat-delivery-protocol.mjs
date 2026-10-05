import {validateResearch,validateScriptOptions,parseProviderJson} from './editorial-protocol.mjs';

/** Recognition is deliberately strict: ordinary prose never becomes an approval. */
export function decodeChatDelivery(content) {
  if(typeof content!=='string'||content.length>300_000)return null;
  try {
    const value=parseProviderJson(content);
    if(value.kind==='files'&&typeof value.summary==='string'&&value.summary.trim()&&value.summary.length<=10000&&Array.isArray(value.files)&&value.files.length>0&&value.files.length<=20&&value.files.every(file=>file&&typeof file.path==='string'&&/^(?:[a-z]:[\\/]|\/[^/])[^\r\n\0]*$/i.test(file.path)&&file.path.length<=4096&&(file.caption===undefined||typeof file.caption==='string'&&file.caption.length<=2000)))return {kind:'file-delivery',data:{summary:value.summary.trim(),files:value.files.map(file=>({path:file.path,caption:file.caption??''}))}};
    if(Array.isArray(value.topics))return {kind:'research',data:validateResearch(content)};
    if(Array.isArray(value.hooks)&&typeof value.draftScript==='string')return {kind:'script-options',data:validateScriptOptions(content)};
  } catch { /* Keep unrecognized and invalid output as a normal chat message. */ }
  return null;
}

export const chatDeliveryInstructions=`For complete editorial research proposals or video script options, you may return a structured delivery as one JSON object. Research shape: {"topics":[{"title":"...","category":"...","summary":"at least 20 characters","whyItMatters":"at least 15 characters","angles":["angle 1","angle 2"],"sources":[{"title":"real source","url":"https://..."}],"factualQuestions":[]}]}. Script shape: {"hooks":["option 1","option 2","option 3"],"ctas":["option 1","option 2"],"paths":[{"title":"path 1","outline":"at least 20 characters"},{"title":"path 2","outline":"at least 20 characters"}],"improvisationTopics":["topic 1","topic 2"],"thumbnailDirection":"...","draftScript":"complete spoken script, at least 80 characters"}. Use the user's language. Never invent sources or claim approval, publication or a Notion card was created from this JSON. The user saves and reviews deliveries using the app's actions. For actual completed file outputs, return {"kind":"files","summary":"what was produced","files":[{"path":"absolute local path to a real produced file","caption":"description"}]}. Never invent file paths; the app verifies files before saving or approving. For conversation, questions, specialized skill formats and other outputs, use normal text. This optional format must not override the agent's skills or requested output format.`;
