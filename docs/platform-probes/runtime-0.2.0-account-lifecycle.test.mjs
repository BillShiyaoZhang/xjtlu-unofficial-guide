import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RuntimeStore,
  authenticate,
  authModule,
  bootstrapAccount,
  contentModule,
  createRuntimeApp,
  invalidateIdentityCredentials,
  lifecycleModule,
  login,
  participantsModule,
  reportsModule,
  revokeIdentitySubject,
  revokeSession,
  totpCode,
} from '@information-community/runtime';

// Characterization tests: passing confirms the current gap, not migration readiness.
// Synthetic credentials and in-memory databases only. No credential-state edits.
const now = Date.parse('2098-01-01T00:00:00Z');
const mfaKey = 'cd'.repeat(32);
const password = 'synthetic-old-password-only';
const newPassword = 'synthetic-new-password-only';
const totpSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const newTotpSecret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const account = {
  id: 'synthetic-editor', displayName: 'Synthetic Editor',
  roles: ['content_editor'], password, totpSecret,
};

function storeFor(t, extraModules = []) {
  const store = new RuntimeStore(':memory:', {
    communityId: 'account-lifecycle-probe', modules: [contentModule, authModule, ...extraModules],
  });
  t.after(() => store.close());
  return store;
}

function provision(store, input = account) {
  return bootstrapAccount(store, input, { now, mfaKey });
}

function signIn(store, time = now, input = account) {
  return login(store, {
    accountId: input.id, password: input.password,
    code: totpCode(input.totpSecret, time),
  }, { now: time, mfaKey });
}

function authenticateToken(store, token, time = now) {
  return store.transact(state => authenticate(state, token, { now: time }));
}

test('duplicate bootstrap does not rotate the same identity or revoke its sessions', t => {
  const store = storeFor(t);
  provision(store);
  const session = signIn(store);
  const before = store.read();
  assert.throws(() => provision(store, {
    ...account, password: newPassword, totpSecret: newTotpSecret,
  }), { code: 'ACCOUNT_EXISTS', status: 409 });
  assert.deepEqual(store.read(), before);
  assert.equal(authenticateToken(store, session.token, now + 1).id, account.id);
  assert.throws(() => signIn(store, now + 30_000, {
    ...account, password: newPassword, totpSecret: newTotpSecret,
  }), { code: 'INVALID_CREDENTIALS', status: 401 });
  assert.equal(signIn(store, now + 30_000).principal.id, account.id);
});

test('single-session revocation works and leaves another device active', t => {
  const store = storeFor(t);
  provision(store);
  const first = signIn(store);
  const second = signIn(store, now + 30_000);
  revokeSession(store, second.token, { sessionId: first.principal.sessionId, now: now + 30_001 });
  assert.throws(() => authenticateToken(store, first.token, now + 30_002), { code: 'UNAUTHENTICATED' });
  assert.equal(authenticateToken(store, second.token, now + 30_002).id, account.id);
  assert.ok(store.read().audit.some(entry => entry.action === 'session.revoke'));
});

test('offline subject revocation disables all target sessions but is not a same-ID reset', t => {
  const store = storeFor(t);
  provision(store);
  const first = signIn(store);
  const second = signIn(store, now + 30_000);
  store.transact(state => revokeIdentitySubject(state, account.id, { now: now + 30_001 }));
  for (const session of [first, second]) {
    assert.throws(() => authenticateToken(store, session.token, now + 30_002), { code: 'UNAUTHENTICATED' });
  }
  assert.throws(() => signIn(store, now + 60_000), { code: 'INVALID_CREDENTIALS' });
  assert.throws(() => provision(store, { ...account, password: newPassword }), { code: 'ACCOUNT_EXISTS' });
});

test('consumer module composition leaves a permanent subject tombstone and rejects rebootstrap with SUBJECT_CONFLICT', t => {
  const store = storeFor(t, [lifecycleModule, participantsModule, reportsModule]);
  provision(store);
  const first = signIn(store);
  const second = signIn(store, now + 30_000);
  const revokedAt = now + 30_001;
  store.transact(state => revokeIdentitySubject(state, account.id, { now: revokedAt }));
  const revoked = store.read();
  assert.equal(revoked.modules.auth.accounts.find(value => value.id === account.id).active, false);
  assert.deepEqual(revoked.modules.participants.subjects.find(value => value.id === account.id), {
    id: account.id, eligibility: {}, createdAt: revokedAt, revokedAt,
  });
  for (const session of [first, second]) {
    assert.throws(() => authenticateToken(store, session.token, now + 30_002), { code: 'UNAUTHENTICATED' });
  }
  assert.throws(() => provision(store, { ...account, password: newPassword }), {
    code: 'SUBJECT_CONFLICT', status: 409,
  });
  assert.deepEqual(store.read(), revoked);
  store.transact(state => revokeIdentitySubject(state, account.id, { now: now + 60_000 }));
  assert.deepEqual(store.read().modules.participants.subjects, revoked.modules.participants.subjects);
  assert.throws(() => signIn(store, now + 60_000), { code: 'INVALID_CREDENTIALS' });
});

test('offline global invalidation signs out devices without changing their account credentials', t => {
  const store = storeFor(t);
  provision(store);
  const session = signIn(store);
  store.transact(state => invalidateIdentityCredentials(state, { now: now + 1 }));
  assert.throws(() => authenticateToken(store, session.token, now + 2), { code: 'UNAUTHENTICATED' });
  assert.equal(signIn(store, now + 30_000).principal.id, account.id);
});

test('official restore invalidates old sessions but preserves old credentials and account ID', t => {
  const source = storeFor(t);
  provision(source);
  const session = signIn(source);
  const target = storeFor(t);
  target.restore(source.backup(), { now: now + 1 });
  assert.throws(() => authenticateToken(target, session.token, now + 2), { code: 'UNAUTHENTICATED' });
  assert.throws(() => provision(target, { ...account, password: newPassword }), { code: 'ACCOUNT_EXISTS' });
  assert.equal(signIn(target, now + 30_000).principal.id, account.id);
});

test('the built-in login has no recovery-code route alongside TOTP', t => {
  const store = storeFor(t);
  provision(store);
  assert.throws(() => login(store, {
    accountId: account.id, password, code: 'SYNTHETIC-RECOVERY-CODE',
  }, { now, mfaKey }), { code: 'INVALID_CREDENTIALS', status: 401 });
  assert.equal(signIn(store).principal.id, account.id);
});

test('current HTTP surface has no named-account security maintenance endpoints', async t => {
  const store = storeFor(t);
  provision(store, { ...account, roles: ['account_admin'] });
  const session = signIn(store);
  const app = createRuntimeApp({ store, auth: { mfaKey }, clock: () => now + 1 });
  await new Promise((resolve, reject) => {
    app.once('error', reject);
    app.listen(0, '127.0.0.1', resolve);
  });
  try {
    const base = `http://127.0.0.1:${app.address().port}`;
    const before = store.read();
    for (const path of [
      '/api/auth/password', '/api/auth/change-password', '/api/auth/recovery-codes',
      '/api/auth/mfa', '/api/accounts/update', '/api/accounts/reset',
    ]) {
      const response = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ currentPassword: password, newPassword, code: totpCode(totpSecret, now + 30_000) }),
      });
      assert.equal(response.status, 404, path);
      assert.equal((await response.json()).code, 'NOT_FOUND', path);
    }
    const listResponse = await fetch(`${base}/api/auth/sessions`, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    assert.equal(listResponse.status, 404);
    assert.equal((await listResponse.json()).code, 'NOT_FOUND');
    assert.deepEqual(store.read(), before);
  } finally {
    app.closeAllConnections();
    await new Promise((resolve, reject) => app.close(error => error ? reject(error) : resolve()));
  }
});
