import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

function observe(name) {
  const file = fileURLToPath(new URL(name, import.meta.url));
  return JSON.parse(execFileSync(process.execPath, [file], {
    encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
  }));
}

test('link-only expiry uses the supported nested field and suppresses reads at the deadline', () => {
  const result = observe('runtime-0.1.0-link-expiry.mjs');
  assert.equal(result.mappedRightsObject.imported, true);
  assert.deepEqual(result.mappedRightsObject.before, {
    listCount: 1, revisionVisible: true, exportedRevisionCount: 1,
  });
  assert.deepEqual(result.mappedRightsObject.atExpiry, {
    listCount: 0, revisionVisible: false, exportedRevisionCount: 0,
  });
  assert.equal(result.mappedRightsExpiresAt.code, 'EVIDENCE_MODE');
  assert.equal(result.expiryOmitted.atExpiry.revisionVisible, true);
});

test('private import rejects unconfigured results while configured results remain visible', () => {
  const result = observe('runtime-0.1.0-private-import.mjs');
  assert.equal(result.normalTransition, 'INVALID_DECISION');
  assert.equal(result.snapshotImport, 'INVALID_PUBLIC_RESULT');
  assert.equal(result.unexpectedPublicResult, false);
  assert.deepEqual(result.results, []);
  assert.equal(result.configuredResults.length, 1);
  assert.deepEqual(result.configuredResults[0].result, {
    code: 'corrected', label: 'Reviewed correction',
  });
});
