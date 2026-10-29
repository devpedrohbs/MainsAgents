import test from 'node:test';
import assert from 'node:assert/strict';
import { dateText, dayText, historyRows, numberText, safeItemUrl, sourceInput, sourceLabel, statusText, validateConfig, videoFacts, visibleItems } from '../src/features/radar/model.ts';
import { radarRoute } from '../src/features/radar/api.ts';

const metrics = {
  latest: { views: null, collectedAt: '2026-10-28T10:00:00Z' }, baselineCount: 3, baselineMedian: null,
  baselineStatus: 'insufficient', ratio: 99, maturity: 'immature', format: 'short', growth: null,
  limitations: ['Contadores indisponíveis via RSS.', 'Base com menos de 10 vídeos maduros.'],
};
const video = { id: 'v', kind: 'youtube', highlight: false, metrics };
const draft = (kind, value, extra = {}) => ({ kind, value, label: '', regionCode: '', ...extra });

test('missing counters remain unavailable; a genuine zero is retained in both locales', () => {
  for (const pt of [true, false]) {
    assert.equal(numberText(null, pt), pt ? 'indisponível' : 'unavailable');
    assert.equal(numberText(undefined, pt), pt ? 'indisponível' : 'unavailable');
    assert.equal(numberText(NaN, pt), pt ? 'indisponível' : 'unavailable');
    assert.equal(numberText(0, pt), '0');
    const facts = videoFacts(video, pt);
    assert.equal(facts.views, pt ? 'indisponível' : 'unavailable');
    assert.equal(facts.growth, pt ? 'indisponível' : 'unavailable');
    assert.deepEqual(facts.limitations, metrics.limitations, 'backend limitations are presented without rewriting');
    assert.match(facts.format, pt ? /hipótese/ : /hypothesis/);
    assert.doesNotMatch(facts.ratio, /99/);
  }
  assert.equal(videoFacts(video, true).ratio, 'base insuficiente');
  assert.equal(videoFacts(video, false).ratio, 'insufficient baseline');
  assert.equal(videoFacts({ ...video, metrics: null }, true).baseline, 'indisponível');
});

test('only a valid baseline exposes its reported ratio and growth uses the actual observed interval', () => {
  const item = { ...video, metrics: { ...metrics, baselineStatus: 'ok', baselineCount: 12, baselineMedian: 1000, ratio: 3.25, latest: { ...metrics.latest, views: 3250 }, growth: { viewsPerHour: 0, hours: 48 } } };
  const pt = videoFacts(item, true);
  assert.equal(pt.views, '3.250');
  assert.equal(pt.ratio, '3,25× a mediana do canal');
  assert.match(pt.baseline, /^12 vídeos; mediana 1\.000$/);
  assert.equal(pt.growth, '0 views/h em 48 h');
  assert.equal(videoFacts({ ...item, metrics: { ...item.metrics, baselineStatus: 'not_applicable' } }, false).ratio, 'unavailable');
  assert.equal(videoFacts({ ...item, metrics: { ...item.metrics, ratio: null } }, true).ratio, 'indisponível');
});

test('filters use the backend highlight flag and never invent highlights from incomplete metrics', () => {
  const items = [video, { ...video, id: 'highlight', highlight: true }, { id: 'news', kind: 'news', highlight: true }];
  assert.deepEqual(visibleItems(items, 'youtube', true).map(i => i.id), ['highlight']);
  assert.equal(visibleItems(items, 'youtube', false).length, 2);
  assert.deepEqual(visibleItems(items, 'news', true).map(i => i.id), ['news']);
});

test('history preserves measured rows, nulls and exact run gapDays without inventing days or interpolating', () => {
  const snapshots = [{ id: 'old', runId: 'r1', collectedAt: '2026-10-25T10:00:00Z', views: 10 }, { id: 'new', runId: 'r2', collectedAt: '2026-10-28T10:00:00Z', views: null }];
  const runs = [{ id: 'r2', gapDays: ['2026-10-26', '2026-10-27'] }];
  const rows = historyRows(snapshots, runs);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].snapshot.views, null);
  assert.deepEqual(rows[0].gapDays, runs[0].gapDays);
  assert.deepEqual(rows[1].gapDays, []);
  assert.equal(snapshots[0].id, 'old', 'input order is not mutated');
  assert.equal(dayText('2026-10-26', true), '26/10/2026');
  assert.equal(dateText(null, false), 'unavailable');
  assert.equal(dateText('bad date', true), 'indisponível');
});

test('source creation validates each contract input and preserves optional fields', () => {
  const channelId = 'UCabcdefghijklmnopqrstuv';
  assert.deepEqual(sourceInput(draft('youtube-channel', ` ${channelId} `, { label: ' Canal ' }), true), { kind: 'youtube-channel', channelId, label: 'Canal' });
  assert.throws(() => sourceInput(draft('youtube-channel', '@handle'), true), /channelId/);
  assert.deepEqual(sourceInput(draft('youtube-search', ' cache ', { regionCode: 'br' }), false), { kind: 'youtube-search', query: 'cache', regionCode: 'BR' });
  for (const value of ['', 'x'.repeat(121)]) assert.throws(() => sourceInput(draft('youtube-search', value), false));
  assert.throws(() => sourceInput(draft('youtube-search', 'cache', { regionCode: 'BRA' }), true));
  assert.deepEqual(sourceInput(draft('news-rss', 'https://example.com/rss'), true), { kind: 'news-rss', url: 'https://example.com/rss' });
  for (const value of ['http://example.com/rss', 'javascript:alert(1)', 'https://user:secret@example.com/rss']) assert.throws(() => sourceInput(draft('news-rss', value), true));
  assert.deepEqual(sourceInput(draft('hackernews', ''), true), { kind: 'hackernews', minScore: 100 });
  assert.equal(sourceInput(draft('hackernews', '1'), true).minScore, 1);
  for (const value of ['0', '-1', '5001', '1.2', 'NaN']) assert.throws(() => sourceInput(draft('hackernews', value), false));
  assert.match(sourceLabel({ kind: 'hackernews', minScore: 0 }, true), /0/);
});

test('schedule accepts local HH:MM only; source and run status labels cover the contract in both languages', () => {
  for (const time of ['00:00', '09:15', '23:59']) assert.equal(validateConfig({ schedule: { enabled: true, time }, sources: [] }, true).schedule.time, time);
  for (const time of ['24:00', '7:00', '12:60', '']) assert.throws(() => validateConfig({ schedule: { enabled: false, time }, sources: [] }, false));
  assert.equal(statusText('needs_reauth', true), 'Precisa reautenticar');
  assert.equal(statusText('limit_reached', false), 'Limit reached');
  assert.equal(statusText('interrupted', true), 'Interrompida');
  for (const status of ['ok', 'partial', 'needs_reauth', 'limit_reached', 'error', 'idle', 'running', 'succeeded', 'failed', 'interrupted']) for (const pt of [true, false]) assert.ok(statusText(status, pt));
});

test('API routes encode item IDs and scope, and external links reject executable schemes', () => {
  const scope = { profile: 'a&b', workspaceId: 'space/one' };
  const url = new URL(radarRoute(scope, '/collect', { profile: 'other', highlight: '1' }), 'http://localhost');
  assert.equal(url.pathname, '/api/content/radar/collect');
  assert.equal(url.searchParams.get('profile'), scope.profile);
  assert.equal(url.searchParams.get('workspaceId'), scope.workspaceId);
  assert.equal(url.searchParams.get('highlight'), '1');
  assert.equal(safeItemUrl('javascript:alert(1)'), undefined);
  assert.equal(safeItemUrl('file:///tmp/private'), undefined);
  assert.equal(safeItemUrl('https://example.com/story'), 'https://example.com/story');
});
