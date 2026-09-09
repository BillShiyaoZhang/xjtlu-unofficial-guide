import { once } from 'node:events';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

if (!process.env.PLATFORM_ROOT) throw new Error('Set PLATFORM_ROOT to the upstream checkout.');
const runtime = await import(pathToFileURL(resolve(
  process.env.PLATFORM_ROOT, 'packages/runtime/index.mjs',
)).href);
const store = new runtime.RuntimeStore(':memory:', {
  communityId: 'participant-access-probe', modules: [runtime.contentModule, runtime.lifecycleModule],
});
const now = Date.parse('2026-09-09T10:00:00Z');
const participant = { id: 'synthetic-participant', roles: ['participant'], mfa: false };
const options = {
  now,
  keyring: { activeVersion: 'v1', keys: { v1: '22'.repeat(32) } },
  config: { workflows: {
    privacy_report: {
      states: ['received', 'closed'], initialState: 'received',
      transitions: { received: ['closed'], closed: [] }, terminalStates: ['closed'],
      decisionCodes: ['reviewed'], publicResults: {}, retentionMs: 86400000, requireConsent: false,
    },
  } },
};
const policy = { participant: ['lifecycle:self'] };

// This fixture models an already verified invitation session, not a real enrollment provider.
const provider = {
  authenticate(_state, token) {
    if (token === 'synthetic-invitation-session') return participant;
    if (token === 'synthetic-mfa-owner-session') return { ...participant, mfa: true };
    throw new runtime.RuntimeError('UNAUTHENTICATED', 'Synthetic session required', 401);
  },
};
const server = runtime.createRuntimeApp({
  store, auth: { provider, rolePermissions: policy }, lifecycle: options, clock: () => now,
});
try {
  store.transact(state => runtime.lifecycleCommand(state, participant, {
    action: 'create', id: 'synthetic-record', type: 'privacy_report', payload: { category: 'synthetic' },
  }, options));
  let sdkOwnerRead;
  try {
    store.transact(state => runtime.lifecycleDetail(state, participant, 'synthetic-record', { ...options, policy }));
    sdkOwnerRead = 'accepted';
  } catch (error) { sdkOwnerRead = error.code; }

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, token, body) {
    const response = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json', 'idempotency-key': 'synthetic-command-key' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  }
  console.log(JSON.stringify({
    probe: 'participant-access',
    sdkOwnerRead,
    invitationParticipantCreate: await request('/api/private/command', 'synthetic-invitation-session', {
      action: 'create', type: 'privacy_report', payload: { category: 'synthetic' },
    }),
    anonymousPrivacyReport: await request('/api/private/command', null, {
      action: 'create', type: 'privacy_report', payload: { category: 'synthetic' },
    }),
    mfaOwnerList: await request('/api/private/list', 'synthetic-mfa-owner-session'),
  }, null, 2));
} finally {
  if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  store.close();
}
