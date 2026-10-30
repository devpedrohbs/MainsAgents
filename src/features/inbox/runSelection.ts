import { updatePersistentValue } from '../../data/localPersistence';

export const runsSelectedKey = (workspaceId: string) => `runs-selected:${workspaceId}`;
/** Points the Runs page at one run; the page reads the same key, so the choice survives navigation. */
export function selectRun(workspaceId: string, runId: string) {
  updatePersistentValue<string>(runsSelectedKey(workspaceId), '', runId);
}
