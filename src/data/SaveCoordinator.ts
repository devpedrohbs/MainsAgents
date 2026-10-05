export type SavePhase = 'saved' | 'saving' | 'error';
export interface SaveParticipant {
  flush(): Promise<void>;
  pending(): boolean;
  error(): boolean;
  snapshot?(): unknown;
}

/** Modules join the same close/export barrier without depending on React. */
export class SaveCoordinator {
  private participants = new Map<string, SaveParticipant>();
  private listeners = new Set<() => void>();
  private status = {phase: 'saved' as SavePhase, pending: 0};

  register(name: string, participant: SaveParticipant): () => void {
    this.participants.set(name, participant);
    this.changed();
    return () => {
      // Do not unregister unsaved work when its view unmounts.
      if (this.participants.get(name) === participant && !participant.pending()) {
        this.participants.delete(name);
        this.changed();
      }
    };
  }
  changed = () => {
    const entries = [...this.participants.values()];
    const pending = entries.filter(item => item.pending()).length;
    const phase: SavePhase = entries.some(item => item.error()) ? 'error' : pending ? 'saving' : 'saved';
    if (phase === this.status.phase && pending === this.status.pending) return;
    this.status = {phase, pending};
    this.listeners.forEach(listener => listener());
  };
  getStatus = () => this.status;
  snapshot(name: string): unknown { return this.participants.get(name)?.snapshot?.(); }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  async flush(): Promise<void> {
    // Await every store even if another fails; failure still prevents closing.
    const results = await Promise.allSettled([...this.participants.values()].map(item => item.flush()));
    this.changed();
    const failure = results.find(item => item.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    if (this.status.pending) throw new Error('Some local changes have not been saved.');
  }
}

export const saveCoordinator = new SaveCoordinator();
