import { emptyEditorialState, type EditorialState } from './model.ts';
import {validateEditorialAssets} from '../../../editorial-assets-validation.mjs';
import {mergeEditorialState} from '../../../editorial-state-merge.mjs';
import {validatePublications} from '../../../publication-model.mjs';

type Transport = (input: string, init?: RequestInit) => Promise<Response>;
function validateSnapshot(payload:{revision:number;state:EditorialState}):void{
  if(!Number.isSafeInteger(payload.revision)||payload.revision<0||payload.state?.schemaVersion!==1||!['topics','contents','runs','artifacts','approvals'].every(key=>Array.isArray(payload.state[key as keyof EditorialState]))||!validateEditorialAssets(payload.state)||!validatePublications(payload.state))throw new Error('The editorial service returned an invalid snapshot. Saved data was preserved.');
}

/** One ordered writer. Failed edits stay available for retry and recovery export. */
export class EditorialStateClient {
  state: EditorialState = emptyEditorialState();
  revision = 0;
  ready = false;
  lastError = '';
  private dirty = false;
  private generation = 0;
  private queue: Promise<void> = Promise.resolve();
  private loading?: Promise<void>;
  private commanding=false;
  private uncertain=false;
  private base:EditorialState=emptyEditorialState();
  private listeners = new Set<() => void>();
  private url:string;
  private transport:Transport;
  constructor(url: string, transport: Transport = (input,init)=>fetch(input,init)) {this.url=url;this.transport=transport;}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private changed() { this.listeners.forEach(listener => listener()); }
  pending = () => this.dirty||this.commanding||this.uncertain;
  error = () => Boolean(this.lastError);
  snapshot = () => structuredClone(this.state);
  async load(): Promise<void> {
    this.loading ??= (async () => {
      const response = await this.transport(this.url, {cache: 'no-store'});
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Could not load editorial data.');
      validateSnapshot(payload);
      this.state = payload.state;
      this.base=structuredClone(payload.state);
      this.revision = payload.revision;
      this.ready = true;
      this.lastError = '';
      this.changed();
    })().catch(error => { this.loading = undefined; this.lastError = String(error.message ?? error); this.changed(); throw error; });
    return this.loading;
  }
  update(change: (state: EditorialState) => EditorialState): Promise<void> {
    if(this.commanding)return Promise.reject(new Error('Wait for the current editorial decision to finish.'));
    if (!this.ready) return Promise.reject(new Error(this.lastError || 'Editorial data is still loading.'));
    this.state = change(this.state);
    this.generation++;
    this.dirty = true;
    this.changed();
    // Snapshot at execution, rather than enqueue time, so later edits include
    // failed prior edits and cannot replace newer desired state with an old one.
    const write = this.queue.catch(() => {}).then(() => this.persist());
    this.queue = write;
    return write;
  }
  private async persist(): Promise<void> {
    if (!this.dirty) return;
    const generation = this.generation;
    const original = this.snapshot();let state=original,mergeBase=this.base;
    try {
      let confirmed=false;
      for(let attempt=0;attempt<3&&!confirmed;attempt++){
        const response=await this.transport(this.url,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({revision:this.revision,state})});const payload=await response.json();
        if(response.status===409){
          const read=await this.transport(this.url,{cache:'no-store'}),current=await read.json();if(!read.ok)throw new Error(payload.error??'Could not read newer editorial data.');validateSnapshot(current);
          if(JSON.stringify(current.state)===JSON.stringify(state)){this.revision=current.revision;confirmed=true;break;}
          state=mergeEditorialState(mergeBase,state,current.state);mergeBase=current.state;this.revision=current.revision;
          continue;
        }
        if(!response.ok)throw new Error(payload.error??'Could not save editorial data.');
        if(!Number.isSafeInteger(payload.revision)||payload.revision<0)throw new Error('The editorial service did not confirm this save.');this.revision=payload.revision;confirmed=true;
      }
      if(!confirmed)throw new Error('Editorial work changed repeatedly while saving. Your edits remain pending. Try saving again.');
      this.state=generation===this.generation?state:mergeEditorialState(original,this.state,state);
      this.base=structuredClone(state);
      if (generation === this.generation) this.dirty = false;
      this.lastError = '';
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally { this.changed(); }
  }
  flush = async (): Promise<void> => {
    if (!this.ready) throw new Error(this.lastError || 'Editorial data is still loading.');
    await this.queue.catch(() => {});
    if(this.uncertain)await this.reconcile();
    const write = this.queue.catch(() => {}).then(() => this.persist());
    this.queue = write;
    await write;
  };
  command = (path:string,input:Record<string,unknown>):Promise<void> => {
    if(!this.ready)return Promise.reject(new Error(this.lastError||'Editorial data is still loading.'));
    if(this.commanding)return Promise.reject(new Error('An editorial decision is already being saved.'));
    this.commanding=true;
    this.changed();
    const write=this.queue.catch(()=>{}).then(async()=>{
      if(this.uncertain)await this.reconcile();
      await this.persist();
      // Results can commit between UI polling ticks. Use a fresh revision for
      // this decision; server-side version checks still govern its payload.
      await this.reconcile();
      this.uncertain=true;
      const response=await this.transport(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...input,revision:this.revision})});
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error??'Could not save this decision.');
      validateSnapshot(payload);
      this.state=payload.state;this.revision=payload.revision;this.lastError='';this.uncertain=false;this.changed();
      this.base=structuredClone(payload.state);
    }).catch(async error=>{
      if(this.uncertain){try{await this.reconcile()}catch{this.lastError='Could not verify the last decision. Reconnect before closing.';}}
      this.changed();throw error;
    }).finally(()=>{this.commanding=false;this.changed();});
    this.queue=write;
    return write;
  };
  private async reconcile():Promise<void>{
    const response=await this.transport(this.url,{cache:'no-store'});
    const payload=await response.json();
    if(!response.ok)throw new Error('Could not verify the last editorial decision.');
    validateSnapshot(payload);
    this.state=payload.state;this.revision=payload.revision;this.uncertain=false;this.lastError='';this.changed();
    this.base=structuredClone(payload.state);
  }
  refresh=async():Promise<void>=>{
    if(!this.ready||this.pending())return;
    const generation=this.generation,revision=this.revision;
    const response=await this.transport(this.url,{cache:'no-store'}),payload=await response.json();if(!response.ok)throw new Error(payload.error??'Could not refresh editorial work.');validateSnapshot(payload);
    if(this.pending()||generation!==this.generation||revision!==this.revision)return;
    if(payload.revision>this.revision){this.state=payload.state;this.base=structuredClone(payload.state);this.revision=payload.revision;this.lastError='';this.changed();}
  };
}
