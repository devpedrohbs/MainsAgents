interface InstalledSkillInfo { name: string; path: string; filePath?: string }
interface SkillDirectoryResult { directory: string; skills: InstalledSkillInfo[] }

interface Window {
  mainsAgentsSaveNow?: () => Promise<void>;
  mainsAgentsHideSplash?: () => void;
  mainsAgentsDesktop?: {
    selectOutputDirectory?:()=>Promise<string|null>;
    notify?(title:string,body:string):Promise<boolean>;
    canvasBrowser?: boolean;
    files?: {
      pathForFile(file:File):string;
      /** Native picker for videos to attach to a chat message (absolute paths; nothing is copied). */
      selectVideos?():Promise<string[]>;
      select(profile:string,contentId:string,multiple?:boolean):Promise<import('../features/content/assetModel').LocalAssetInspection[]>;
      inspect(profile:string,contentId:string,paths:string[]):Promise<import('../features/content/assetModel').LocalAssetInspection[]>;
      verify(profile:string,contentId:string):Promise<Array<{id:string;versionId:string;inspection:import('../features/content/assetModel').LocalAssetInspection}>>;
      reveal(profile:string,contentId:string,assetId:string):Promise<boolean>;
      open(profile:string,contentId:string,assetId:string):Promise<boolean>;
      preview?(profile:string,contentId:string,assetId:string):Promise<string>;
    };
    content?: {
      deletePreview(profile:string,input:{contentId:string;workspaceId:string}):Promise<import('../features/content/contentDeletion').DeletionPreviewResult>;
      deleteContent(profile:string,input:{contentId:string;workspaceId:string;fingerprint:string;requestId:string;stopLocalWork:boolean;rendererBusy:string[]}):Promise<import('../features/content/contentDeletion').DeletionResult>;
      deleteSession(profile:string,input:{sessionId:string}):Promise<import('../features/content/contentDeletion').DeletionResult>;
    };
    receipts?: {
      check(profile:string,id:string):Promise<{status:'available'|'changed'|'missing'|'unavailable'}>;
      open(profile:string,id:string):Promise<boolean>;
      reveal(profile:string,id:string):Promise<boolean>;
    };
    backup?: {
      inspectFiles(paths:string[]):Promise<Array<{path:string;available:boolean}>>;
      snapshot():Promise<{values:Record<string,unknown>;revisions:Record<string,string>;editorial:{revision:number;state:Record<string,unknown>};execution:Record<string,unknown>;executionRevision:string}>;
      restore(values:Record<string,unknown>,editorial:Record<string,unknown>,expected:{revisions:Record<string,string>;editorialRevision:number;executionRevision?:string},execution?:{state:Record<string,unknown>;mode:'replace'|'merge'}):Promise<{omittedDeleted?:{contents:number;sessions:number}}|undefined>;
    };
    state?: {
      profile?: string;
      getProfile?(): Promise<string>;
      hasProfile(profile: string): Promise<boolean>;
      initialize(profile: string, values: Record<string, unknown>): Promise<void>;
      read<T>(profile: string, key: string): Promise<T | undefined>;
      write<T>(profile: string, key: string, value: T): Promise<void>;
      writeSync?<T>(profile: string, key: string, value: T): void;
      readAll(profile: string): Promise<Record<string, unknown>>;
      replaceAll(profile: string, values: Record<string, unknown>): Promise<void>;
      saveCheckpoint?(): Promise<string>;
    };
    selectSkillDirectory(): Promise<SkillDirectoryResult | null>;
    installSkill(command: string, agentKey?: string, directory?: string): Promise<SkillDirectoryResult>;
    refreshSkillDirectory(directory: string): Promise<SkillDirectoryResult>;
    saveProviderKey(provider:'gemini',key:string):Promise<{saved:boolean}>;
    removeProviderKey(provider:'gemini'):Promise<{saved:boolean}>;
    calendarKey?:{
      status(profile:string):Promise<{configured:boolean;secureStorage:boolean}>;
      save(profile:string,key:string):Promise<{configured:boolean;secureStorage:boolean}>;
      remove(profile:string):Promise<{configured:boolean;secureStorage:boolean}>;
    };
    account: {
      status():Promise<{configured:boolean;signedIn:boolean;serverUrl?:string;email?:string;userId?:string;error?:string}>;
      googleConfigured():Promise<boolean>;
      googleSignIn():Promise<{email:string;userId:string;recoveryCode?:string}>;
      register(email:string,password:string):Promise<{email:string;userId:string;recoveryCode:string}>;
      login(email:string,password:string):Promise<{email:string;userId:string}>;
      googleSignIn():Promise<{email:string;userId:string;recoveryCode?:string}>;
      recover(email:string,recoveryCode:string,newPassword:string):Promise<{email:string;userId:string;recoveryCode:string}>;
      logout():Promise<{signedIn:boolean}>;
      deleteAccount(password:string):Promise<{deleted:boolean}>;
    };
  };
}
