/**
 * Radar editorial — contract between the backend (radar-*.mjs, owned by Claude) and the UI (src/, desktop-main, preload; owned by Codex).
 * Change this file only after both sides agree. All routes live under the existing `/api/content/*` bridge and take
 * `?profile=<id>&workspaceId=<id>` like the editing-references routes. Errors: `{error, code}` with an HTTP status.
 *
 * Collection is deterministic (no AI). Numbers are what a source returned at `collectedAt`; an unavailable counter is `null`,
 * never 0. Nothing is interpolated: a day without a collection is a gap, recorded as such.
 */

export type RadarKind = 'youtube' | 'news';
export type SourceStatus = 'ok' | 'partial' | 'needs_reauth' | 'limit_reached' | 'error' | 'idle';
export type RunStatus = 'running' | 'succeeded' | 'partial' | 'failed' | 'interrupted';
export type RunReason = 'manual' | 'schedule' | 'catch-up';

/** One configured input. `youtube-channel` is a followed channel; `youtube-search` a discovery topic (needs the API key). */
export type RadarSourceInput =
  | { kind: 'youtube-channel'; channelId: string; label?: string }   // channelId = "UC..." (24 chars)
  | { kind: 'youtube-search'; query: string; regionCode?: string }  // query <= 120 chars, regionCode ISO 3166-1 alpha-2
  | { kind: 'news-rss'; url: string; label?: string }               // https feed URL (RSS 2.0 or Atom)
  | { kind: 'hackernews'; minScore?: number };                       // top stories, default minScore 100

/** Daily AI synthesis after the scheduled collection; uses a saved agent of the workspace (its Claude Code or Codex login). */
export interface RadarSynthesisConfig { enabled: boolean; agentId: string | null }

export interface RadarConfig {
  /** Daily schedule in the computer's local time. */
  schedule: { enabled: boolean; time: string /* "HH:MM" */ };
  synthesis: RadarSynthesisConfig;
  sources: Array<RadarSourceInput & { id: string; enabled: boolean }>;
}
/** PUT /radar/config body. Sources without `id` are created; omitted ids are removed (their history is kept). */
export interface RadarConfigInput {
  schedule: { enabled: boolean; time: string };
  synthesis?: RadarSynthesisConfig;   // omitted = keep the saved one (default disabled)
  sources: Array<RadarSourceInput & { id?: string; enabled: boolean }>;
}

export interface RadarSource {
  id: string;
  kind: RadarSourceInput['kind'];
  label: string;
  enabled: boolean;
  status: SourceStatus;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  errorCode: string | null;      // e.g. 'missing_api_key', 'quota_exceeded', 'http_404', 'network', 'parse'
  errorMessage: string | null;   // pt-BR, user-facing
  retryAt: string | null;        // for limit_reached: when the source will be tried again (never earlier)
}

export interface RadarRun {
  id: string;
  dayKey: string;                // local date "YYYY-MM-DD"; at most one scheduled/catch-up run per day
  reason: RunReason;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  sources: Array<{ sourceId: string; status: SourceStatus; items: number; errorCode: string | null }>;
  /** Days between the previous successful run and this one with no collection (recorded, never back-filled). */
  gapDays: string[];
}

export interface RadarSnapshotRow {
  id: string;
  itemId: string;
  runId: string;
  collectedAt: string;           // UTC ISO
  views: number | null;
  likes: number | null;
  comments: number | null;
  score: number | null;          // news only (HN points)
  source: 'youtube-api' | 'youtube-rss' | 'hackernews' | 'rss';
}

export type Maturity = 'mature' | 'immature';  // mature = published >= 7 days before the collection
export type BaselineStatus = 'ok' | 'insufficient' | 'not_applicable';

export interface VideoMetrics {
  latest: RadarSnapshotRow | null;
  /** Median views of the channel's mature videos in the latest collection (log-scale comparison), excluding this video. */
  baselineCount: number;
  baselineMedian: number | null; // null when baselineCount < 10 or the median is 0
  baselineStatus: BaselineStatus;
  ratio: number | null;          // views / baselineMedian
  logScore: number | null;       // log10(views+1) - log10(baselineMedian+1)
  maturity: Maturity;
  format: 'short' | 'video' | 'live' | 'unknown'; // short = duration <= 180 s (hypothesis-grade, labelled as such)
  growth: { viewsPerHour: number; fromSnapshotId: string; toSnapshotId: string; hours: number } | null;
  limitations: string[];         // pt-BR lines, always shown next to the numbers
}

export interface RadarItem {
  id: string;
  kind: RadarKind;
  platform: 'youtube' | 'web';
  externalId: string;            // YouTube video id, or a hash of the canonical article URL
  url: string;
  title: string;
  author: string | null;         // channel title or site/host
  channelId: string | null;
  publishedAt: string | null;
  durationSeconds: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  sourceIds: string[];
  metrics: VideoMetrics | null;  // null for news
  highlight: boolean;            // youtube: baselineStatus ok && ratio >= 3; news: score >= source minScore
  promoted: Array<{ target: 'topic' | 'reference'; id: string; at: string }>; // links recorded via POST .../promote
}

/**
 * Evidence is built by the backend from stored snapshots; the AI only writes observation / hypothesis / idea and may only
 * cite items it was given (unknown itemIds are dropped). The AI sees titles and numbers, never the video itself.
 */
export interface RadarRecommendation {
  itemId: string;
  evidence: Array<{ snapshotIds: string[]; url: string; observedAt: string; numbers: Record<string, number | null> }>;
  observation: string;                                 // what the data/title shows (no visual claims)
  hypothesis: { text: string; alternatives: string[] }; // why it may have worked + competing explanations
  idea: string;                                        // how Pedro could adapt it into his own content (a pauta seed)
  limitations: string[];
}
export interface RadarSynthesis {
  id: string | null;
  status: 'none' | 'waiting_limit' | 'blocked' | 'running' | 'ready' | 'failed' | 'interrupted';
  providerId: 'claude' | 'codex' | null;
  agentId: string | null;
  dayKey: string | null;
  createdAt: string | null;
  finishedAt: string | null;
  /** waiting_limit: known reset time, or null when unknown (then it waits for the provider Resume in the app). */
  waitingUntil: string | null;
  /** pt-BR: why it waits / is blocked / failed (e.g. usage at 92% of the 5 h window, login expired, no agent chosen). */
  message: string | null;
  recommendations: RadarRecommendation[];
}

/** GET /api/content/radar?profile&workspaceId[&kind=youtube|news][&highlight=1][&cursor=][&limit=50] */
export interface RadarSnapshot {
  schemaVersion: 1;
  profile: string;
  workspaceId: string;
  config: RadarConfig;
  credentials: { youtubeApiKey: boolean; secureStorage: boolean };
  sources: RadarSource[];
  items: RadarItem[];            // newest first by lastSeenAt, highlights first when `highlight=1`
  nextCursor: string | null;
  runs: RadarRun[];              // latest 20
  running: RadarRun | null;
  nextRunAt: string | null;      // null when the schedule is disabled
  synthesis: RadarSynthesis;      // latest synthesis of this scope
  agents: Array<{ id: string; name: string; providerId: 'claude' | 'codex' }>; // saved agents of the workspace
}

/**
 * Routes (all under /api/content, all scoped by profile + workspaceId):
 *   GET  /radar                              -> RadarSnapshot
 *   PUT  /radar/config     RadarConfigInput  -> RadarSnapshot
 *   POST /radar/collect    {kind?: RadarKind} -> {runId, status: 'running'}   (409 {code:'already_running', runId} when busy)
 *   GET  /radar/items/:id/history            -> {item: RadarItem, snapshots: RadarSnapshotRow[]}
 *   POST /radar/synthesize {}                -> 202 {synthesisId, status:'running'|'waiting_limit'|'blocked'} (a gate records its row and sends nothing) | 409 {code:'already_running'|'waiting_limit'|'no_agent'|'nothing_to_synthesize'}
 *   POST /radar/items/:id/promote {target:'topic'|'reference', targetId} -> {item: RadarItem, created: boolean}
 *        The renderer creates the topic (ContentWorkflowProvider.createTopic) or the link reference (saveInspiration) through
 *        the editorial state client first, then records the link here; recording the same target twice returns created:false.
 *        The UI checks item.promoted before creating, so a second click never creates a second topic.
 *
 * Retention: snapshots/baselines from the YouTube Data API are deleted after 30 days (YouTube API Services policy on
 * stored API data); RSS/Hacker News rows are kept up to 365 days. Backups include config, items, snapshots, runs,
 * syntheses and links, never the API key (encrypted per computer).
 *
 * Backend object exposed by createContentWorkflowBridge(...) as `radar`:
 *   snapshot(scope, query), configure(scope, input), collect(scope, {kind, reason}), history(scope, itemId),
 *   refreshDue({reason: 'startup' | 'resume' | 'tick'}) — call from desktop-main on app ready and powerMonitor 'resume';
 *   credentials: { status(profile), save(profile, key), remove(profile) } — for the IPC radar:key:status|save|remove;
 *   close().
 * The key never goes back to the renderer; status only says whether it is configured.
 */
