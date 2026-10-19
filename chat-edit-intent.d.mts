export declare const CHAT_EDIT_CLASSIFIER_VERSION: number;
export declare const chatVideoPattern: RegExp;
export interface TimeWindow { start: number; end: number }
export interface EditIntent { kind: 'edit' | 'adjust' | 'ambiguous' | 'none'; reason: string; window?: TimeWindow }
export declare function parseTimeWindow(text: string): TimeWindow | null;
export declare function classifyEditRequest(text: string): EditIntent;
export declare function videoPathsIn(text: string): string[];
export declare function withTimeWindow(text: string, window: TimeWindow): string;
