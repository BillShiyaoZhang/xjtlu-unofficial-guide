import { execFile } from 'node:child_process';
import { lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateReviewedPagesData } from './pages-snapshot.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const snapshotFile = 'community/pages-reviewed.json';
const githubRepository = 'https://github.com/BillShiyaoZhang/xjtlu-unofficial-guide.git';
const messages = {
  SYNC_ARGUMENTS: '仅支持 --demo 或 --production，默认使用本地演示运行库。',
  SYNC_REPOSITORY: '请从指南仓库根目录同步，并检查 Git 是否可用。',
  SYNC_SNAPSHOT: '公开快照必须是 community/pages-reviewed.json 中有效的公开审定快照，请先重新导出并构建。',
  SYNC_REMOTE: '同步目标配置不匹配。请将 origin 的读取和推送地址设为本项目的 GitHub HTTPS 地址。',
  SYNC_FETCH: '无法读取远端分支。请检查网络、Git 登录权限和远端 main 分支后重试。',
  SYNC_PIPELINE_NOT_READY: '远端尚未安装审定快照的 Pages 构建流程。请先合并部署流程代码，再同步公开内容。',
  SYNC_IDENTITY: 'Git 提交身份尚未配置，请在此仓库配置 user.name 和 user.email 后重试。',
  SYNC_COMMIT: '未能生成公开快照提交；本地分支和暂存区没有被提交。',
  SYNC_PUSH: '推送未完成或未确认。请检查网络、权限或远端更新后重新同步；不会强制覆盖远端提交。',
  SYNC_FAILED: '公开快照导出、验证或同步未完成，请检查本地运行配置后重试。',
};
function failure(code) {
  return Object.assign(new Error(messages[code] ?? messages.SYNC_FAILED), { code, guidePagesSync: true });
}

function gitEnvironment(index) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
  // Repository/index overrides inherited from a caller must not redirect this operation.
  for (const name of ['GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE']) delete env[name];
  if (index) env.GIT_INDEX_FILE = index;
  return env;
}

function git(root, args, { input, index, code = 'SYNC_REPOSITORY', allowFailure = false } = {}) {
  return new Promise((accept, reject) => {
    const child = execFile('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, '-c', 'user.useConfigOnly=true', ...args], {
      cwd: root, env: gitEnvironment(index), encoding: 'utf8', windowsHide: true,
      timeout: 90000, maxBuffer: 16 * 1024 * 1024,
    }, (error, stdout) => {
      // Git stderr can contain credential-bearing URLs. Never return or print it.
      if (error) return allowFailure ? accept(null) : reject(failure(code));
      accept(stdout);
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
  });
}

function publicSnapshot(bytes, config) {
  try { return validateReviewedPagesData(JSON.parse(bytes.toString('utf8')), { config }); }
  catch { throw failure('SYNC_SNAPSHOT'); }
}

function canonicalRemote(value) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port) return null;
    return `${url.origin}${url.pathname.replace(/\.git$/u, '')}`.toLowerCase();
  } catch { return null; }
}

/** Commit only the validated public snapshot, based on fetched remote history, using a temporary index. */
export async function syncPagesSnapshot({ root = repositoryRoot, snapshotPath, remote = 'origin', branch = 'main', expectedRemote } = {}) {
  root = await realpath(resolve(root));
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/u.test(remote) || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/u.test(branch)) throw failure('SYNC_REMOTE');
  const target = resolve(root, snapshotPath ?? snapshotFile);
  if (relative(root, target).replaceAll('\\', '/') !== snapshotFile) throw failure('SYNC_SNAPSHOT');
  try {
    for (const path of [resolve(root, 'community'), target]) {
      const stat = await lstat(path);
      if (stat.isSymbolicLink() || (path === target ? !stat.isFile() : !stat.isDirectory())) throw failure('SYNC_SNAPSHOT');
    }
  } catch { throw failure('SYNC_SNAPSHOT'); }
  let config;
  try { config = JSON.parse(await readFile(resolve(root, 'community/pages.config.json'), 'utf8')); }
  catch { throw failure('SYNC_SNAPSHOT'); }
  // Validate these exact bytes immediately before using them as the Git blob.
  const bytes = await readFile(target), snapshot = publicSnapshot(bytes, config);
  const top = await git(root, ['rev-parse', '--show-toplevel']);
  if (await realpath(top.trim()) !== root) throw failure('SYNC_REPOSITORY');
  await git(root, ['check-ref-format', '--branch', branch], { code: 'SYNC_REMOTE' });
  if (expectedRemote) {
    const expected = canonicalRemote(expectedRemote);
    if (!expected) throw failure('SYNC_REMOTE');
    for (const args of [['remote', 'get-url', '--all', remote], ['remote', 'get-url', '--push', '--all', remote]]) {
      const addresses = (await git(root, args, { code: 'SYNC_REMOTE' })).trim().split(/\r?\n/u);
      if (addresses.length !== 1 || canonicalRemote(addresses[0]) !== expected) throw failure('SYNC_REMOTE');
    }
  }
  const tracking = `refs/remotes/${remote}/${branch}`;
  await git(root, ['fetch', '--no-tags', '--no-write-fetch-head', remote, `refs/heads/${branch}:${tracking}`], { code: 'SYNC_FETCH' });
  const parent = (await git(root, ['rev-parse', '--verify', `${tracking}^{commit}`], { code: 'SYNC_FETCH' })).trim();
  const pipeline = await git(root, ['show', `${parent}:scripts/build-pages.mjs`], { allowFailure: true });
  if (!pipeline?.includes('pages-reviewed.json')) throw failure('SYNC_PIPELINE_NOT_READY');
  const existing = await git(root, ['show', `${parent}:${snapshotFile}`], { allowFailure: true });
  if (existing !== null && publicSnapshot(Buffer.from(existing), config).contentHash === snapshot.contentHash) {
    return { changed: false, commit: parent, contentHash: snapshot.contentHash, branch };
  }
  for (const identity of ['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT']) await git(root, ['var', identity], { code: 'SYNC_IDENTITY' });

  const temporaryRoot = await realpath(tmpdir());
  const temporary = await mkdtemp(join(temporaryRoot, 'guide-pages-sync-'));
  try {
    const index = join(temporary, 'index');
    await git(root, ['read-tree', parent], { index, code: 'SYNC_COMMIT' });
    const blob = (await git(root, ['hash-object', '-w', '--stdin'], { input: bytes, code: 'SYNC_COMMIT' })).trim();
    await git(root, ['update-index', '--add', '--cacheinfo', `100644,${blob},${snapshotFile}`], { index, code: 'SYNC_COMMIT' });
    const tree = (await git(root, ['write-tree'], { index, code: 'SYNC_COMMIT' })).trim();
    const commit = (await git(root, ['-c', 'commit.gpgSign=false', 'commit-tree', tree, '-p', parent], {
      input: 'Update reviewed public guide snapshot\n', code: 'SYNC_COMMIT',
    })).trim();
    const changedFiles = (await git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', parent, commit], { code: 'SYNC_COMMIT' })).trim();
    if (changedFiles !== snapshotFile) throw failure('SYNC_COMMIT');
    await git(root, ['push', '--porcelain', remote, `${commit}:refs/heads/${branch}`], { code: 'SYNC_PUSH' });
    return { changed: true, commit, parent, contentHash: snapshot.contentHash, branch };
  } finally {
    const actual = await realpath(temporary);
    const name = relative(temporaryRoot, actual);
    // Check the resolved cleanup target before removing this operation's temporary index.
    if (dirname(actual) === temporaryRoot && name.startsWith('guide-pages-sync-') && !(await lstat(temporary)).isSymbolicLink()) await rm(actual, { recursive: true, force: true });
  }
}

export async function main(args = process.argv.slice(2)) {
  if (args.length > 1 || (args.length === 1 && !['--demo', '--production'].includes(args[0]))) throw failure('SYNC_ARGUMENTS');
  const { exportPagesSnapshot } = await import('./export-pages.mjs');
  const { buildPages } = await import('./build-pages.mjs');
  const exported = await exportPagesSnapshot({ root: repositoryRoot, demo: args[0] !== '--production' });
  await buildPages({ root: repositoryRoot });
  const result = await syncPagesSnapshot({ root: repositoryRoot, snapshotPath: exported.snapshotPath, expectedRemote: githubRepository });
  console.log(result.changed
    ? `已同步 ${exported.answerCount} 篇公开文章（其中 ${exported.reviewedCount} 篇经过人工审核），提交 ${result.commit.slice(0, 12)}。Pages 部署由 GitHub Actions 继续处理。`
    : '公开内容没有变化，未创建提交。');
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) {
    const code = error.guidePagesSync ? error.code : 'SYNC_FAILED';
    console.error(`Pages 同步未完成（${code}）：${messages[code]}`);
    process.exitCode = 1;
  }
}
