export interface PaperDesign {enabled:boolean;automatic:boolean;fileId:string;fileName:string;signature:string;visualStyle:string}
export const paperVisualStyle:string;
export function validPaperDesign(value:unknown):value is PaperDesign;
export function paperDesignInstructions(agent?:{paperDesign?:PaperDesign}):string;
export function paperAutomaticDecision(agent:unknown,server:string,tool:string,args:unknown):string|null;
export const paperFileIdPattern:RegExp;
export function withoutPaperAutomation<T>(agent:T):T;
export function setPaperAssetVerifier(verify:((path:string)=>{ok:boolean})|null):void;
export function paperAssetReferences(args:unknown):string[];
