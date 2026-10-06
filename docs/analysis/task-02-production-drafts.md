# Task 02 — Production drafts and progress integration

Changed only `src/components/production/ProductionDialog.tsx`, new `src/features/production/productionDrafts.ts`, new `tests/production-drafts.test.mjs`, and this report; preserved existing work.

## Behavior
- Uses existing profile-backed `useStudioDraftField` / `studio-drafts`; existing backup format remains unchanged.
- Start fields and selected run/flow use workspace, flow and session identities; restored topics/flows/runs must still exist in the current workspace.
- Notes, chosen platforms, video selection and format use separate workspace/run scopes; changing runs does not clear drafts.
- Video restoration requires an available source video with the same asset ID, current version and hash.
- Schedule text/date/time zone/accounts/network preferences use workspace/run/review hash/delivery versions/approved video identity.
- Removed platforms, unsupported providers, invalid dates/time zones and stale video selections are rejected or fall back safely; restored accounts require a current account query before scheduling.
- Authorization, resend consent, schedule-reviewed confirmation, TikTok media/consent confirmations, errors/loading and fetched account inventories are transient.
- Target persistence whitelists preferences and omits consent keys; imported flags cannot restore approval.
- Changes to topic/flow/destination reset start authorization; package changes remount schedule review, and account/provider/settings/time changes invalidate its confirmation.
- Clears only the corresponding start/video/platform/notes/schedule draft after successful submission; errors and unrelated actions preserve it.
- Integrated Claude-owned `ProductionProgress` with `{run,pt}`; did not edit its mapping/component/CSS.
- Added missing-prerequisite hints beside disabled start/video/schedule actions, with local field focus and a Flow link for agent configuration.

## Validation
- `npm.cmd run typecheck`: passed with the companion component present.
- `node --experimental-strip-types --test tests/production-drafts.test.mjs tests/studio-drafts.test.mjs tests/production-progress.test.mjs`: 14 passed, 0 failed.
- Isolated temporary Vite build plus regression adapted from `scripts/test-semi-production-ui.mjs`: passed with mocked AI/Notion/publication providers and synthetic local FFmpeg media.
- UI assertions covered start draft restoration without authorization, failed revision note retention, close/reopen and renderer restart, schedule restoration without confirmation, successful schedule-review enablement, and no duplicate publication after restart.
- Temporary runner/build: `C:/Users/pacas/AppData/Local/Temp/production-drafts-ui-ji9ghu5u/`; final screenshots: `artifacts/1791300250701/` (start-restored/video-review/package-review/schedule-preview/schedule-confirmed).
- Reviewed screenshots for progress, prerequisite hints and scheduling layout; no new layout overflow observed.
- Fixture retries corrected a reused seed database and click timing on disabled account selectors; final run passed. A local preview-verification contention warning remains in the fixture; no renderer errors or failed assertions.

No real AI, publication or Notion calls; no backend edits, subworkers, commits or releases. Live provider availability/account-option behavior remains outside this mocked validation.
