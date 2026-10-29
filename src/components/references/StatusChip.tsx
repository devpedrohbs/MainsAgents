import type { ReferenceStatus } from '../../features/references/viewModel';

// Each status carries its own glyph so it never depends on color alone.
const glyph: Record<ReferenceStatus, string> = {
  unanalyzed: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  analyzing: 'M12 3a9 9 0 1 0 9 9',
  partial: 'M12 3a9 9 0 0 1 0 18zM12 3a9 9 0 1 0 0 18',
  review: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  approved: 'M5 12l5 5 9-10',
  archived: 'M4 7h16M6 7v12h12V7M10 11h4',
  failed: 'M12 4l9 16H3zM12 10v4M12 17v.5',
  link: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1',
};

export function StatusChip({ status, label }: { status: ReferenceStatus; label: string }) {
  return <span className={`er-status er-status-${status}`}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={glyph[status]} /></svg>{label}</span>;
}
