// B08 — reading mode for recording. Pure helpers, no I/O: the approved script is displayed verbatim and is
// never rewritten, split or persisted here, so its version/hash cannot change by reading it.

export const FONT_SIZES=[28,36,44,56,68,84,104] as const;
export const SPEEDS=[0,15,30,45,60,80,100,130,170] as const; // px per second; 0 is "stopped"
export const DEFAULT_FONT_INDEX=2;
export const DEFAULT_SPEED_INDEX=3;

export interface TeleprompterSettings {fontIndex:number;speedIndex:number;mirror:boolean}
export const defaultSettings=():TeleprompterSettings=>({fontIndex:DEFAULT_FONT_INDEX,speedIndex:DEFAULT_SPEED_INDEX,mirror:false});

const clampIndex=(value:number,length:number,fallback:number)=>Number.isFinite(value)?Math.min(length-1,Math.max(0,Math.round(value))):fallback;
export const stepFont=(settings:TeleprompterSettings,delta:number):TeleprompterSettings=>({...settings,fontIndex:clampIndex(settings.fontIndex+delta,FONT_SIZES.length,DEFAULT_FONT_INDEX)});
/** The slowest selectable speed is 15 px/s: "0" is reserved for pause, so stepping speed never silently stops the text. */
export const stepSpeed=(settings:TeleprompterSettings,delta:number):TeleprompterSettings=>({...settings,speedIndex:Math.min(SPEEDS.length-1,Math.max(1,clampIndex(settings.speedIndex+delta,SPEEDS.length,DEFAULT_SPEED_INDEX)))});
export const fontSize=(settings:TeleprompterSettings)=>FONT_SIZES[clampIndex(settings.fontIndex,FONT_SIZES.length,DEFAULT_FONT_INDEX)];
export const speed=(settings:TeleprompterSettings)=>SPEEDS[Math.max(1,clampIndex(settings.speedIndex,SPEEDS.length,DEFAULT_SPEED_INDEX))];

export interface ReadingState {playing:boolean;atEnd:boolean}
/** Reading always opens paused. With reduced motion there is no automatic scroll at all. */
export const initialReadingState=():ReadingState=>({playing:false,atEnd:false});
export function canAutoScroll(prefersReducedMotion:boolean){return !prefersReducedMotion;}
export function togglePlaying(state:ReadingState,prefersReducedMotion:boolean):ReadingState{
 if(prefersReducedMotion)return {...state,playing:false};
 return {playing:!state.playing,atEnd:false};
}

/** Next scroll offset after `elapsedMs`; never beyond `max`. `reachedEnd` lets the caller pause at the end. */
export function advanceScroll(position:number,elapsedMs:number,pxPerSecond:number,max:number){
 const safeMax=Math.max(0,Number.isFinite(max)?max:0);
 const next=Math.min(safeMax,Math.max(0,position+(Math.max(0,elapsedMs)/1000)*Math.max(0,pxPerSecond)));
 return {position:next,reachedEnd:next>=safeMax};
}
/** Manual page step for reduced motion / keyboard use: 85% of the viewport so the last line stays visible. */
export const pageStep=(position:number,viewport:number,direction:1|-1,max:number)=>Math.min(Math.max(0,max),Math.max(0,position+direction*Math.max(1,Math.round(viewport*0.85))));

export interface ReadingScene {index:number;title:string}
export const sceneNavigation=(scenes:readonly ReadingScene[],current:number,delta:number)=>scenes.length?Math.min(scenes.length-1,Math.max(0,current+delta)):0;

/** Space toggles reading unless the user is typing or operating a control that uses Space itself. */
export function spaceShouldToggle(target:{tagName?:string;isContentEditable?:boolean;getAttribute?:(name:string)=>string|null}|null){
 const tag=(target?.tagName??'').toUpperCase();
 if(['INPUT','TEXTAREA','SELECT','BUTTON','A','SUMMARY'].includes(tag))return false;
 if(target?.isContentEditable)return false;
 const role=target?.getAttribute?.('role');
 return !(role==='button'||role==='checkbox'||role==='switch'||role==='slider');
}
