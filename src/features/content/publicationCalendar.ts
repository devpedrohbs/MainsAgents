export type CalendarProvider='publora'|'zernio';
export interface CalendarAccount {id:string;name:string;platform:string}
export interface ProviderPost {
 key:string;provider:CalendarProvider;postId:string;accountId:string;platform:string;text:string;
 status:'draft'|'scheduled'|'published'|'failed'|'cancelled'|'publishing'|'partial';
 scheduledAt?:string;publishedAt?:string;updatedAt?:string;checkedAt:string;
}
export interface CalendarSource {
 provider:CalendarProvider;workspaceId:string;items:ProviderPost[];accountIds:string[];
 accounts?:CalendarAccount[];complete:boolean;checkedAt?:string;failedAt?:string;error?:string;
 transport?:'mcp'|'api';
 autoRefresh?:{enabled:boolean;intervalMinutes:number;nextAt?:string};
}
