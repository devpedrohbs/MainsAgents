interface InstalledSkillInfo { name: string; path: string; filePath?: string }
interface SkillDirectoryResult { directory: string; skills: InstalledSkillInfo[] }

interface Window {
  mainsAgentsDesktop?: {
    canvasBrowser?: boolean;
    state?: {
      profile?: string;
      hasProfile(profile: string): Promise<boolean>;
      initialize(profile: string, values: Record<string, unknown>): Promise<void>;
      read<T>(profile: string, key: string): Promise<T | undefined>;
      write<T>(profile: string, key: string, value: T): Promise<void>;
      readAll(profile: string): Promise<Record<string, unknown>>;
      replaceAll(profile: string, values: Record<string, unknown>): Promise<void>;
    };
    selectSkillDirectory(): Promise<SkillDirectoryResult | null>;
    installSkill(command: string, agentKey?: string, directory?: string): Promise<SkillDirectoryResult>;
    refreshSkillDirectory(directory: string): Promise<SkillDirectoryResult>;
    saveProviderKey(provider:'gemini',key:string):Promise<{saved:boolean}>;
    removeProviderKey(provider:'gemini'):Promise<{saved:boolean}>;
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
