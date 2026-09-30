import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCodexUsage } from '../src/features/chat/codexUsage.ts';

test('usage identifies reversed weekly/5h windows and prefers the Codex bucket', () => {
  const usage = normalizeCodexUsage({ rateLimits: { primary: { usedPercent: 99, windowDurationMins: 300 } }, rateLimitsByLimitId: { codex: { primary: { usedPercent: 42, windowDurationMins: 10080, resetsAt: 1800000000 }, secondary: { usedPercent: 7, windowDurationMins: 300 } } } });
  assert.equal(usage.fiveHours.usedPercent, 7);
  assert.equal(usage.weekly.usedPercent, 42);
  assert.equal(usage.weekly.resetsAt, 1800000000);
});
test('missing, unknown and malformed windows never display fake zero usage', () => {
  assert.equal(normalizeCodexUsage({}).fiveHours, null);
  assert.equal(normalizeCodexUsage({ rateLimits: { primary: { usedPercent: 20, windowDurationMins: 15 } } }).fiveHours, null);
  const usage = normalizeCodexUsage({ rateLimits: { primary: { windowDurationMins: 300, usedPercent: NaN, resetsAt: 'tomorrow' } } });
  assert.deepEqual(usage.fiveHours, { usedPercent: null, resetsAt: null });
});
test('usage clamps percentages and supports legacy snapshots including genuine zero', () => {
  assert.equal(normalizeCodexUsage({ rateLimits: { primary: { windowDurationMins: 300, usedPercent: 120 } } }).fiveHours.usedPercent, 100);
  assert.equal(normalizeCodexUsage({ rateLimits: { secondary: { windowDurationMins: 10080, usedPercent: 0 } } }).weekly.usedPercent, 0);
});
