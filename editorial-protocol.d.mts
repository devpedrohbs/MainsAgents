import type {EditorialTopic,EditorialContent,ResearchProposal,ScriptOptions,CarouselDraft,ApprovedScript,SourceReference} from './src/features/content/model';
export function parseProviderJson(raw:string):Record<string,unknown>;
export function validateResearch(raw:string,minimumTopics?:number):ResearchProposal[];
export function validateScriptOptions(raw:string,context?:{format?:string;sources?:SourceReference[]}):ScriptOptions;
export function validateCarousel(value:unknown,allowedSources?:SourceReference[]):CarouselDraft;
export function carouselText(carousel:CarouselDraft):string;
export function carouselScript(carousel:unknown,allowedSources?:SourceReference[]):ApprovedScript & {carousel:CarouselDraft};
export function researchPrompt(topic:EditorialTopic,language:'pt-BR'|'en-US'):string;
export function scriptPrompt(topic:EditorialTopic,content:EditorialContent,language:'pt-BR'|'en-US'):string;
