import type {ContextSelection,EditingContextManifest,ReferenceCommand,ReferenceCommandResult,ReferenceScope,ReferenceSnapshot} from './model';
const route=(scope:ReferenceScope,suffix='')=>`/api/content/editing-references${suffix}?${new URLSearchParams({profile:scope.profile,workspaceId:scope.workspaceId})}`;
async function read<T>(response:Response):Promise<T>{const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.error||'Reference operation failed'),{code:value.code,status:response.status});return value;}
export const loadReferences=(scope:ReferenceScope,signal?:AbortSignal)=>fetch(route(scope),{cache:'no-store',signal}).then(read<ReferenceSnapshot>);
export const referenceCommand=(scope:ReferenceScope,command:ReferenceCommand)=>fetch(route(scope),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestKey:crypto.randomUUID(),...command})}).then(read<ReferenceCommandResult>);
export const editingContext=(scope:ReferenceScope,selection:ContextSelection={})=>fetch(route(scope,'/context'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(selection)}).then(read<EditingContextManifest>);
export async function importReferenceVideos(scope:ReferenceScope,folderId:string|null=null,referenceId?:string,expectedRevision?:number):Promise<ReferenceCommandResult|null>{
 const bridge=window.mainsAgentsDesktop?.editingReferences;if(!bridge)throw new Error('Video import requires the desktop app');
 return bridge.importVideos({...scope,folderId,referenceId,expectedRevision});
}
export const referenceVideoUrl=(scope:ReferenceScope,referenceId:string,versionId:string)=>route(scope,`/media/reference/${encodeURIComponent(referenceId)}/${encodeURIComponent(versionId)}`);
export const referenceFrameUrl=(scope:ReferenceScope,analysisId:string,frameId:string)=>route(scope,`/media/frame/${encodeURIComponent(analysisId)}/${encodeURIComponent(frameId)}`);
export const studyArtifactUrl=(scope:ReferenceScope,studyId:string,artifactId:string)=>route(scope,`/media/study/${encodeURIComponent(studyId)}/${encodeURIComponent(artifactId)}`);
