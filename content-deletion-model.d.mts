export declare const linkedStateKeys: readonly string[];
export interface DeletedIds {sessions?:ReadonlySet<string>;contents?:ReadonlySet<string>;runs?:ReadonlySet<string>;artifacts?:ReadonlySet<string>}
export declare function sanitizeLinkedValue<T>(key:string,value:T,ids:DeletedIds):T;
export declare function stripDeletedEditorial<T>(state:T,ids:DeletedIds):T;
