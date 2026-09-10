import assert from 'node:assert/strict';
import test from 'node:test';
import { request as httpRequest } from 'node:http';
import { bootstrapAccount, importContent, maintainAccountOffline, totpCode } from '@information-community/runtime';
import { guideIdentityProvider, loopbackLoginRequest } from '../server/local-password.mjs';
import { harness, mfaKey, readJson } from './helpers.mjs';

const accountId = 'synthetic-local-reviewer';
const password = 'synthetic-local-password-only-login';
const totpSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

function rawRequest(url, { host, input } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, {
      method: input ? 'POST' : 'GET', headers: { host, ...(input ? { 'content-type': 'application/json' } : {}) },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, json: async () => JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end(input ? JSON.stringify(input) : undefined);
  });
}

async function setup(t, { localPasswordOnly = true, roles = ['content_reviewer'] } = {}) {
  const h = await harness(t, { guide: true, localPasswordOnly });
  h.store.transact(state => { state.modules.content = importContent(state.modules.content, h.bundle); });
  bootstrapAccount(h.store, { id: accountId, displayName: 'Synthetic Local Reviewer', roles, password, totpSecret }, { now: h.time(), mfaKey });
  const signIn = (input = { accountId, password }) => h.post('/api/auth/login', input, undefined, null);
  return { ...h, signIn };
}

test('explicit local mode accepts password-only login and accurately labels the session without exposing credentials', async t => {
  const h = await setup(t);
  assert.deepEqual(await readJson(await h.get('/api/guide/login-config')), { passwordOnly: true });
  const result = await readJson(await h.signIn());
  assert.equal(result.principal.id, accountId);
  assert.equal(result.principal.mfa, false);
  assert.equal(result.principal.assurance, 'local-password');
  const session = h.store.read().modules.auth.sessions.find(row => row.id === result.principal.sessionId);
  assert.equal(session.authMethod, 'local-password');
  assert.equal(session.issuedAt, h.time());
  assert.equal(session.expiresAt, h.time() + 8 * 60 * 60_000);
  const identity = await readJson(await h.get('/api/auth/me', result.token));
  assert.equal(identity.mfa, false);
  assert.equal(identity.assurance, 'local-password');
  const articles = await readJson(await h.get('/api/guide/review-articles', result.token));
  assert.ok(articles.articles.length > 0);
  const serialized = JSON.stringify({ result, identity });
  for (const secret of [password, totpSecret, 'passwordHash', 'passwordSalt']) assert.equal(serialized.includes(secret), false);
});

test('password-only sessions keep configured role restrictions', async t => {
  const h = await setup(t, { roles: ['pilot_operator'] });
  const result = await readJson(await h.signIn());
  const denied = await readJson(await h.get('/api/guide/review-articles', result.token), 403);
  assert.equal(denied.code, 'FORBIDDEN');
});

test('SDK password failures and eight-attempt account lockout remain enforced', async t => {
  const h = await setup(t);
  for (let attempt = 0; attempt < 8; attempt++) {
    const result = await readJson(await h.signIn({ accountId, password: 'synthetic-incorrect-password' }), 401);
    assert.equal(result.code, 'INVALID_CREDENTIALS');
  }
  let state = h.store.read();
  assert.equal(state.modules.auth.accounts[0].lastTotpCounter, -1, 'failed passwords never consume or reset the account TOTP counter');
  assert.equal(state.modules.auth.sessions.length, 0);
  assert.equal(state.modules.auth.failures.global.count, 8);
  const denied = await readJson(await h.signIn(), 429);
  assert.equal(denied.code, 'RATE_LIMITED');
  h.setTime(h.time() + 15 * 60_000 + 1);
  const result = await readJson(await h.signIn());
  assert.ok(result.token);
  state = h.store.read();
  assert.equal(state.modules.auth.sessions.length, 1);
});

test('local logins consume only SDK-accepted counters without falsifying timestamps or resetting replay protection', async t => {
  const h = await setup(t);
  const now = h.time(), counter = Math.floor(now / 30_000);
  const counters = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await readJson(await h.signIn());
    const state = h.store.read();
    counters.push(state.modules.auth.accounts[0].lastTotpCounter);
    const session = state.modules.auth.sessions.find(row => row.id === result.principal.sessionId);
    assert.equal(session.issuedAt, now);
    assert.equal(session.expiresAt, now + 8 * 60 * 60_000);
  }
  assert.deepEqual(counters, [counter - 1, counter, counter + 1]);
  assert.ok(h.store.read().audit.filter(row => row.action === 'session.login').every(row => row.at === now));
  const before = h.store.read();
  const limited = await readJson(await h.signIn(), 429);
  assert.equal(limited.code, 'LOCAL_LOGIN_WAIT');
  assert.deepEqual(h.store.read(), before);
  h.setTime(now + 30_000);
  const renewed = await readJson(await h.signIn());
  const state = h.store.read();
  assert.equal(state.modules.auth.accounts[0].lastTotpCounter, counter + 2);
  assert.equal(state.modules.auth.sessions.find(row => row.id === renewed.principal.sessionId).issuedAt, h.time());
});

test('logout, expired sessions and disabled accounts stay unavailable in local mode', async t => {
  for (const action of ['logout', 'expire', 'disable']) {
    await t.test(action, async t => {
      const h = await setup(t);
      const result = await readJson(await h.signIn());
      if (action === 'logout') await readJson(await h.post('/api/auth/logout', {}, result.token));
      if (action === 'expire') h.setTime(h.time() + 8 * 60 * 60_000 + 1);
      if (action === 'disable') {
        maintainAccountOffline(h.store, { action: 'status', accountId, expectedVersion: 0, active: false }, {
          operatorId: 'synthetic-offline-maintainer', now: h.time(), mfaKey,
        });
        await readJson(await h.signIn(), 401);
      }
      await readJson(await h.get('/api/guide/review-articles', result.token), 401);
    });
  }
});

test('ordinary mode continues to require MFA and rejects a local-password session from the same database', async t => {
  const ordinary = await setup(t, { localPasswordOnly: false });
  assert.deepEqual(await readJson(await ordinary.get('/api/guide/login-config')), { passwordOnly: false });
  await readJson(await ordinary.signIn(), 401);
  const mfa = await readJson(await ordinary.signIn({ accountId, password, code: totpCode(totpSecret, ordinary.time()) }));
  assert.equal(mfa.principal.mfa, true);
  await readJson(await ordinary.get('/api/guide/review-articles', mfa.token));

  const local = await setup(t);
  const result = await readJson(await local.signIn());
  const state = local.store.read();
  assert.throws(() => guideIdentityProvider(undefined, false).authenticate(state, result.token, { now: local.time() }), { code: 'UNAUTHENTICATED' });
  const accepted = guideIdentityProvider(undefined, true).authenticate(local.store.read(), result.token, { now: local.time() });
  assert.equal(accepted.id, accountId);
});

test('password-only login requires both a loopback socket and an exact loopback Host', async t => {
  const request = (remoteAddress, host) => ({ socket: { remoteAddress }, headers: { host } });
  for (const [remoteAddress, host] of [
    ['127.0.0.1', '127.0.0.1:4317'], ['::1', '[::1]:4317'], ['::ffff:127.0.0.1', 'localhost:4317'],
  ]) assert.equal(loopbackLoginRequest(request(remoteAddress, host)), true);
  for (const [remoteAddress, host] of [
    ['192.168.1.1', 'localhost:4317'], ['::ffff:192.168.1.1', '127.0.0.1:4317'],
    ['127.0.0.1', 'attacker.example'], ['127.0.0.1', 'localhost.attacker.example:4317'],
    ['127.0.0.1', 'localhost@attacker.example'], ['127.0.0.1', '127.0.0.1:4317@attacker.example'],
    ['127.0.0.1', 'localhost:4317/path'], ['127.0.0.1', 'localhost:4317?x'], ['127.0.0.1', 'localhost:4317#x'],
    ['127.0.0.1', '127.1:4317'], ['127.0.0.1', '2130706433:4317'], ['127.0.0.1', '0x7f000001:4317'],
    ['127.0.0.1', undefined], [undefined, 'localhost:4317'],
  ]) assert.equal(loopbackLoginRequest(request(remoteAddress, host)), false);
  for (const header of ['forwarded', 'x-forwarded-for', 'x-forwarded-host']) {
    const forwarded = request('127.0.0.1', 'localhost:4317');
    forwarded.headers[header] = 'attacker.example';
    assert.equal(loopbackLoginRequest(forwarded), false);
  }
  const h = await setup(t);
  const config = await readJson(await rawRequest(`${h.base}/api/guide/login-config`, { host: 'attacker.example' }));
  assert.equal(config.passwordOnly, false);
  const response = await rawRequest(`${h.base}/api/auth/login`, { host: 'attacker.example', input: { accountId, password } });
  assert.ok([401, 403].includes(response.status));
  assert.equal(h.store.read().modules.auth.sessions.length, 0);
});
