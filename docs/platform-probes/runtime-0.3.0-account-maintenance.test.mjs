import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RuntimeStore,
  authenticate,
  authModule,
  bootstrapAccount,
  contentModule,
  executeAuthorized,
  importContent,
  inspectAccountsOffline,
  lifecycleCommand,
  lifecycleModule,
  login,
  maintainAccountOffline,
  participantsModule,
  reportsModule,
  revokeIdentitySubject,
  totpCode,
} from '@information-community/runtime';

// Fixed-package acceptance probes. All databases and credentials are synthetic.
const now = Date.parse('2098-01-01T00:00:00Z');
const mfaKey = 'cd'.repeat(32);
const operatorId = 'reviewed-offline-operator';
const password = 'synthetic-original-password-only';
const newPassword = 'synthetic-replacement-password-only';
const totpSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const newTotpSecret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const accountId = 'synthetic-editor';
const privateConfig = { workflows: { report: {
  initialState: 'submitted', states: ['submitted', 'resolved'],
  transitions: { submitted: ['resolved'], resolved: [] }, terminalStates: ['resolved'],
  decisionCodes: ['corrected'], publicResults: { corrected: { code: 'corrected', label: 'Corrected.' } },
  retentionMs: 86_400_000, requireConsent: false, eligibilityFields: [],
} } };
const keyring = { activeVersion: 'probe', keys: { probe: 'ef'.repeat(32) } };

function fixture(t, extra = []) {
  const store = new RuntimeStore(':memory:', {
    communityId: 'account-maintenance-consumer-probe',
    modules: [contentModule, authModule, lifecycleModule, participantsModule, reportsModule, ...extra],
  });
  t.after(() => store.close());
  for (const id of [accountId, 'synthetic-other']) bootstrapAccount(store, {
    id, displayName: id, roles: ['content_reviewer', 'pilot_operator'], password, totpSecret,
  }, { now, mfaKey });
  return store;
}

function signIn(store, time = now, overrides = {}) {
  const input = { accountId, password, totpSecret, ...overrides };
  return login(store, {
    accountId: input.accountId, password: input.password, code: totpCode(input.totpSecret, time),
  }, { now: time, mfaKey });
}

function inspect(store, id = accountId) {
  return inspectAccountsOffline(store, { operatorId }).find(account => account.id === id);
}

function maintain(store, input, options = {}) {
  return maintainAccountOffline(store, {
    accountId, expectedVersion: inspect(store).version, ...input,
  }, { now, operatorId, mfaKey, ...options });
}

function authenticateToken(store, token, time = now) {
  return store.transact(state => authenticate(state, token, { now: time }));
}

test('full credential replacement preserves content and private ownership and revokes only target devices', t => {
  const store = fixture(t), first = signIn(store), second = signIn(store, now + 30_000);
  const other = signIn(store, now, { accountId: 'synthetic-other' });
  store.transact(state => {
    state.modules.content = importContent(state.modules.content, {
      schemaVersion: 1,
      entities: [{ id: 'synthetic-answer', type: 'document' }],
      revisions: [{ id: 'synthetic-revision', entityId: 'synthetic-answer', number: 1,
        parentRevisionId: null, createdAt: new Date(now).toISOString(), data: {
          title: 'Synthetic answer', origin: 'human', impact: 'low',
          sentences: [{ id: 'synthetic-opinion', kind: 'opinion', text: 'A synthetic opinion.' }],
        } }], citations: [], links: [],
    });
    lifecycleCommand(state, first.principal, {
      action: 'create', type: 'report', id: 'synthetic-private-record',
      payload: { note: 'Synthetic private case.' }, consentEpoch: 0,
    }, { config: privateConfig, keyring, now });
  });
  for (const [session, marker] of [[first, 'target'], [other, 'other']]) {
    executeAuthorized(store, session.token, {
      action: 'synthetic.operation', permission: 'content:read', now: now + 30_000,
      key: `synthetic-retry-${marker}`, input: { marker },
    }, () => ({ id: `synthetic-${marker}` }));
  }
  const before = store.read();
  const result = maintain(store, { action: 'credentials', password: newPassword, totpSecret: newTotpSecret });
  assert.equal(result.id, accountId);
  assert.equal(result.version, 1);
  const after = store.read();
  for (const name of ['content', 'lifecycle', 'participants', 'reports']) {
    assert.deepEqual(after.modules[name], before.modules[name]);
  }
  assert.equal(after.modules.lifecycle.records['synthetic-private-record'].subjectId, accountId);
  assert.deepEqual(after.audit.slice(0, before.audit.length), before.audit);
  assert.equal(after.audit.at(-1).actorId, operatorId);
  assert.equal(after.audit.at(-1).targetId, accountId);
  assert.equal(after.audit.at(-1).action, 'account.credentials');
  assert.equal(Object.values(after.idempotency).some(entry => entry.subjectId === accountId), false);
  assert.deepEqual(after.idempotency, Object.fromEntries(Object.entries(before.idempotency).filter(([, entry]) => entry.subjectId !== accountId)));
  for (const session of [first, second]) assert.throws(() => authenticateToken(store, session.token, now + 30_000), { code: 'UNAUTHENTICATED' });
  assert.equal(authenticateToken(store, other.token, now + 30_000).id, 'synthetic-other');
  for (const input of [{}, { password: newPassword }, { totpSecret: newTotpSecret }]) {
    assert.throws(() => signIn(store, now + 60_000, input), { code: 'INVALID_CREDENTIALS' });
  }
  assert.equal(signIn(store, now + 60_000, { password: newPassword, totpSecret: newTotpSecret }).principal.id, accountId);
  for (const secret of [password, newPassword, totpSecret, newTotpSecret]) {
    assert.ok(!JSON.stringify(after).includes(secret));
    assert.ok(!JSON.stringify(result).includes(secret));
  }
  assert.deepEqual(Object.keys(result).sort(), ['active', 'credentialsRequired', 'displayName', 'id', 'revokedAt', 'roles', 'version']);
});

test('password-only maintenance needs no MFA key and cannot replay an already used TOTP', t => {
  const store = fixture(t), old = signIn(store), before = store.read().modules.auth.accounts[0];
  maintain(store, { action: 'credentials', password: newPassword }, { mfaKey: undefined });
  const after = store.read().modules.auth.accounts[0];
  assert.deepEqual(after.mfa, before.mfa);
  assert.equal(after.lastTotpCounter, before.lastTotpCounter);
  assert.throws(() => authenticateToken(store, old.token), { code: 'UNAUTHENTICATED' });
  assert.throws(() => signIn(store, now, { password: newPassword }), { code: 'INVALID_CREDENTIALS' });
  assert.throws(() => signIn(store, now + 30_000), { code: 'INVALID_CREDENTIALS' });
  assert.equal(signIn(store, now + 30_000, { password: newPassword }).principal.id, accountId);
});

test('audited lost-device MFA recovery preserves password and equivalent keys do not reset replay protection', t => {
  const store = fixture(t), old = signIn(store), before = store.read().modules.auth.accounts[0];
  const alias = `${totpSecret}AAAAAAAA`;
  assert.equal(totpCode(alias, now), totpCode(totpSecret, now));
  maintain(store, { action: 'credentials', totpSecret: alias });
  assert.throws(() => signIn(store, now, { totpSecret: alias }), { code: 'INVALID_CREDENTIALS' });
  maintain(store, { action: 'credentials', totpSecret: newTotpSecret });
  assert.equal(store.read().modules.auth.accounts[0].passwordHash, before.passwordHash);
  assert.throws(() => authenticateToken(store, old.token), { code: 'UNAUTHENTICATED' });
  assert.throws(() => signIn(store), { code: 'INVALID_CREDENTIALS' });
  assert.equal(signIn(store, now, { totpSecret: newTotpSecret }).principal.id, accountId);
});

test('missing offline authority, malformed inputs and stale competing writes preserve the entire state', t => {
  const store = fixture(t), session = signIn(store);
  const base = { action: 'credentials', accountId, expectedVersion: 0, password: newPassword };
  for (const [input, options, code] of [
    [base, { principal: session.principal, mfaKey }, 'OFFLINE_OPERATOR_REQUIRED'],
    [{ ...base, roles: ['account_admin'] }, { operatorId, mfaKey }, 'INVALID_ACCOUNT_MAINTENANCE'],
    [{ ...base, totpSecret: newTotpSecret }, { operatorId, mfaKey: 'bad-key' }, 'MFA_KEY_REQUIRED'],
  ]) {
    const before = store.read();
    assert.throws(() => maintainAccountOffline(store, input, { now, ...options }), { code });
    assert.deepEqual(store.read(), before);
  }
  const firstOperatorView = inspect(store), secondOperatorView = inspect(store);
  maintain(store, { action: 'roles', expectedVersion: firstOperatorView.version, roles: ['content_editor'] });
  const updated = store.read();
  for (const input of [base, { action: 'status', accountId, expectedVersion: secondOperatorView.version, active: false }]) {
    assert.throws(() => maintainAccountOffline(store, input, { now, operatorId, mfaKey }), { code: 'ACCOUNT_VERSION_CONFLICT', status: 409 });
    assert.deepEqual(store.read(), updated);
  }
});

test('a failed commit rolls back credentials, sessions, version, retry records and audit together', t => {
  let rejectCommit = false;
  const gate = { name: 'probe-gate', schemaVersion: 1, initialState: () => ({}), validate: () => {
    if (rejectCommit) throw new Error('Synthetic commit rejection');
  } };
  const store = fixture(t, [gate]), session = signIn(store);
  executeAuthorized(store, session.token, {
    action: 'synthetic.operation', permission: 'content:read', now,
    key: 'synthetic-rollback-retry', input: {},
  }, () => ({ id: 'synthetic-retry' }));
  const before = store.read();
  rejectCommit = true;
  assert.throws(() => maintain(store, { action: 'credentials', password: newPassword, totpSecret: newTotpSecret }), /Synthetic commit rejection/);
  assert.deepEqual(store.read(), before);
  rejectCommit = false;
  assert.equal(authenticateToken(store, session.token).id, accountId);
  assert.equal(signIn(store, now + 30_000).principal.id, accountId);
});

test('roles and reversible suspension revoke sessions without granting permanent-withdrawal reactivation', t => {
  const store = fixture(t), original = signIn(store);
  maintain(store, { action: 'roles', roles: ['content_editor'] });
  assert.throws(() => authenticateToken(store, original.token), { code: 'UNAUTHENTICATED' });
  const downgraded = signIn(store, now + 30_000);
  assert.deepEqual(downgraded.principal.roles, ['content_editor']);
  assert.throws(() => executeAuthorized(store, downgraded.token, {
    action: 'content.publish', permission: 'content:publish', now: now + 30_000,
  }, () => ({ ok: true })), { code: 'FORBIDDEN' });
  maintain(store, { action: 'status', active: false });
  assert.equal(inspect(store).revokedAt, null);
  assert.throws(() => authenticateToken(store, downgraded.token, now + 30_000), { code: 'UNAUTHENTICATED' });
  assert.throws(() => signIn(store, now + 60_000), { code: 'INVALID_CREDENTIALS' });
  maintain(store, { action: 'status', active: true });
  const resumed = signIn(store, now + 60_000);
  maintain(store, { action: 'revoke-sessions' });
  assert.throws(() => authenticateToken(store, resumed.token, now + 60_000), { code: 'UNAUTHENTICATED' });
  assert.equal(signIn(store, now + 90_000).principal.id, accountId);
  store.transact(state => revokeIdentitySubject(state, accountId, { now: now + 90_001 }));
  const revoked = store.read();
  assert.equal(inspect(store).revokedAt, now + 90_001);
  assert.equal(revoked.modules.participants.subjects.find(subject => subject.id === accountId).revokedAt, now + 90_001);
  for (const input of [
    { action: 'status', active: true }, { action: 'roles', roles: ['content_reviewer'] },
    { action: 'credentials', password: newPassword, totpSecret: newTotpSecret },
  ]) {
    assert.throws(() => maintain(store, input), { code: 'ACCOUNT_REVOKED' });
    assert.deepEqual(store.read(), revoked);
  }
});
