import assert from 'node:assert/strict';
import test from 'node:test';

import { readJsonBody } from '../lib/http.ts';

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
