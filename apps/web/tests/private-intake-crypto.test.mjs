import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decryptPrivateIntakePayload,
  encryptPrivateIntakePayload,
  privateIntakeEncryptionConfigured,
} from '../lib/private-intake-crypto.ts';

const secret = 'private-intake-test-key-with-32-characters-minimum';
const payload = {
  contextScope: '苏州校区 · 本科生',
  body: '一条只允许编辑查看的线索。',
  sourceUrl: 'https://example.edu/policy',
  provenanceRole: '在校生',
};

test('private intake payload encrypts and decrypts only in its original context', async () => {
  assert.equal(privateIntakeEncryptionConfigured(secret), true);
  assert.equal(privateIntakeEncryptionConfigured('too-short'), false);

  const ciphertext = await encryptPrivateIntakePayload(
    'RI-TEST0001',
    payload,
    secret,
  );

  assert.match(ciphertext, /^v1\./u);
  assert.equal(ciphertext.includes(payload.body), false);
  assert.deepEqual(
    await decryptPrivateIntakePayload('RI-TEST0001', ciphertext, secret),
    payload,
  );

  await assert.rejects(
    decryptPrivateIntakePayload('RI-DIFFERENT', ciphertext, secret),
    (error) => error?.code === 'private_intake_decryption_failed',
  );
  await assert.rejects(
    decryptPrivateIntakePayload('RI-TEST0001', ciphertext, `${secret}-wrong`),
    (error) => error?.code === 'private_intake_decryption_failed',
  );
});
