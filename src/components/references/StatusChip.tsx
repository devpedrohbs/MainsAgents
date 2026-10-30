import type { ReferenceStatus } from '../../features/references/viewModel';
import { StatusIcon, type RunState } from '../common/StatusIcon';

const states: Record<ReferenceStatus, RunState> = {
  unanalyzed: 'queued', analyzing: 'running', partial: 'paused', review: 'waiting',
  approved: 'done', archived: 'paused', failed: 'failed', link: 'queued',
};

export function StatusChip({ status, label }: { status: ReferenceStatus; label: string }) {
  return <span className={`er-status er-status-${status}`}><StatusIcon state={states[status]} label={label} />{label}</span>;
}
