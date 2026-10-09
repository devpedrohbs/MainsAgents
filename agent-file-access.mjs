import {isAbsolute,resolve,parse} from 'node:path';
import {realpathSync,statSync} from 'node:fs';

/** Host-owned setting; request text never grants filesystem access. */
export function agentFileAccess(agent,cwd){
 if(agent?.fileAccess?.enabled!==true)return {cwd,sandbox:'read-only',config:{},sandboxPolicy:{type:'readOnly',networkAccess:false},instructions:'Local filesystem access is read-only. Do not claim that an edited file was produced.'};
 if((agent.providerId??'codex')!=='codex'||!agent.tools?.includes('files'))throw Error('A escrita local requer um agente Codex com a ferramenta Files habilitada.');
 const raw=agent.fileAccess.outputDirectory;
 if(typeof raw!=='string'||!raw.trim()||!isAbsolute(raw)||raw.includes('\0')||/^\\\\|^\\\?/.test(raw))throw Error('Escolha uma pasta de saída local com caminho absoluto.');
 const root=resolve(raw.trim());if(root===parse(root).root)throw Error('Selecione uma pasta de saída, não a raiz do disco.');
 const canonical=realpathSync(root);if(!statSync(canonical).isDirectory())throw Error('A pasta de saída não está disponível.');
 const normalize=p=>process.platform==='win32'?p.toLowerCase():p;
 if(normalize(canonical)!==normalize(root))throw Error('A pasta de saída foi redirecionada. Selecione novamente o destino real.');
 const sandboxPolicy={type:'workspaceWrite',writableRoots:[canonical],networkAccess:false,excludeTmpdirEnvVar:true,excludeSlashTmp:true};
 return {cwd:canonical,sandbox:'workspace-write',sandboxPolicy,config:{'sandbox_workspace_write.writable_roots':[canonical],'sandbox_workspace_write.network_access':false,'sandbox_workspace_write.exclude_tmpdir_env_var':true,'sandbox_workspace_write.exclude_slash_tmp':true},instructions:`The user enabled local file creation and editing for this agent in ${canonical}. This is the working directory and the only authorized output root. Save new outputs, scripts and caches inside this folder. Read original media and associated skills from their supplied absolute paths; preserve original files and existing versions. Use FFmpeg/ffprobe for actual inspection/cuts and produce a verified new file. Do not publish, schedule, install software or change other folders. This preference is not approval of a video or publication. Network access for shell commands is disabled. If a tool is unavailable or sandbox execution fails, report the actual error; never bypass the sandbox or claim an export without a file.`};
}
