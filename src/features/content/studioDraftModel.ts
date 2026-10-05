export type DraftValue=string|number|boolean|null|DraftValue[]|{[key:string]:DraftValue};
export type StudioDrafts=Record<string,{fields:Record<string,DraftValue>;updatedAt:string}>;
const plain=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
export function validDraftValue(value:unknown,depth=0):value is DraftValue {
 if(depth>8)return false;if(value===null||typeof value==='boolean')return true;
 if(typeof value==='string')return value.length<=100000;if(typeof value==='number')return Number.isFinite(value);
 if(Array.isArray(value))return value.length<=100&&value.every(item=>validDraftValue(item,depth+1));
 return plain(value)&&Object.keys(value).length<=40&&Object.entries(value).every(([key,item])=>key.length<=100&&!['__proto__','constructor','prototype'].includes(key)&&validDraftValue(item,depth+1));
}
export const studioDraftKey=(...identity:string[])=>JSON.stringify(identity);
export function validateStudioDrafts(value:unknown):value is StudioDrafts {
 if(!plain(value)||Object.keys(value).length>1000||JSON.stringify(value).length>4000000)return false;
 return Object.entries(value).every(([key,draft])=>{try{const parts=JSON.parse(key);return key.length<=2000&&Array.isArray(parts)&&parts.length>=2&&parts.every(x=>typeof x==='string')&&plain(draft)&&plain(draft.fields)&&validDraftValue(draft.fields)&&typeof draft.updatedAt==='string'&&Number.isFinite(Date.parse(draft.updatedAt));}catch{return false}});
}
export function putStudioField(current:StudioDrafts,key:string,field:string,value:DraftValue):StudioDrafts {
 if(!validDraftValue(value))throw Error('This form draft exceeds its storage limit.');
 const next={...current,[key]:{fields:{...current[key]?.fields,[field]:value},updatedAt:new Date().toISOString()}};
 if(!validateStudioDrafts(next))throw Error('Studio drafts reached their storage limit. Export a backup before clearing old drafts.');
 return next;
}
export function sameDraftShape(value:unknown,initial:DraftValue):value is DraftValue {
 if(initial===null)return value===null;if(Array.isArray(initial))return Array.isArray(value)&&value.every(item=>typeof item==='string');
 if(typeof initial==='object')return plain(value)&&Object.entries(initial).every(([key,item])=>sameDraftShape(value[key],item));
 return typeof value===typeof initial;
}
