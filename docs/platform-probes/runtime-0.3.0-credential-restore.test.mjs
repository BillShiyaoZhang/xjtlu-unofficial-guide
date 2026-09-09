import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RuntimeStore, authModule, contentModule, lifecycleModule, participantsModule,
  reportsModule, bootstrapAccount, inspectAccountsOffline, maintainAccountOffline,
  login, totpCode, authenticate, revokeIdentitySubject,
} from '@information-community/runtime';

// All credentials and backups are synthetic; every database stays in memory.
const now = Date.parse('2098-09-09T12:00:00Z');
const mfaKey = '24'.repeat(32), operatorId = 'synthetic-restore-operator';
const account = {
  id: 'synthetic-reviewer', displayName: 'Synthetic reviewer', roles: ['content_reviewer'],
  password: 'synthetic-original-password', totpSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
};
const rotated = { password: 'synthetic-rotated-password', totpSecret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' };
const reenrolled = { password: 'synthetic-restored-password', totpSecret: 'KRUGS4ZANFZSAYJAORSXG5BANFXGOIDB' };
const options = { now, mfaKey, operatorId };
const review = { now: now + 60_000, revokedSubjectIds: [], withdrawnSubjectIds: [] };
const modules = [contentModule, authModule, lifecycleModule, participantsModule, reportsModule];

function empty(t, selected = modules) {
  const store = new RuntimeStore(':memory:', { communityId: 'credential-restore-probe', modules: selected });
  t.after(() => store.close());
  return store;
}
function source(t, selected = modules) {
  const store = empty(t, selected);
  bootstrapAccount(store, account, options);
  return store;
}
function signIn(store, credentials = account, at = now) {
  return login(store, { accountId: account.id, password: credentials.password, code: totpCode(credentials.totpSecret, at) }, { mfaKey, now: at });
}
function current(store) { return inspectAccountsOffline(store, { operatorId }).find(value => value.id === account.id); }
function maintain(store, action, values = {}, at = now) {
  return maintainAccountOffline(store, { action, accountId: account.id, expectedVersion: current(store).version, ...values }, { ...options, now: at });
}

test('an older backup cannot resurrect replaced credentials or sessions; full re-enrollment retains the actor ID', t => {
  const original = source(t), oldSession = signIn(original), backup = original.backup();
  const before = structuredClone(backup);
  maintain(original, 'credentials', rotated, now + 30_000);
  const rotatedSession = signIn(original, rotated, now + 30_000);
  const restored = empty(t), result = restored.restore(backup, review);
  assert.equal(result.accountsRequiringCredentials, 1);
  assert.equal(result.sessionsInvalidated, true);
  assert.deepEqual(backup, before);
  const state = restored.read(), restoredAccount = state.modules.auth.accounts[0];
  assert.equal(restoredAccount.id, account.id);
  assert.equal(restoredAccount.credentialsRequired, true);
  for (const field of ['passwordHash', 'passwordSalt', 'mfa']) assert.equal(restoredAccount[field], null);
  assert.deepEqual(state.modules.auth.sessions, []);
  assert.deepEqual(state.idempotency, {});
  assert.deepEqual(state.audit.slice(0, backup.state.audit.length), backup.state.audit);
  for (const session of [oldSession, rotatedSession]) {
    assert.throws(() => restored.transact(value => authenticate(value, session.token, { now: review.now })), { code: 'UNAUTHENTICATED' });
  }
  for (const credentials of [account, rotated]) assert.throws(() => signIn(restored, credentials, review.now), { code: 'INVALID_CREDENTIALS' });
  maintain(restored, 'credentials', reenrolled, review.now);
  assert.equal(signIn(restored, reenrolled, review.now).principal.id, account.id);
  assert.equal(current(restored).credentialsRequired, false);
  const audit = JSON.stringify(restored.read().audit);
  for (const credentials of [account, rotated, reenrolled]) {
    assert.equal(audit.includes(credentials.password), false);
    assert.equal(audit.includes(credentials.totpSecret), false);
  }
});

test('restored accounts reject incomplete re-enrollment atomically', t => {
  const original = source(t), restored = empty(t);
  restored.restore(original.backup(), review);
  for (const values of [{ password: reenrolled.password }, { totpSecret: reenrolled.totpSecret }]) {
    const before = restored.read();
    assert.throws(() => maintain(restored, 'credentials', values, review.now), { code: 'ACCOUNT_CREDENTIALS_REQUIRED' });
    assert.deepEqual(restored.read(), before);
  }
});

test('restoring named accounts requires a current explicit revocation review and rejects malformed registers without writes', t => {
  const original = source(t), backup = original.backup(), restored = empty(t);
  for (const [input, code] of [
    [{ now, withdrawnSubjectIds: [] }, 'ACCOUNT_RECONCILIATION_REQUIRED'],
    [{ ...review, revokedSubjectIds: ['invalid subject'] }, 'INVALID_REVOCATION_REGISTER'],
    [{ ...review, withdrawnSubjectIds: ['invalid subject'] }, 'INVALID_WITHDRAWAL_REGISTER'],
  ]) {
    const before = restored.read();
    assert.throws(() => restored.restore(backup, input), { code });
    assert.deepEqual(restored.read(), before);
  }
});

test('current revocations and withdrawals block restored accounts and IDs absent from the backup', t => {
  const original = source(t), backup = original.backup();
  for (const register of ['revokedSubjectIds', 'withdrawnSubjectIds']) {
    const restored = empty(t), result = restored.restore(backup, { ...review, [register]: [account.id, 'synthetic-post-backup-subject'] });
    assert.equal(result.accountsRequiringCredentials, 0);
    assert.equal(current(restored).active, false);
    assert.notEqual(current(restored).revokedAt, null);
    for (const [action, values] of [['status', { active: true }], ['credentials', reenrolled]]) {
      const before = restored.read();
      assert.throws(() => maintain(restored, action, values, review.now), { code: 'ACCOUNT_REVOKED' });
      assert.deepEqual(restored.read(), before);
    }
    assert.throws(() => bootstrapAccount(restored, { ...account, id: 'synthetic-post-backup-subject' }, options), { code: 'ACCOUNT_REVOKED' });
  }
});

test('backup permanent revocations survive an empty current register, while ordinary suspension stays recoverable', t => {
  const revokedSource = source(t);
  revokedSource.transact(state => revokeIdentitySubject(state, account.id, { now }));
  const permanentlyRevoked = empty(t);
  assert.equal(permanentlyRevoked.restore(revokedSource.backup(), review).accountsRequiringCredentials, 0);
  assert.throws(() => maintain(permanentlyRevoked, 'status', { active: true }), { code: 'ACCOUNT_REVOKED' });

  const suspendedSource = source(t);
  maintain(suspendedSource, 'status', { active: false });
  const suspended = empty(t);
  assert.equal(suspended.restore(suspendedSource.backup(), review).accountsRequiringCredentials, 1);
  assert.equal(current(suspended).active, false);
  assert.equal(current(suspended).revokedAt, null);
  maintain(suspended, 'credentials', reenrolled, review.now);
  assert.throws(() => signIn(suspended, reenrolled, review.now), { code: 'INVALID_CREDENTIALS' });
  maintain(suspended, 'status', { active: true }, review.now);
  assert.equal(signIn(suspended, reenrolled, review.now).principal.id, account.id);
});

test('schema 1 backups migrate through the same credential-stripping restore policy without changing the source artifact', t => {
  const original = source(t), backup = original.backup();
  backup.state.moduleVersions.auth = 1;
  delete backup.state.modules.auth.revokedSubjectIds;
  for (const value of backup.state.modules.auth.accounts) {
    delete value.version;
    delete value.credentialsRequired;
    delete value.revokedAt;
  }
  const before = structuredClone(backup), restored = empty(t);
  assert.equal(restored.restore(backup, review).accountsRequiringCredentials, 1);
  assert.equal(restored.read().moduleVersions.auth, 2);
  assert.equal(current(restored).credentialsRequired, true);
  assert.equal(restored.read().modules.auth.accounts[0].passwordHash, null);
  assert.deepEqual(backup, before);
});

test('a later restore hook failure rolls back credential stripping and the entire destination restore', t => {
  const failureModule = { name: 'synthetic-failure', schemaVersion: 1, initialState: () => ({}), validate() {}, prepareRestore() { throw new Error('synthetic restore failure'); } };
  const selected = [...modules, failureModule], original = source(t, selected), backup = original.backup();
  const beforeBackup = structuredClone(backup), restored = empty(t, selected), before = restored.read();
  assert.throws(() => restored.restore(backup, review), /synthetic restore failure/);
  assert.deepEqual(restored.read(), before);
  assert.deepEqual(backup, beforeBackup);
});
