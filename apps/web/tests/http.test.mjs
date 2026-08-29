import assert from 'node:assert/strict';
import test from 'node:test';

import { assertSameOrigin, readJsonBody } from '../lib/http.ts';
import { isTrustedIdentityBoundary } from '../lib/auth-boundary.ts';

function jsonRequest(body) {
  return new Request('https://guide.example/v1/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

test('JSON request bodies must be objects', async () => {
  assert.deepEqual(await readJsonBody(jsonRequest('{"ok":true}')), {
    ok: true,
  });
  await assert.rejects(
    () => readJsonBody(jsonRequest('null')),
    (error) => error.status === 400 && error.code === 'invalid_payload',
  );
  await assert.rejects(
    () => readJsonBody(jsonRequest('[]')),
    (error) => error.status === 400 && error.code === 'invalid_payload',
  );
  await assert.rejects(
    () => readJsonBody(jsonRequest('{')),
    (error) => error.status === 400 && error.code === 'invalid_json',
  );
});

test('JSON request bodies enforce content type and byte limits', async () => {
  await assert.rejects(
    () =>
      readJsonBody(
        new Request('https://guide.example/v1/test', {
          method: 'POST',
          body: '{}',
        }),
      ),
    (error) => error.status === 415 && error.code === 'json_required',
  );
  await assert.rejects(
    () => readJsonBody(jsonRequest('{"text":"1234567890"}'), 8),
    (error) => error.status === 413 && error.code === 'payload_too_large',
  );
});

test('state-changing requests require an exact same-site origin', () => {
  assert.doesNotThrow(() =>
    assertSameOrigin(
      new Request('https://guide.example/v1/test', {
        method: 'POST',
        headers: {
          origin: 'https://guide.example',
          'sec-fetch-site': 'same-origin',
        },
      }),
    ),
  );
  for (const headers of [
    {},
    { origin: 'null' },
    { origin: 'https://attacker.example' },
    {
      origin: 'https://guide.example',
      'sec-fetch-site': 'cross-site',
    },
  ]) {
    assert.throws(
      () =>
        assertSameOrigin(
          new Request('https://guide.example/v1/test', {
            method: 'POST',
            headers,
          }),
        ),
      (error) => error.status === 403,
    );
  }
});

test('editor identity headers are denied outside a trusted boundary', async () => {
  assert.equal(
    await isTrustedIdentityBoundary({
      nodeEnv: 'production',
      host: 'guide.example',
      configuredSecret: '',
      presentedSecret: '',
    }),
    false,
  );
  assert.equal(
    await isTrustedIdentityBoundary({
      nodeEnv: 'development',
      host: 'localhost:3000',
      configuredSecret: '',
      presentedSecret: '',
    }),
    true,
  );
  assert.equal(
    await isTrustedIdentityBoundary({
      nodeEnv: 'development',
      host: '192.0.2.10:3000',
      configuredSecret: '',
      presentedSecret: '',
    }),
    false,
  );
  const configuredSecret = 'a-trusted-proxy-secret-that-is-long-enough';
  assert.equal(
    await isTrustedIdentityBoundary({
      nodeEnv: 'production',
      host: 'guide.example',
      configuredSecret,
      presentedSecret: 'forged',
    }),
    false,
  );
  assert.equal(
    await isTrustedIdentityBoundary({
      nodeEnv: 'production',
      host: 'guide.example',
      configuredSecret,
      presentedSecret: configuredSecret,
    }),
    true,
  );
});
