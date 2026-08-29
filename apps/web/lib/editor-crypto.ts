const PASSWORD_ITERATIONS = 600_000;
const encoder = new TextEncoder();

export { PASSWORD_ITERATIONS };

export function normalizeEditorEmail(value: string) {
  return value.trim().toLocaleLowerCase('en-US').slice(0, 254);
}

export async function createPasswordCredential(
  password: string,
  pepper: string,
) {
  validatePassword(password);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {
    salt: toBase64Url(salt),
    hash: await derivePasswordHash(password, pepper, salt, PASSWORD_ITERATIONS),
    iterations: PASSWORD_ITERATIONS,
  };
}

export async function verifyPassword(
  password: string,
  pepper: string,
  credential: { salt: string; hash: string; iterations: number },
) {
  if (
    credential.iterations < PASSWORD_ITERATIONS ||
    credential.iterations > 2_000_000
  ) {
    return false;
  }
  let salt: Uint8Array;
  try {
    salt = fromBase64Url(credential.salt);
  } catch {
    return false;
  }
  const actual = await derivePasswordHash(
    password,
    pepper,
    salt,
    credential.iterations,
  );
  return secretsMatch(credential.hash, actual);
}

export function validatePassword(password: string) {
  if (password.length < 14 || password.length > 200) {
    throw new Error('password_length');
  }
}

async function derivePasswordHash(
  password: string,
  pepper: string,
  salt: Uint8Array,
  iterations: number,
) {
  const pepperKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const prehash = await crypto.subtle.sign(
    'HMAC',
    pepperKey,
    encoder.encode(password),
  );
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    prehash,
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: salt as BufferSource,
      iterations,
    },
    passwordKey,
    256,
  );
  return toBase64Url(new Uint8Array(bits));
}

export function generateTotpSecret() {
  return toBase32(crypto.getRandomValues(new Uint8Array(20)));
}

export function buildTotpUri(input: {
  email: string;
  secret: string;
  issuer?: string;
}) {
  const issuer = input.issuer?.trim() || 'XJTLU Unofficial Guide';
  const label = `${issuer}:${input.email}`;
  const params = new URLSearchParams({
    secret: input.secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

export async function findValidTotpCounter(input: {
  secret: string;
  code: string;
  now?: number;
  lastUsedCounter?: number | null;
}) {
  if (!/^\d{6}$/u.test(input.code)) return null;
  const currentCounter = Math.floor((input.now ?? Date.now()) / 30_000);
  for (const offset of [-1, 0, 1]) {
    const counter = currentCounter + offset;
    if (
      counter <= (input.lastUsedCounter ?? -1) ||
      !(await secretsMatch(await totpAt(input.secret, counter), input.code))
    ) {
      continue;
    }
    return counter;
  }
  return null;
}

async function totpAt(secret: string, counter: number) {
  let keyBytes: Uint8Array;
  try {
    keyBytes = fromBase32(secret);
  } catch {
    return '';
  }
  const counterBytes = new Uint8Array(8);
  new DataView(counterBytes.buffer).setUint32(4, counter, false);
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes as BufferSource,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, counterBytes),
  );
  const offset = signature.at(-1)! & 0x0f;
  const binary =
    ((signature[offset] & 0x7f) << 24) |
    ((signature[offset + 1] & 0xff) << 16) |
    ((signature[offset + 2] & 0xff) << 8) |
    (signature[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

export async function encryptTotpSecret(input: {
  secret: string;
  encryptionKey: string;
  accountId: string;
  factorId: string;
}) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(input.encryptionKey);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: totpAad(input.accountId, input.factorId),
    },
    key,
    encoder.encode(input.secret),
  );
  return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptTotpSecret(input: {
  encryptedSecret: string;
  encryptionKey: string;
  accountId: string;
  factorId: string;
}) {
  const [version, encodedIv, encodedCiphertext] =
    input.encryptedSecret.split('.');
  if (version !== 'v1' || !encodedIv || !encodedCiphertext) {
    throw new Error('invalid_totp_ciphertext');
  }
  const key = await aesKey(input.encryptionKey);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromBase64Url(encodedIv),
      additionalData: totpAad(input.accountId, input.factorId),
    },
    key,
    fromBase64Url(encodedCiphertext),
  );
  return new TextDecoder().decode(plaintext);
}

export async function sha256Hex(value: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', encoder.encode(value)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function randomToken(bytes = 32) {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const raw = toBase32(crypto.getRandomValues(new Uint8Array(16)));
    return raw.match(/.{1,4}/gu)?.join('-') ?? raw;
  });
}

export async function secretsMatch(expected: string, actual: string) {
  const [expectedDigest, actualDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
    crypto.subtle.digest('SHA-256', encoder.encode(actual)),
  ]);
  let difference = 0;
  const expectedBytes = new Uint8Array(expectedDigest);
  const actualBytes = new Uint8Array(actualDigest);
  for (let index = 0; index < expectedBytes.length; index += 1) {
    difference |= expectedBytes[index] ^ actualBytes[index];
  }
  return difference === 0;
}

function aesKey(value: string) {
  return crypto.subtle
    .digest('SHA-256', encoder.encode(value))
    .then((digest) =>
      crypto.subtle.importKey('raw', digest, 'AES-GCM', false, [
        'encrypt',
        'decrypt',
      ]),
    );
}

function totpAad(accountId: string, factorId: string) {
  return encoder.encode(`editor-totp:v1:${accountId}:${factorId}`);
}

function toBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

function fromBase64Url(value: string) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(`${normalized}${padding}`);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toBase32(bytes: Uint8Array) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function fromBase32(value: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalized = value.toUpperCase().replace(/[\s=-]/gu, '');
  if (!normalized || /[^A-Z2-7]/u.test(normalized)) {
    throw new Error('invalid_base32');
  }
  let bits = 0;
  let accumulator = 0;
  const output: number[] = [];
  for (const character of normalized) {
    accumulator = (accumulator << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      output.push((accumulator >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(output);
}
