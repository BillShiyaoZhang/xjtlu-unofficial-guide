import { createDecipheriv } from 'node:crypto';
import { RuntimeError, login, totpCode, localIdentityProvider, appendAudit } from '@information-community/runtime';

const deny = () => { throw new RuntimeError('UNAUTHENTICATED', '需要重新登录。', 401); };
export function loopbackLoginRequest(request) {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket?.remoteAddress)) return false;
  if (['forwarded', 'x-forwarded-for', 'x-forwarded-host'].some(name => request.headers[name])) return false;
  if (!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::[0-9]{1,5})?$/u.test(request.headers.host ?? '')) return false;
  try {
    const url = new URL(`http://${request.headers.host}`);
    return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
  } catch { return false; }
}

// Runtime 0.3.0 exposes TOTP generation but no password-only login hook. This
// explicitly local adapter supplies that factor on the server; it is NOT MFA.
// Password checks, throttling, sessions and revocation still belong to the SDK.
function accountSecret(account, mfaKey) {
  const key = Buffer.isBuffer(mfaKey) ? mfaKey : Buffer.from(mfaKey, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(account.mfa.iv, 'hex'));
  decipher.setAAD(Buffer.from(`runtime-totp:${account.id}`));
  decipher.setAuthTag(Buffer.from(account.mfa.tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(account.mfa.data, 'hex')), decipher.final()]).toString('utf8');
}

export function localPasswordLogin(store, input, { mfaKey, now = Date.now() } = {}) {
  const account = store.read().modules.auth.accounts.find(row => row.id === input.accountId);
  let code = '000000';
  if (account?.active && !account.credentialsRequired && account.revokedAt === null) {
    const current = Math.floor(now / 30000);
    const counter = Math.max(account.lastTotpCounter + 1, current - 1);
    if (counter > current + 1) throw new RuntimeError('LOCAL_LOGIN_WAIT', '刚刚已多次登录，请等待 30 秒后再试。', 429);
    code = totpCode(accountSecret(account, mfaKey), counter * 30000);
  }
  const scopedStore = {
    transact(callback) {
      return store.transact(state => {
        const result = callback(state);
        if (result.token) {
          const session = state.modules.auth.sessions.find(row => row.id === result.principal.sessionId);
          session.authMethod = 'local-password';
          appendAudit(state, result.principal, 'session.login.local-password', { targetId: session.id }, now);
          result.principal = { ...result.principal, mfa: false, assurance: 'local-password' };
        }
        return result;
      });
    },
  };
  return login(scopedStore, { accountId: input.accountId, password: input.password, code }, { mfaKey, now });
}

export function guideIdentityProvider(provider, allowLocalPassword = false) {
  const original = provider ?? localIdentityProvider;
  return {
    ...original,
    authenticate(state, token, options) {
      const principal = original.authenticate(state, token, options);
      const session = state.modules.auth.sessions.find(row => row.id === principal?.sessionId);
      if (session?.authMethod === 'local-password') {
        if (!allowLocalPassword) deny();
        // The SDK permission contract retains its internal capability marker;
        // the actual login method is explicit and cannot leave this local mode.
        return { ...principal, assurance: 'local-password' };
      }
      return principal;
    },
  };
}
