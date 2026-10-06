export const productionStages:string[];
export function validateEditPlan(raw:unknown,metadata:{duration:number},preferences?:{format?:string}):{start:number;duration:number;format:string;normalizeAudio:boolean;fadeSeconds:number;summary:string};
export function validatePublicationPackage(raw:unknown,platforms:string[]):{deliveries:Array<{platform:string;caption:string;coverPrompt:string}>};
export function parseProductionSchedule(text:string,zone:string,now?:Date):{plannedAt:string;timeZone:string;localDateTime:string}|null;
export function productionChatIntent(text:string):{type:'idea'|'video'|'package'|'schedule'|'resume';text?:string}|null;
