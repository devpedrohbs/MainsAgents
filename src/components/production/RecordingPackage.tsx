import {useEffect,useMemo,useState} from 'react';
import {
 CHECKLIST_ITEMS,buildRecordingPackage,checklistForPackage,checklistProgress,toggleChecklistItem,
 type ChecklistItemId,type RecordingBlockReason,type RecordingChecklistState,type RecordingRunInput,type RecordingSuggestion,
} from '../../features/production/recordingPackage';
import {Teleprompter} from './Teleprompter';
import './recording-package.css';

export interface RecordingPackageProps {
 run:RecordingRunInput;
 pt:boolean;
 busy?:boolean;
 /** Extra caller-side gate (AND-ed with the script approval/Notion gate). Defaults to true. */
 ready?:boolean;
 /** Checklist as persisted by the caller; ignored if it belongs to another version/hash. */
 checklist?:RecordingChecklistState|null;
 onChecklistChange:(next:RecordingChecklistState)=>void;
 /** Explicit user action: pick/import the video recorded outside the app. */
 onImportVideo:()=>void;
 onSuggestionsChange?:(version:number,hash:string,suggestions:RecordingSuggestion[])=>void;
 /** Suggestions persisted by the caller for this exact version/hash (restored on open). */
 suggestions?:RecordingSuggestion[]|null;
}

const itemText:Record<ChecklistItemId,[string,string]>={
 framing:['Enquadramento conferido','Framing checked'],light:['Luz conferida','Lighting checked'],
 audio:['Áudio conferido','Audio checked'],product:['Produto/material à mão','Product/material at hand'],
};
const blockText:Record<RecordingBlockReason,[string,string]>={
 'no-script':['Ainda não há roteiro para gravar.','There is no script to record yet.'],
 'no-approval':['Aprove o roteiro para liberar a gravação.','Approve the script to unlock recording.'],
 'approval-not-latest':['Há uma versão mais nova que a aprovada. Aprove a versão mais recente.','A newer version exists than the approved one. Approve the latest version.'],
 'approval-hash-mismatch':['O conteúdo mudou depois da aprovação. Aprove novamente.','The content changed after approval. Approve again.'],
 'notion-missing':['O Notion ainda não tem esta versão do roteiro.','Notion does not have this script version yet.'],
 'notion-mismatch':['O Notion está com outra versão do roteiro. Sincronize antes de gravar.','Notion holds a different script version. Sync before recording.'],
};

export function RecordingPackage({run,pt,busy=false,ready=true,checklist,onChecklistChange,onImportVideo,onSuggestionsChange,suggestions:saved}:RecordingPackageProps){
 const say=([a,b]:[string,string])=>pt?a:b;
 const built=useMemo(()=>buildRecordingPackage(run,pt),[run,pt]);
 const key=built.ok?`${built.pkg.version}:${built.pkg.hash}`:'';
 const [edits,setEdits]=useState<Record<string,string>>({}),[reading,setReading]=useState(false);
 // Suggestion edits never carry over to another version; saved ones are restored for the same version/hash.
 useEffect(()=>setEdits(Object.fromEntries((saved??[]).map(s=>[s.id,s.text]))),[key]); // eslint-disable-line react-hooks/exhaustive-deps
 if(!built.ok)return <section className="recording-package" data-ready="false" aria-label={pt?'Pacote de gravação':'Recording package'}>
  <p className="recording-package-block" role="status">{say(blockText[built.reason])}</p>
 </section>;
 const pkg=built.pkg;
 const state=checklistForPackage(checklist,pkg),progress=checklistProgress(state);
 const canRecord=ready;
 const suggestions=pkg.suggestions.map(s=>({...s,text:edits[s.id]??s.text}));
 const edit=(id:string,text:string)=>{
  const next={...edits,[id]:text};setEdits(next);
  onSuggestionsChange?.(pkg.version,pkg.hash,pkg.suggestions.map(s=>({...s,text:next[s.id]??s.text})));
 };
 return <section className="recording-package" data-ready={canRecord} aria-label={pt?'Pacote de gravação':'Recording package'} aria-busy={busy}>
  <header className="recording-package-head">
   <h3>{pt?'Pacote de gravação':'Recording package'}</h3>
   <span className="recording-package-ver">{pt?`Roteiro v${pkg.version} aprovado`:`Script v${pkg.version} approved`}</span>
  </header>
  <p className="recording-package-status" role="status">{canRecord?(pt?'Pronto para gravar.':'Ready to record.'):(pt?'Ainda não liberado para gravar.':'Not yet cleared to record.')}</p>
  <section aria-labelledby="rp-script"><h4 id="rp-script">{pt?'Fala aprovada':'Approved script'}</h4>
   {pkg.script?<><pre className="recording-package-text" tabIndex={0}>{pkg.script}</pre>
    <div className="recording-package-reading"><button type="button" className="soft-button" disabled={busy||!canRecord} onClick={()=>setReading(true)}>{pt?'Abrir modo de leitura':'Open reading mode'}</button>
     <span className="recording-package-muted">{pt?'Tela cheia, só leitura: começa pausado e não altera o roteiro.':'Full screen, read-only: starts paused and never changes the script.'}</span></div></>:<p className="recording-package-muted">{pt?'Sem texto de fala registrado.':'No script text recorded.'}</p>}
  </section>
  {(pkg.hook||pkg.cta)&&<dl className="recording-package-hookcta">
   {pkg.hook&&<div><dt>Hook</dt><dd>{pkg.hook}</dd></div>}
   {pkg.cta&&<div><dt>CTA</dt><dd>{pkg.cta}</dd></div>}
  </dl>}
  <section aria-labelledby="rp-scenes"><h4 id="rp-scenes">{pt?'Cenas':'Scenes'}{pkg.pathTitle&&` · ${pkg.pathTitle}`}</h4>
   {pkg.scenes.length?<ol className="recording-package-scenes">{pkg.scenes.map(s=><li key={s.index}>{s.title}</li>)}</ol>
    :<p className="recording-package-muted">{pt?'O caminho aprovado não define cenas.':'The approved path defines no scenes.'}</p>}
  </section>
  {pkg.improvisationTopics.length>0&&<section aria-labelledby="rp-improv"><h4 id="rp-improv">{pt?'Tópicos de improviso':'Improvisation topics'}</h4>
   <ul>{pkg.improvisationTopics.map((t,i)=><li key={i}>{t}</li>)}</ul></section>}
  {pkg.thumbnailDirection&&<section aria-labelledby="rp-thumb"><h4 id="rp-thumb">{pt?'Direção da thumbnail':'Thumbnail direction'}</h4><p>{pkg.thumbnailDirection}</p></section>}
  {suggestions.length>0&&<section aria-labelledby="rp-sugg"><h4 id="rp-sugg">{pt?'Sugestões de B-roll e materiais':'B-roll and material suggestions'}</h4>
   <p className="recording-package-muted">{pt?'São sugestões editáveis, não fatos do roteiro.':'These are editable suggestions, not facts from the script.'}</p>
   <ul className="recording-package-suggestions">{suggestions.map(s=>{
    const scene=pkg.scenes.find(c=>c.index===s.sceneIndex);
    return <li key={s.id}><label>
     <span>{s.kind==='broll'?'B-roll':'Material'} · {pt?'cena':'scene'} {s.sceneIndex}{scene&&`: ${scene.title}`} <em>({pt?'sugestão':'suggestion'})</em></span>
     <textarea rows={2} value={s.text} disabled={busy} placeholder={pt?'Escreva sua sugestão':'Write your suggestion'} onChange={e=>edit(s.id,e.target.value)}/>
    </label></li>;})}</ul></section>}
  <fieldset className="recording-package-checklist" disabled={busy}>
   <legend>{pt?'Antes de gravar':'Before recording'}</legend>
   <p className="recording-package-progress" role="status" aria-live="polite">{pt?`${progress.done} de ${progress.total} conferidos`:`${progress.done} of ${progress.total} checked`}
    <progress max={progress.total} value={progress.done} aria-hidden="true"/></p>
   {CHECKLIST_ITEMS.map(id=><label key={id} className="recording-package-check">
    <input type="checkbox" checked={state.items[id]===true} onChange={e=>onChecklistChange(toggleChecklistItem(checklist,pkg,id,e.target.checked))}/>
    <span>{say(itemText[id])}</span>
   </label>)}
   <p className="recording-package-muted">{pt?'A lista é um apoio; não bloqueia a gravação.':'The list is a helper; it does not block recording.'}</p>
  </fieldset>
  <div className="recording-package-actions">
   <p className="recording-package-muted">{pt?'Grave fora do app e depois importe o vídeo.':'Record outside the app, then import the video.'}</p>
   <button type="button" className="recording-package-import" disabled={busy||!canRecord} onClick={onImportVideo}>
    {busy?(pt?'Importando…':'Importing…'):(pt?'Importar vídeo gravado':'Import recorded video')}
   </button>
  </div>
  {reading&&<Teleprompter script={pkg.script} version={pkg.version} scenes={pkg.scenes} pathTitle={pkg.pathTitle} pt={pt} onClose={()=>setReading(false)}/>}
 </section>;
}
