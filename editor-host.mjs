/**
 * Host callbacks of the editor-authoring contract (mainsagents.editor-authoring/1, editor-authoring.mjs) for ONE edit run.
 * The editor (Claude with mainsagents_editor tools) sees the recording, writes plan revisions, renders short previews and
 * stills with the real motion engine, and finalizes once; this host validates everything with the same validators as the
 * export, keeps the source/version/authority binding, persists revisions on the run and runs the single final export.
 * Paths returned here go to the editor bridge (which never forwards them to the model) and stay inside the app's folders.
 */
import {segmentsHash,storyboardFactProblems,numbersIn} from './editorial-storyboard.mjs';
import {cutDecisionReport,retainedSpeech} from './editor-retakes.mjs';
import {localPatchProblems,windowLabel,LOCAL_PATCH_LIMITS} from './editor-local-patch.mjs';
import {remotionAnimations} from './editorial-smart-edit.mjs';
import {resolveAnimations,storyboardReport} from './editorial-remotion.mjs';
import {editedSize} from './editorial-media.mjs';
import {hashFile} from './editor-authoring.mjs';
import {readdir} from 'node:fs/promises';
import {join} from 'node:path';

/**
 * True when a plan has at least one VISIBLE motion element: a storyboard layer, a camera move or non-full layout, a
 * transition other than a cut, a background, a fixed overlay or a motion cue. A storyboard of empty scenes is not motion.
 */
export function hasVisibleMotion(plan){
 const moving=keys=>Array.isArray(keys)&&keys.length>1&&new Set(keys.map(key=>key?.v)).size>1;
 const scene=item=>Boolean(item?.layers?.length||item?.camera&&(item.camera.layout&&item.camera.layout!=='full'||moving(item.camera.zoom))||item?.transitionIn?.kind&&item.transitionIn.kind!=='cut'||item?.background?.kind&&item.background.kind!=='none');
 return Boolean(plan?.animations?.length||plan?.motion?.cues?.length||plan?.storyboard?.scenes?.some(scene));
}

const positions={entrada:'in',meio:'mid',saida:'out',in:'in',mid:'mid',out:'out',auto:'mid',manual:'mid'};
const sceneWindows=plan=>(plan?.storyboard?.scenes??[]).map(scene=>({id:scene.id,start:scene.start,end:scene.end}));

/**
 * The source transcript as the host holds it: sentence segments plus the REAL word timings of the local transcription (never
 * estimated here; without them timing is 'sentences'). Times are on the SOURCE timeline. Legacy callers pass the segments array.
 */
export function hostTranscript(value){
 const raw=Array.isArray(value)?{segments:value}:value&&typeof value==='object'?value:{},finite=Number.isFinite,round=n=>Math.round(n*1000)/1000;
 const segments=(Array.isArray(raw.segments)?raw.segments:[]).filter(item=>finite(item?.start)&&finite(item?.end)&&item.end>item.start&&typeof item.text==='string').map(item=>({start:item.start,end:item.end,text:item.text}));
 const words=(Array.isArray(raw.words)?raw.words:[]).filter(item=>finite(item?.start)&&finite(item?.end)&&item.end>item.start&&item.start>=0&&typeof item.text==='string'&&item.text.trim()).map(item=>({start:round(item.start),end:round(item.end),text:item.text.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,40)})).sort((a,b)=>a.start-b.start);
 const label=key=>typeof raw[key]==='string'&&raw[key]?raw[key].slice(0,60):undefined;
 return {segments,words,timing:words.length?'words':segments.length?'sentences':'none',...Object.fromEntries(['origin','engine','model','language'].map(key=>[key,label(key)]).filter(([,v])=>v))};
}

/** Texts a layer puts on screen (same fields as the fact proof of the storyboard). */
const shownTexts=layer=>{switch(layer?.type){case 'text':case 'callout':case 'chapter':return [layer.text];case 'counter':return [String(layer.value),layer.label??''];case 'steps':return layer.items??[];case 'process':return layer.nodes??[];case 'compare':return [layer.before?.label,layer.before?.text,layer.after?.label,layer.after?.text];case 'bars':return (layer.values??[]).flatMap(item=>[item.label,String(item.value)]);case 'image':case 'video':return [layer.caption??''];default:return [];}};

/**
 * patch: {window,basePlan,inside} = localized visual adjustment of a delivered edit (cuts/audio frozen, only the window may
 * change). retakes: semantic-cut candidates of this source (editor-retakes.mjs), evidence for the editor; it decides.
 */
export function createEditorHost({profile,binding,motionRequired=false,read,bindingOf,update,guard,media,ref,base,brief,transcript:rawTranscript,guidance,userTexts=[],planSchema,finalExport,exportStatus,authoringRoot,patch,retakes=[]}){
 const transcript=hostTranscript(rawTranscript),{words,...transcriptInfo}=transcript;
 // Fact proof (A): numbers/quotes on screen must exist in the speech that SURVIVES the cuts of this plan (a corrected take that
 // was cut out is not a source) or in the brief; 'user' facts only in what the user typed.
 const retainedText=plan=>retainedSpeech({segments:plan?.segments??base.segments,words,sentences:transcript.segments});
 // Pre-render QA (A's own resolver + storyboardQa, pure, no render): what the final export would refuse is refused at
 // write_plan, so the editor fixes it inside its revision budget instead of finding out after finalize.
 let source;
 const sourceMeta=async signal=>source??=(await media.authoring(profile,{...ref,plan:{segments:base.segments,format:base.format},kind:'context'},{signal})).metadata;
 const qaOf=async(plan,outputDuration,signal)=>{
  if(!plan?.storyboard)return null;
  await sourceMeta(signal);
  const size=editedSize(plan,source),display={width:source.width,height:source.height};
  let start=0;const cutsAt=plan.segments.slice(0,-1).map(item=>start+=item.end-item.start);
  // Camera+screen: QA sees the same per-scene composition the render applies (camera in the corner / hidden).
  const props=resolveAnimations({...remotionAnimations(plan,{source:display}),...(ref?.pair?{screen:{mode:ref.pair.layout==='screen-full'?'full':'with-camera',windows:[],width:2,height:2}}:{})},{...size,fps:source.fps,durationSeconds:outputDuration,hasAudio:source.hasAudio},{assetIds:(plan.storyboard.assets??[]).map(item=>item.id)});
  return storyboardReport(props,{...size,fps:source.fps,cutsAt})?.qa??null;
 };
 const factProblems=plan=>plan?.storyboard?storyboardFactProblems(plan.storyboard,{transcriptText:retainedText(plan),briefText:String(brief??''),userTexts:userTexts.filter(text=>typeof text==='string'&&text.trim())}):[];
 // A number the speaker denied ("não são 30, são 13") may still be on screen, but only with that context: a warning, not a veto.
 const negated=retakes.filter(item=>item.kind==='negated-number'&&Array.isArray(item.evidence?.numbers)).map(item=>({value:item.evidence.numbers[0],quote:item.evidence.kept}));
 const negatedWarnings=plan=>{if(!negated.length||!plan?.storyboard)return [];const out=[];for(const scene of plan.storyboard.scenes)for(const layer of scene.layers){if(layer.source!=='speech')continue;const shown=numbersIn(shownTexts(layer).join(' '));for(const item of negated)if(shown.includes(item.value))out.push(`${scene.id}/${layer.id}: ${item.value} is DENIED in the speech ("${item.quote}"); show it only as the denied value, never as the fact.`);}return out.slice(0,6);};
 const folder=`${binding.runId}-e${binding.epoch}`.replace(/[^a-zA-Z0-9_-]/g,'');
 const previews=new Map();
 // The model controls cuts, storyboard, theme and audio flags inside the validators; the frame format stays the one the user authorized.
 // A storyboard written together with its cuts is bound to THOSE cuts: the host fills timeline.segmentsHash when omitted
 // (a model cannot compute it); a hash given for other cuts still fails as stale.
 const merged=plan=>{const value={...base,...(plan&&typeof plan==='object'&&!Array.isArray(plan)?plan:{})};value.format=base.format;
  const story=value.storyboard;if(story&&typeof story==='object'&&!Array.isArray(story)&&Array.isArray(value.segments)){const timeline=story.timeline&&typeof story.timeline==='object'&&!Array.isArray(story.timeline)?story.timeline:{basis:'output'};if(timeline.segmentsHash===undefined)value.storyboard={...story,timeline:{...timeline,segmentsHash:segmentsHash(value.segments)}};}
  return value;};
 const saved=revision=>{const authoring=read()?.authoring;const entry=authoring?.revisions?.find(item=>item.revision===revision);if(!entry)throw new Error('Unknown plan revision.');return entry;};
 const authoring=(input,signal)=>media.authoring(profile,{...ref,...input,folder},{signal});
 return {
  // Re-read on every call: epoch, editor agent, source version and authority come from the saved run, never a cached copy.
  currentBinding(){const p=read();if(!p)throw new Error('The production was removed.');guard(p);return {...binding,epoch:p.epoch,...(bindingOf?bindingOf(p):{})};},
  /** A camera+screen content: the director must also look at the screen recording before finalizing. */
  hasScreen:Boolean(ref?.pair),
  async context({signal}={}){
   const p=read(),c=await authoring({plan:{segments:base.segments,format:base.format},kind:'context'},signal);
   return {metadata:c.metadata,outputDuration:c.outputDuration,
    ...(c.pair?{screenRecording:{...c.pair,sceneScreen:{off:'camera only (its own camera.layout)',full:'the screen recording fills the frame (camera hidden)','with-camera':'the screen recording plus the camera in the top-right corner (the screen is placed left/below it, never covered)'},note:'Two sources of the SAME content: the camera is the primary timeline (segments are camera times; voice, cuts and retakes apply to both). Choose per scene with storyboard scene.screen. The screen is always shown contained (real interface, aspect preserved). Where the edited timeline has no screen (editedScreenWindows), the camera is shown full automatically. Inspect the screen with get_frames/contact_sheet target "screen" (camera timeline times).'}}:{}),transcript:transcript.segments.length||words.length?{...transcriptInfo,words:words.length}:undefined,brief,
    ...(guidance?.items?.length||guidance?.skipped?.length?{guidance}:{}),
    capabilities:{storyboard:true,stills:true,preview:true,assets:c.assets},planSchema,
    currentPlan:p?.authoring?.plan??(patch?patch.basePlan:{segments:base.segments,theme:base.theme,normalizeAudio:base.normalizeAudio}),
    ...(retakes.length&&!patch?{retakes:{note:'Evidence only (approximate word times, source timeline). Decide by meaning: keep the complete take, never cut expressive pauses or intentional repetition by rule. Declare each decision in write_plan.cutDecisions (cut|keep|review + reason).',candidates:retakes}}:{}),
    ...(patch?{localAdjust:{window:patch.window,label:windowLabel(patch.window),editedTimeline:true,frozen:['segments (cuts)','audio, normalizeAudio and storyboard.sfx','storyboard style/assets/timeline','every scene shown outside the window (including the camera layout a neighbour scene inherits)'],editableScenes:patch.inside??[],previewWindow:{start:Math.max(0,patch.window.start-LOCAL_PATCH_LIMITS.previewMargin),end:patch.window.end+LOCAL_PATCH_LIMITS.previewMargin}}}:{}),
    ...(!p?.authoring?.plan&&p?.authoring?.previousPlan?{previousPlan:p.authoring.previousPlan}:{}),
    segmentsHash:segmentsHash(p?.authoring?.plan?.segments??base.segments),
    notes:['Cuts: keep speech; suggested segments come from measured silences. Frame format is fixed by the user.','Storyboard times are on the EDITED timeline (after cuts). storyboard.timeline.segmentsHash may be omitted: the host binds it to the segments sent in the same write_plan.','Facts on screen must come from the transcript or the brief (source speech|brief with the literal quote).']};
  },
  /**
   * Real words (source timeline) whose START falls in [start,end): consecutive windows never skip or repeat a word, even with
   * overlapping or equal timestamps. [] when the transcription has no word timings. Read-only, no media work.
   */
  transcriptWords({start=0,end=Infinity}={}){return {...transcriptInfo,segments:undefined,words:words.filter(item=>item.start>=start&&item.start<end)};},
  async frames({target,times=[],maxWidth=640,signal}={}){
   if(target==='screen'){const result=await authoring({plan:{segments:base.segments,format:base.format},kind:'screen-frames',times,maxWidth},signal);return result.frames;}
   if(target==='source'||target===undefined)return (await authoring({plan:{segments:base.segments,format:base.format},kind:'source-frames',times,maxWidth},signal)).frames;
   if(target?.previewId){const preview=previews.get(target.previewId);if(!preview)throw new Error('Unknown preview.');return (await media.authoringFrames(profile,{path:preview.path,times,maxWidth},{signal})).frames;}
   if(Number.isInteger(target?.revision)){const entry=saved(target.revision);const result=await authoring({plan:entry.plan,kind:'stills',times,revision:target.revision},signal);return result.stills.map(item=>({time:item.seconds,path:item.path,mimeType:'image/png'}));}
   throw new Error('Unknown frame target.');
  },
  async contactSheet({target,start=0,end,count=9,signal}={}){
   if(target==='screen')return authoring({plan:{segments:base.segments,format:base.format},kind:'screen-sheet',start,end,count},signal);
   if(target==='source'||target===undefined)return authoring({plan:{segments:base.segments,format:base.format},kind:'source-sheet',start,end,count},signal);
   if(target?.previewId){const preview=previews.get(target.previewId);if(!preview)throw new Error('Unknown preview.');return media.authoringFrames(profile,{path:preview.path,sheet:{start,end:end??preview.duration,count}},{signal});}
   if(Number.isInteger(target?.revision)){
    const entry=saved(target.revision),n=Math.min(16,Math.max(2,Math.round(count))),stop=Number.isFinite(end)?end:entry.outputDuration??start+n,times=Array.from({length:n},(_,i)=>start+(stop-start)*(i+0.5)/n);
    const result=await authoring({plan:entry.plan,kind:'stills',times,revision:target.revision},signal);const sheet=result.contactSheets?.[0];
    if(!sheet)throw new Error('The motion engine returned no contact sheet.');return {path:sheet.path,mimeType:'image/jpeg',times:result.stills.map(item=>item.seconds)};
   }
   throw new Error('Unknown contact sheet target.');
  },
  async validatePlan({plan,cutDecisions,signal}={}){
   try{
    // Local adjustment: a different cut list is refused with the reason before any generic storyboard check.
    if(patch&&JSON.stringify(merged(plan).segments)!==JSON.stringify(patch.basePlan.segments))return {ok:false,errors:['Os cortes não podem mudar num ajuste de trecho (a fala e a linha do tempo ficam idênticas). Mantenha segments iguais aos do plano entregue; para cortar ou reordenar, a pessoa pede um ajuste geral.']};
    const result=await media.plan(profile,{...ref,plan:merged(plan)});
    if(patch&&cutDecisions?.length)return {ok:false,errors:['A local visual adjustment keeps every cut: send no cutDecisions.']};
    const decisions=cutDecisionReport(cutDecisions,{segments:result.plan.segments,words,candidates:retakes});
    if(decisions.errors.length)return {ok:false,errors:decisions.errors.slice(0,12)};
    let patchProof;
    if(patch){const meta=await sourceMeta(signal),check=localPatchProblems(patch.basePlan,result.plan,patch.window,{fps:meta.fps,outputDuration:result.outputDuration,...(ref?.pair?{screenMode:ref.pair.layout==='screen-full'?'full':'with-camera'}:{})});if(check.errors.length)return {ok:false,errors:check.errors};patchProof=check.proof;}
    const facts=factProblems(result.plan);if(facts.length)return {ok:false,errors:facts.slice(0,20).map(item=>`${item.id}: ${item.reason}`)};
    if(motionRequired&&!hasVisibleMotion(result.plan))return {ok:false,errors:['Motion was requested for this edit: the plan needs at least one visible motion element (storyboard layers, a camera move or layout, a transition). A cuts-only plan or empty scenes cannot be delivered.']};
    const qa=await qaOf(result.plan,result.outputDuration,signal);
    if(qa&&!qa.ok)return {ok:false,errors:qa.errors.slice(0,12).map(item=>`QA ${item.id}: ${item.code}${item.detail?` (${String(item.detail).slice(0,160)})`:''}`)};
    const warnings=[...(qa?.warnings??[]).slice(0,8).map(item=>`QA ${item.id}: ${item.code}`),...decisions.warnings,...negatedWarnings(result.plan)];if(!result.plan.storyboard&&!result.plan.animations?.length&&!result.plan.motion?.cues?.length)warnings.push('No motion: this revision has no storyboard, overlays or motion cues.');
    return {ok:true,plan:result.plan,planHash:result.planHash,scenes:sceneWindows(result.plan),warnings,cutDecisions:decisions.decisions,...(patchProof?{patchProof}:{}),summary:`${result.plan.segments.length} segment(s), ${result.outputDuration.toFixed(1)}s edited (from ${result.sourceDuration.toFixed(1)}s)${result.plan.storyboard?`, ${result.plan.storyboard.scenes.length} storyboard scene(s)`:''}.`,outputDuration:result.outputDuration};}
   catch(error){return {ok:false,errors:[String(error?.message??error).slice(0,1000)]};}
  },
  async savePlan({revision,plan,planHash,note,cutDecisions,patchProof}={}){
   const check=await media.plan(profile,{...ref,plan});if(check.planHash!==planHash)throw new Error('The saved plan differs from the validated revision.');
   update(p=>{const current=p.authoring??{revisions:[]};p.authoring={...current,revision,plan:check.plan,planHash,revisions:[...(current.revisions??[]).filter(item=>item.revision!==revision),{revision,plan:check.plan,planHash,note:String(note??'').slice(0,500),outputDuration:check.outputDuration,...(Array.isArray(cutDecisions)&&cutDecisions.length?{cutDecisions}:{}),...(patchProof?{patchProof}:{}),at:new Date().toISOString()}].slice(-8)};});
  },
  async renderPreview({revision,planHash,start=0,duration=6,signal}={}){
   const entry=saved(revision);if(entry.planHash!==planHash)throw new Error('This preview does not match the saved revision.');
   // A local adjustment previews only its window (+margin): the rest of the video is the delivered one.
   if(patch){const lo=Math.max(0,patch.window.start-LOCAL_PATCH_LIMITS.previewMargin),hi=patch.window.end+LOCAL_PATCH_LIMITS.previewMargin;if(start<lo-0.001||start+duration>hi+0.001)throw new Error(`This is a local adjustment of ${windowLabel(patch.window)}: preview only inside ${lo.toFixed(2)}-${hi.toFixed(2)}s of the edited timeline.`);}
   const result=await authoring({plan:entry.plan,kind:'preview',start,duration,revision},signal),previewId=`preview-${result.sha256.slice(0,16)}`;
   previews.set(previewId,{path:result.path,start:result.start,duration:result.duration,revision,planHash});
   // Host-side record (path never reaches the model): a later execution of the same epoch can re-bind this preview.
   try{update(p=>{const current=p.authoring??{revisions:[]};p.authoring={...current,previews:[...(current.previews??[]).filter(item=>item.previewId!==previewId),{previewId,path:result.path,sha256:result.sha256,revision,planHash,start:result.start,duration:result.duration,at:new Date().toISOString()}].slice(-8)};});}catch{}
   return {previewId,path:result.path,sha256:result.sha256,duration:result.duration};
  },
  async storyboardStills({revision,planHash,sceneIds,maxImages=16,signal}={}){
   const entry=saved(revision);if(entry.planHash!==planHash)throw new Error('These stills do not match the saved revision.');
   // Only the requested scenes are rendered (a follow-up for the remaining scenes never re-renders the whole storyboard).
   const result=await authoring({plan:entry.plan,kind:'stills',revision,...(sceneIds?.length?{sceneIds}:{}),maxImages},signal);
   return result.stills.filter(item=>!sceneIds?.length||sceneIds.includes(item.sceneId)).slice(0,maxImages).map(item=>({sceneId:item.sceneId,position:positions[item.moment]??'mid',time:item.seconds,path:item.path,mimeType:'image/png'}));
  },
  /**
   * Re-binds a preview of the CURRENT saved revision rendered by an earlier execution of this epoch: first from the host
   * record, else (runs saved before that record existed) by hashing this run's own authoring folder. The editor module
   * re-hashes what is returned; nothing is rendered here.
   */
  async restorePreview({previewId,sha256,sha256Prefix,revision,planHash,start=0,duration=0,signal}={}){
   const p=read();if(p?.authoring?.revision!==revision||p.authoring.planHash!==planHash)return null;
   const recorded=(p.authoring.previews??[]).find(item=>item.previewId===previewId&&item.revision===revision&&item.planHash===planHash&&(!sha256||item.sha256===sha256));
   let path=recorded?.path;
   if(!path&&authoringRoot&&(sha256||sha256Prefix)){
    const dir=join(authoringRoot,folder),names=await readdir(dir).catch(()=>[]);
    for(const name of names.filter(item=>/^preview-[0-9a-f-]{36}\.mp4$/.test(item))){const candidate=join(dir,name),digest=await hashFile(candidate,signal).catch(()=>null);if(digest&&(sha256?digest===sha256:digest.startsWith(sha256Prefix))){path=candidate;break;}}
   }
   if(!path)return null;
   previews.set(previewId,{path,start:recorded?.start??start,duration:recorded?.duration??duration,revision,planHash});
   return {previewId,path};
  },
  finalExport,
  exportStatus,
  loadCheckpoint(bound){const checkpoint=read()?.authoring?.checkpoint;return checkpoint&&checkpoint.runId===bound.runId&&checkpoint.epoch===bound.epoch&&checkpoint.authorityHash===bound.authorityHash&&checkpoint.sourceSha256===bound.source.sha256?checkpoint:null;},
 };
}
