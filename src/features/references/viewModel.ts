// Read-only projections of the Round 8 snapshot (model.ts). Nothing here is stored: every value is derived from the
// last snapshot the API returned, so the screens never hold a second, competing copy of the library.
import type { EditingGuideline, EditingReference, ReferenceAnalysis, ReferenceFolder, ReferenceJob, ReferenceObservation, ReferenceSnapshot } from './model';

export type ReferenceStatus = 'unanalyzed' | 'analyzing' | 'partial' | 'review' | 'approved' | 'archived' | 'failed' | 'link';

const active = (status: string) => status === 'queued' || status === 'running';

export const currentVersion = (reference: EditingReference) => reference.versions.find((version) => version.id === reference.currentVersionId) ?? null;
export const referenceAnalyses = (snapshot: ReferenceSnapshot, referenceId: string) => snapshot.analyses.filter((analysis) => analysis.referenceId === referenceId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
export const jobFor = (snapshot: ReferenceSnapshot, targetId: string) => snapshot.jobs.filter((job) => job.targetId === targetId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
export const runningJob = (snapshot: ReferenceSnapshot, targetId: string) => { const job = jobFor(snapshot, targetId); return job && active(job.status) ? job : null; };

/** The person's decision on an observation; a guideline pointing at it also counts as approved. */
export function observationDecision(observation: ReferenceObservation, guidelines: EditingGuideline[]) {
  if (observation.decision) return observation.decision;
  return guidelines.some((guideline) => guideline.source?.observationId === observation.id) ? 'approved' : null;
}
export const observationResolved = (observation: ReferenceObservation, guidelines: EditingGuideline[]) => observationDecision(observation, guidelines) != null;

export function pendingObservations(snapshot: ReferenceSnapshot, reference: EditingReference) {
  return referenceAnalyses(snapshot, reference.id)
    .filter((analysis) => analysis.status === 'completed' || analysis.status === 'partial')
    .flatMap((analysis) => analysis.observations.filter((observation) => !observationResolved(observation, snapshot.guidelines)).map((observation) => ({ analysis, observation })));
}

export function referenceStatus(snapshot: ReferenceSnapshot, reference: EditingReference): ReferenceStatus {
  if (reference.removedAt) return 'archived';
  if (!reference.currentVersionId) return reference.sourceUrl ? 'link' : 'unanalyzed';
  const analyses = referenceAnalyses(snapshot, reference.id);
  if (analyses.some((analysis) => active(analysis.status))) return 'analyzing';
  if (pendingObservations(snapshot, reference).length) return analyses[0]?.status === 'partial' ? 'partial' : 'review';
  if (analyses[0]?.status === 'failed' || analyses[0]?.status === 'interrupted') return 'failed';
  if (snapshot.guidelines.some((guideline) => guideline.source?.referenceId === reference.id)) return 'approved';
  return analyses.length ? 'review' : 'unanalyzed';
}

export function statusLabel(status: ReferenceStatus, pt: boolean) {
  const labels: Record<ReferenceStatus, [string, string]> = {
    unanalyzed: ['Sem análise', 'Not analyzed'], analyzing: ['Em análise', 'Analyzing'], partial: ['Análise parcial', 'Partial analysis'],
    review: ['Pronta para revisar', 'Ready to review'], approved: ['Aprovada', 'Approved'], archived: ['Arquivada', 'Archived'],
    failed: ['Falha na análise', 'Analysis failed'], link: ['Só link', 'Link only'],
  };
  return labels[status][pt ? 0 : 1];
}

/** All folder ids under `id`, including itself. */
export function folderSubtree(folders: ReferenceFolder[], id: string) {
  const ids = new Set([id]);
  let grew = true;
  while (grew) { grew = false; for (const folder of folders) if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) { ids.add(folder.id); grew = true; } }
  return ids;
}

/** Coverage shown honestly: only the timestamps the backend says it examined; the rest of the range is "not examined". */
export function coverageSummary(analysis: ReferenceAnalysis) {
  const [start, end] = analysis.coverage.requested;
  return { start, end, examined: analysis.coverage.examined, pending: analysis.coverage.pending, span: Math.max(end - start, 0.001) };
}

export const jobPhase = (job: ReferenceJob | null) => job ? `${job.phase}${job.progress != null ? ` · ${Math.round(job.progress * 100)}%` : ''}` : '';

/** Seconds as 00:08 or 00:08.23 (hundredths). Never claims frame precision it does not have. */
export function formatTime(seconds: number, fine = false): string {
  const safe = Math.max(0, seconds), m = Math.floor(safe / 60), s = safe - m * 60;
  const sec = fine ? s.toFixed(2).padStart(5, '0') : String(Math.floor(s)).padStart(2, '0');
  return `${String(m).padStart(2, '0')}:${sec}`;
}
/** Short ranges (under 10 s apart or sub-second edges) keep hundredths so 0.3–0.9 never reads as 00:00–00:00. */
export const formatRange = (start: number, end: number) => { const fine = end - start < 10 && (start % 1 !== 0 || end % 1 !== 0); return `${formatTime(start, fine)}–${formatTime(end, fine)}`; };

export type ProjectSelection = { referenceIds: string[]; profileIds: string[]; kitIds: string[] };
export const PROJECT_LIMITS = { referenceIds: 8, profileIds: 4, kitIds: 6 } as const;
/** What is attached to a project (contentId), with the revision the next attach must send (0 when nothing yet). */
export function projectSelection(snapshot: ReferenceSnapshot, contentId: string) {
  return snapshot.projects?.find((project) => project.contentId === contentId) ?? null;
}

// "Use in Studio" hand-off: kept in memory only until the next project editing panel opens; never persisted.
let pendingStudioReference: string | null = null;
export const offerReferenceToStudio = (referenceId: string) => { pendingStudioReference = referenceId; };
export const takeReferenceForStudio = () => { const value = pendingStudioReference; pendingStudioReference = null; return value; };
export const peekReferenceForStudio = () => pendingStudioReference;
