interface InstalledSkillInfo { name: string; path: string }
interface SkillDirectoryResult { directory: string; skills: InstalledSkillInfo[] }

interface Window {
  mainsAgentsDesktop?: {
    selectSkillDirectory(): Promise<SkillDirectoryResult | null>;
    installSkill(source: string): Promise<SkillDirectoryResult>;
  };
}
