import assert from 'node:assert/strict';
import test from 'node:test';
import { editorRoleSuggestion, productionRuntimeFor, providerStatus } from '../production-runtime.mjs';
import { productionPreflight } from '../production-preflight.mjs';

const chat = { send: async () => ({ executionId: 'e' }), events: async function* () {}, cancel: async () => {}, openEditorSession: (options) => ({ sessionId: 's', options }), editorCheckpoint: () => ({}), closeEditorSession: () => {} };

test('the Claude production runtime exposes editor sessions only when the chat runtime offers them', () => {
  const runtime = productionRuntimeFor('claude', { getChatRuntime: () => chat });
  assert.equal(runtime.capabilities.editorTools, true);
  assert.equal(runtime.openEditorSession({ binding: 1 }).sessionId, 's');
  const textOnly = productionRuntimeFor('claude', { getChatRuntime: () => ({ ...chat, openEditorSession: undefined }) });
  assert.equal(textOnly.capabilities.editorTools, false);
  assert.equal(textOnly.openEditorSession, undefined);
  assert.equal(productionRuntimeFor('claude', { getChatRuntime: () => null }), null, 'unavailable is explicit, never another provider');
  assert.equal(providerStatus('claude', { runtime: chat, status: { state: 'connected' } }).editorTools, true);
  assert.equal(providerStatus('claude', { runtime: null, status: { state: 'not-installed' } }).editorTools, false);
});

test('editor suggestion never switches providers or agents silently', () => {
  const agents = [{ id: 'codex-editor', workspaceId: 'w', providerId: 'codex' }, { id: 'claude-editor', workspaceId: 'w', providerId: 'claude' }, { id: 'other', workspaceId: 'x', providerId: 'claude' }];
  assert.deepEqual(editorRoleSuggestion({ agents, workspaceId: 'w', currentEditorId: 'codex-editor', claudeStatus: { state: 'connected' } }), { status: 'suggest', agentId: 'claude-editor', replaces: 'codex-editor' });
  assert.deepEqual(editorRoleSuggestion({ agents, workspaceId: 'w', currentEditorId: 'claude-editor', claudeStatus: { state: 'login-required' } }), { status: 'provider-unavailable', agentId: 'claude-editor', providerId: 'claude', state: 'login-required' });
  assert.deepEqual(editorRoleSuggestion({ agents, workspaceId: 'w', currentEditorId: 'codex-editor', claudeStatus: { state: 'not-installed' } }), { status: 'none' });
  assert.deepEqual(editorRoleSuggestion({ agents: agents.slice(0, 1), workspaceId: 'w', currentEditorId: 'codex-editor', claudeStatus: { state: 'connected' } }), { status: 'none' });
});

test('preflight reports the Claude editor tools, their limits and keeps legacy fingerprints', () => {
  const flow = { id: 'f', workspaceId: 'w', nodes: [{ kind: 'content-agent', agentId: 'src' }, { kind: 'video-agent', agentId: 'ed' }] };
  const agents = [{ id: 'src', name: 'Content', workspaceId: 'w', providerId: 'codex' }, { id: 'ed', name: 'Editor', workspaceId: 'w', providerId: 'claude' }];
  const base = { workspaceId: 'w', flow, agents, topic: { id: 't', workspaceId: 'w', status: 'approved', title: 'T' }, runtime: { connected: true } };
  const claude = (editorTools) => ({ claude: { available: true, auth: 'connected', imageGeneration: false, reconcile: false, editorTools } });
  const ok = productionPreflight({ ...base, providers: claude(true) }).checks.find((check) => check.id === 'editor-tools');
  assert.equal(ok.level, 'ok');
  assert.match(ok.message, /frames reais/);
  assert.match(ok.message, /sem terminal/);
  assert.equal(productionPreflight({ ...base, providers: claude(false) }).checks.find((check) => check.id === 'editor-tools').level, 'warning');
  assert.equal(productionPreflight({ ...base }).checks.find((check) => check.id === 'editor-tools').level, 'unverified');
  assert.equal(productionPreflight({ ...base, providers: claude(true), editorLimits: { maxRevisions: 9 } }).checks.find((check) => check.id === 'editor-limits').level, 'blocker');
  assert.match(productionPreflight({ ...base, providers: claude(true), editorLimits: { maxRevisions: 1 } }, { locale: 'en-US' }).checks.find((check) => check.id === 'editor-tools').message, /Up to 1 correction/);
  // A Codex editor has no editor-tools check, and runs without editorLimits keep their fingerprint.
  const codexAgents = agents.map((agent) => agent.id === 'ed' ? { ...agent, providerId: 'codex' } : agent);
  assert.equal(productionPreflight({ ...base, agents: codexAgents }).checks.some((check) => check.id === 'editor-tools'), false);
  assert.equal(productionPreflight({ ...base, providers: claude(true) }).fingerprint, productionPreflight({ ...base, providers: claude(false) }).fingerprint);
  assert.notEqual(productionPreflight({ ...base, providers: claude(true) }).fingerprint, productionPreflight({ ...base, providers: claude(true), editorLimits: { maxRevisions: 1 } }).fingerprint);
  // A missing Claude runtime still blocks: no stage runs on another provider.
  const missing = productionPreflight({ ...base, providers: { claude: { available: false, auth: 'not-installed', imageGeneration: false, reconcile: false } } });
  assert.equal(missing.checks.find((check) => check.id === 'runtime-claude').level, 'blocker');
});
