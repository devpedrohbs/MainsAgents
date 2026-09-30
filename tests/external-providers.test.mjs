import test from 'node:test';
import assert from 'node:assert/strict';
import { geminiThinkingConfig } from '../external-providers.mjs';

test('Gemini effort maps to each model family native control', () => {
  assert.deepEqual(geminiThinkingConfig('gemini-3.8-flash', 'low'), { thinkingLevel: 'low' });
  assert.deepEqual(geminiThinkingConfig('gemini-3.1-pro-preview', 'xhigh'), { thinkingLevel: 'high' });
  assert.deepEqual(geminiThinkingConfig('gemini-2.5-flash', 'medium'), { thinkingBudget: 8192 });
  assert.deepEqual(geminiThinkingConfig('gemini-2.5-pro', 'xhigh'), { thinkingBudget: 24576 });
  assert.equal(geminiThinkingConfig('gemini-2.0-flash', 'high'), undefined);
});
