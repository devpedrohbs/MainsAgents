import type {ChatContextReference} from './model/Chat';

/** A photo, file or folder attached to the message being written (videos keep their own edit flow). */
export interface ComposerFile {path:string;name:string;kind:'image'|'file'|'folder';size?:number;thumbnail?:string}
export const attachmentKinds:readonly string[]=['image','file','folder'];
const videoPath=/\.(mp4|mov|m4v|mkv|webm|avi)$/i;

/** Attachments sent with a user message, from its context nodes (files that are videos are shown by the edit flow). */
export const messageFiles=(nodes:readonly ChatContextReference[]=[])=>nodes.filter(node=>attachmentKinds.includes(node.kind)&&!(node.kind==='file'&&videoPath.test(node.content??'')));

export function fileBadge(item:{name:string;kind:string}){
 if(item.kind==='folder')return 'DIR';
 if(item.kind==='image')return 'IMG';
 const ext=/\.([a-z0-9]{1,4})$/i.exec(item.name)?.[1];
 return ext?ext.toUpperCase():'ARQ';
}
export function formatBytes(size?:number){
 if(size===undefined)return '';
 if(size<1024)return `${size} B`;
 if(size<1024*1024)return `${Math.round(size/1024)} KB`;
 return `${(size/1024/1024).toFixed(size<10*1024*1024?1:0).replace('.',',')} MB`;
}
