export type EditPhase='cuts'|'visual'|'captions';
export declare function initialEditWorkflow():{version:1;phase:'cuts'};
export declare function editPhase(p:unknown):EditPhase|null;
export declare function editStageProblems(phase:string|null,plan:Record<string,unknown>,basePlan?:Record<string,unknown>):string[];
export declare function editStageGuide(phase:string|null):string;
