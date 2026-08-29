import { AppError } from './errors.ts';

const encoder = new TextEncoder();

export type PrivateIntakePayload = {
  contextScope: string;
  body: string | null;
  sourceUrl: string | null;
  provenanceRole: string | null;
};

export function privateIntakeEncryptionConfigured(
  secretValue: string | null | undefined,
) {
  return normalizeSecret(secretValue).length >= 32;
}

export async function encryptPrivateIntakePayload(
  reference: string,
  payload: PrivateIntakePayload,
  secretValue: string | null | undefined,
) {
  const secret = normalizeSecret(secretValue);
  if (secret.length < 32) {
    throw new AppError(
      503,
      'private_intake_encryption_not_configured',
      '私有线索加密密钥尚未配置，暂时不能接收载荷。',
    );
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(reference) },
    await encryptionKey(secret),
    encoder.encode(JSON.stringify(payload)),
  );
  return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptPrivateIntakePayload(
  reference: string,
  ciphertext: string,
  secretValue: string | null | undefined,
) {
  const secret = normalizeSecret(secretValue);
  if (secret.length < 32) {
    throw new AppError(
      503,
      'private_intake_key_unavailable',
      '私有线索解密密钥不可用。',
    );
  }
  const [version, encodedIv, encodedCiphertext] = ciphertext.split('.');
  if (version !== 'v1' || !encodedIv || !encodedCiphertext) {
    throw new AppError(
      500,
      'private_intake_ciphertext_invalid',
      '私有载荷格式无效。',
    );
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: fromBase64Url(encodedIv),
        additionalData: aad(reference),
      },
      await encryptionKey(secret),
      fromBase64Url(encodedCiphertext),
    );
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
    if (!isPrivateIntakePayload(parsed)) throw new Error('invalid_payload');
    return parsed;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      500,
      'private_intake_decryption_failed',
      '私有线索无法解密，请停止处置并检查密钥版本。',
    );
  }
}

function normalizeSecret(value: string | null | undefined) {
  return value?.trim() ?? '';
}

function encryptionKey(secret: string) {
  return crypto.subtle
    .digest('SHA-256', encoder.encode(secret))
    .then((digest) =>
      crypto.subtle.importKey('raw', digest, 'AES-GCM', false, [
        'encrypt',
        'decrypt',
      ]),
    );
}

function aad(reference: string) {
  return encoder.encode(`research-intake:v1:${reference}`);
}

function isPrivateIntakePayload(value: unknown): value is PrivateIntakePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.contextScope === 'string' &&
    nullableString(candidate.body) &&
    nullableString(candidate.sourceUrl) &&
    nullableString(candidate.provenanceRole)
  );
}

function nullableString(value: unknown) {
  return value === null || typeof value === 'string';
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
