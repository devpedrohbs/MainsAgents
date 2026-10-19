export interface PublishingAutomation {enabled:boolean;provider:''|'publora'|'zernio';timeZone:string}
export const publishingProviders:ReadonlyArray<PublishingAutomation['provider']>;
export function validPublishingAutomation(value:unknown):value is PublishingAutomation;
export function withoutPublishingAutomation<T>(agent:T):T;
export function publishingAutomationEnabled(agent:unknown):boolean;
export function publishingAutomaticDecision(agent:unknown,server:string,tool:string,args:unknown):string|null;
export function publishingInstructions(agent?:unknown):string;
