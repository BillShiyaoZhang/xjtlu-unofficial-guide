import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { syncPagesSnapshot } from '../scripts/sync-pages.mjs';
import { pagesContentHash } from '../scripts/pages-snapshot.mjs';

const execute = promisify(execFile);
const snapshotFile = 'community/pages-reviewed.json';
const pagesConfig = {
  schemaVersion: 1, mode: 'public-demo', siteName: 'Synthetic reviewed guide',
  origin: 'https://example.github.io', basePath: '/synthetic-guide/', publishedRevisionIds: [], sourceRevisionIds: [],
};
const syntheticSnapshot = (title = 'Synthetic reviewed article', generatedAt = '2098-01-01T00:00:00.000Z') => {
  const answers = [{
    id: 'synthetic-answer', title, revisionId: 'synthetic-answer-v2', revisionNumber: 2,
    sentences: [{ id: 's1', kind: 'advice', text: 'A synthetic public instruction.' }], citations: [],
    scope: { campus: ['universal'] }, warnings: [], slug: 'synthetic-answer', demo: false,
    summary: 'Synthetic public summary', asOf: '2098-01-01', verifiedAt: '2098-01-01T00:00:00.000Z',
    reviewDueAt: '2098-04-01T00:00:00.000Z', reviewOwnerLabel: 'Synthetic reviewer', evidenceNote: 'Synthetic review evidence.',
    topic: null, history: [{ id: 'synthetic-answer-v2', number: 2, title }],
    origin: 'human', originalOrigin: 'human', reviewStatus: 'approved',
  }];
  const snapshot = {
    schemaVersion: 1, mode: 'public-reviewed', generatedAt,
    site: { name: pagesConfig.siteName, basePath: pagesConfig.basePath, publicUrl: pagesConfig.origin + pagesConfig.basePath },
    catalog: { topics: [], scopes: [], publishers: [] }, search: { aliases: {} }, answers,
  };
  snapshot.contentHash = pagesContentHash(snapshot);
  return snapshot;
};
async function git(root, args, { optional = false } = {}) {
  try {
    const { stdout } = await execute('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], {
      cwd: root, windowsHide: true, encoding: 'utf8', timeout: 20000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    });
    return stdout.trim();
  } catch (error) { if (optional) return null; throw error; }
}
async function writeSnapshot(root, snapshot) {
  await writeFile(join(root, snapshotFile), JSON.stringify(snapshot, null, 2) + '\n');
}
async function fixture(t, { ready = true, published } = {}) {
  const temporaryRoot = await realpath(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'guide-pages-sync-test-'));
  t.after(async () => {
    const actual = await realpath(directory);
    assert.equal(dirname(actual), temporaryRoot);
    assert.ok(relative(temporaryRoot, actual).startsWith('guide-pages-sync-test-'));
    await rm(actual, { recursive: true, force: true });
  });
  const root = join(directory, 'work'), remote = join(directory, 'remote.git');
  await mkdir(root);
  await git(directory, ['init', '--bare', '--initial-branch=main', remote]);
  await git(root, ['init', '--initial-branch=main']);
  await git(root, ['config', 'user.name', 'Synthetic Pages Operator']);
  await git(root, ['config', 'user.email', 'synthetic-pages@example.invalid']);
  await git(root, ['config', 'commit.gpgSign', 'false']);
  await mkdir(join(root, 'community'));
  await mkdir(join(root, 'scripts'));
  await writeFile(join(root, 'community/pages.config.json'), JSON.stringify(pagesConfig));
  await writeFile(join(root, 'scripts/build-pages.mjs'), ready ? "// This pipeline consumes community/pages-reviewed.json\n" : '// Previous demonstration-only pipeline\n');
  await writeFile(join(root, 'README.md'), 'Remote baseline\n');
  if (published) await writeSnapshot(root, published);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'Synthetic remote baseline']);
  const baseline = await git(root, ['rev-parse', 'HEAD']);
  await git(root, ['remote', 'add', 'origin', remote]);
  await git(root, ['push', '--set-upstream', 'origin', 'main']);
  return { directory, root, remote, baseline };
}

test('Pages synchronization commits only the public snapshot and preserves user HEAD, index, and working files', async t => {
  const f = await fixture(t);
  // A local commit ahead of origin and staged/unstaged work must never be included.
  await writeFile(join(f.root, 'local-only.txt'), 'Unrelated local commit\n');
  await git(f.root, ['add', 'local-only.txt']);
  await git(f.root, ['commit', '-m', 'Unrelated local work']);
  const head = await git(f.root, ['rev-parse', 'HEAD']);
  await writeFile(join(f.root, 'staged-only.txt'), 'Unrelated staged work\n');
  await git(f.root, ['add', 'staged-only.txt']);
  await writeFile(join(f.root, 'README.md'), 'Uncommitted user edit\n');
  await mkdir(join(f.root, 'community/.demo-runtime'));
  await writeFile(join(f.root, 'community/.demo-runtime/private-state.json'), '{"private":"synthetic only"}\n');
  const snapshot = syntheticSnapshot();
  await writeSnapshot(f.root, snapshot);
  const originalIndex = await readFile(join(f.root, '.git/index'));
  const status = await git(f.root, ['status', '--porcelain']);

  const result = await syncPagesSnapshot({ root: f.root });
  assert.equal(result.changed, true);
  assert.equal(result.parent, f.baseline);
  assert.equal(result.contentHash, snapshot.contentHash);
  assert.equal(await git(f.remote, ['rev-parse', 'refs/heads/main']), result.commit);
  assert.equal(await git(f.root, ['rev-parse', 'HEAD']), head);
  assert.deepEqual(await readFile(join(f.root, '.git/index')), originalIndex);
  assert.equal(await git(f.root, ['status', '--porcelain']), status);
  assert.equal(await readFile(join(f.root, 'README.md'), 'utf8'), 'Uncommitted user edit\n');
  assert.equal(await git(f.root, ['diff-tree', '--no-commit-id', '--name-only', '-r', f.baseline, result.commit]), snapshotFile);
  assert.deepEqual(JSON.parse(await git(f.remote, ['show', `${result.commit}:${snapshotFile}`])), snapshot);
  for (const path of ['local-only.txt', 'staged-only.txt', 'community/.demo-runtime/private-state.json']) assert.equal(await git(f.remote, ['show', `${result.commit}:${path}`], { optional: true }), null);
});

test('same content hash is a no-op even when the local export timestamp changes', async t => {
  const published = syntheticSnapshot();
  const f = await fixture(t, { published });
  await writeSnapshot(f.root, { ...published, generatedAt: '2098-02-01T00:00:00.000Z' });
  const originalIndex = await readFile(join(f.root, '.git/index'));
  const result = await syncPagesSnapshot({ root: f.root });
  assert.equal(result.changed, false);
  assert.equal(result.commit, f.baseline);
  assert.equal(await git(f.remote, ['rev-parse', 'refs/heads/main']), f.baseline);
  assert.equal(await git(f.root, ['rev-parse', 'HEAD']), f.baseline);
  assert.deepEqual(await readFile(join(f.root, '.git/index')), originalIndex);
});

test('an old remote Pages pipeline blocks synchronization before making a commit', async t => {
  const f = await fixture(t, { ready: false });
  await writeSnapshot(f.root, syntheticSnapshot());
  const originalIndex = await readFile(join(f.root, '.git/index'));
  await assert.rejects(syncPagesSnapshot({ root: f.root }), { code: 'SYNC_PIPELINE_NOT_READY' });
  assert.equal(await git(f.remote, ['rev-parse', 'refs/heads/main']), f.baseline);
  assert.deepEqual(await readFile(join(f.root, '.git/index')), originalIndex);
});

test('synchronization refuses alternate snapshot files, mismatched destinations, and missing Git identity', async t => {
  const f = await fixture(t);
  await writeSnapshot(f.root, syntheticSnapshot());
  await assert.rejects(syncPagesSnapshot({ root: f.root, snapshotPath: 'README.md' }), { code: 'SYNC_SNAPSHOT' });
  await assert.rejects(syncPagesSnapshot({ root: f.root, expectedRemote: 'https://github.com/BillShiyaoZhang/xjtlu-unofficial-guide.git' }), { code: 'SYNC_REMOTE' });
  await git(f.root, ['config', 'user.name', '']);
  await git(f.root, ['config', 'user.email', '']);
  await assert.rejects(syncPagesSnapshot({ root: f.root }), { code: 'SYNC_IDENTITY' });
  assert.equal(await git(f.remote, ['rev-parse', 'refs/heads/main']), f.baseline);
});

test('rejected pushes expose no Git stderr and leave the remote and user branch unchanged', async t => {
  const f = await fixture(t);
  await writeSnapshot(f.root, syntheticSnapshot());
  const secret = 'synthetic-credential-must-not-escape';
  await writeFile(join(f.remote, 'hooks/pre-receive'), `#!/bin/sh\nprintf '%s\\n' '${secret}' >&2\nexit 1\n`, { mode: 0o755 });
  const originalIndex = await readFile(join(f.root, '.git/index'));
  await assert.rejects(syncPagesSnapshot({ root: f.root }), error => {
    assert.equal(error.code, 'SYNC_PUSH');
    assert.equal(String(error).includes(secret), false);
    assert.equal(JSON.stringify(error).includes(secret), false);
    return true;
  });
  assert.equal(await git(f.remote, ['rev-parse', 'refs/heads/main']), f.baseline);
  assert.equal(await git(f.root, ['rev-parse', 'HEAD']), f.baseline);
  assert.deepEqual(await readFile(join(f.root, '.git/index')), originalIndex);
});

test('a recomputed hash cannot smuggle private fields through the synchronization helper', async t => {
  const f = await fixture(t);
  const snapshot = syntheticSnapshot();
  snapshot.answers[0].internalNotes = 'SYNTHETIC_PRIVATE_NOTE';
  snapshot.contentHash = pagesContentHash(snapshot);
  await writeSnapshot(f.root, snapshot);
  await assert.rejects(syncPagesSnapshot({ root: f.root }), { code: 'SYNC_SNAPSHOT' });
  assert.equal(await git(f.remote, ['rev-parse', 'refs/heads/main']), f.baseline);
});

test('an invalid remote snapshot cannot trigger a no-op by reusing the local content hash', async t => {
  const snapshot = syntheticSnapshot();
  const poisoned = { ...snapshot, privateData: 'SYNTHETIC_PRIVATE_REMOTE_VALUE' };
  const f = await fixture(t, { published: poisoned });
  await writeSnapshot(f.root, snapshot);
  await assert.rejects(syncPagesSnapshot({ root: f.root }), { code: 'SYNC_SNAPSHOT' });
  assert.equal(await git(f.remote, ['rev-parse', 'refs/heads/main']), f.baseline);
});
