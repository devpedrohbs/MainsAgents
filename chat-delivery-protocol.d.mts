import type {ResearchProposal,ScriptOptions} from './src/features/content/model';
export type ChatDelivery={kind:'research';data:ResearchProposal[]}|{kind:'script-options';data:ScriptOptions}|{kind:'file-delivery';data:{summary:string;files:{path:string;caption:string}[]}};
export function decodeChatDelivery(content:string):ChatDelivery|null;
export const chatDeliveryInstructions:string;
