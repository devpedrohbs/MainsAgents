import {useCallback,type Dispatch,type SetStateAction} from 'react';
import {readPersistentValue,updatePersistentValue,usePersistentState} from '../../data/localPersistence';
import {putStudioField,sameDraftShape,type DraftValue,type StudioDrafts} from './studioDraftModel';
export {studioDraftKey} from './studioDraftModel';
const key='studio-drafts';
/** Defaults are read from the exact current artifact, never an older reviewed version. */
export function useStudioDraftField<T>(scope:string,field:string,initial:T):[T,Dispatch<SetStateAction<T>>]{
 const [drafts]=usePersistentState<StudioDrafts>(key,{});
 const saved=drafts[scope]?.fields[field],value=sameDraftShape(saved,initial as DraftValue)?saved as T:initial;
 const set=useCallback<Dispatch<SetStateAction<T>>>(update=>{
  const current=readPersistentValue<StudioDrafts>(key,{}),old=current[scope]?.fields[field];
  const previous=sameDraftShape(old,initial as DraftValue)?old as T:initial;
  const next=typeof update==='function'?(update as (current:T)=>T)(previous):update;
  if(JSON.stringify(next)===JSON.stringify(previous))return;
  updatePersistentValue<StudioDrafts>(key,{},items=>putStudioField(items,scope,field,next as DraftValue));
 },[scope,field,initial]);
 return [value,set];
}
export function clearStudioDraft(scope:string){updatePersistentValue<StudioDrafts>(key,{},current=>Object.fromEntries(Object.entries(current).filter(([id])=>id!==scope)));}
