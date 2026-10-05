import type {EditorialTopic,EditorialContent,ResearchProposal,ScriptOptions} from './src/features/content/model';
export function parseProviderJson(raw:string):Record<string,unknown>;
export function validateResearch(raw:string,minimumTopics?:number):ResearchProposal[];
export function validateScriptOptions(raw:string):ScriptOptions;
export function researchPrompt(topic:EditorialTopic,language:'pt-BR'|'en-US'):string;
export function scriptPrompt(topic:EditorialTopic,content:EditorialContent,language:'pt-BR'|'en-US'):string;
