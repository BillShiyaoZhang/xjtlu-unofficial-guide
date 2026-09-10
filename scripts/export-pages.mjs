import { lstat, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { loadRuntimeConfig, RuntimeStore, contentModule, authModule, lifecycleModule, participantsModule, reportsModule } from '@information-community/runtime';
import reviewRecords from '../community/review-records.mjs';
import { createReviewedPagesData, validateReviewedPagesData } from './pages-snapshot.mjs';

const json = async path => JSON.parse(await readFile(path, 'utf8'));
async function regularFile(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Pages export requires regular files, not symbolic links.');
}
function readExistingState(loaded) {
  if (!isDeepStrictEqual(loaded.config.extensions, ['review-records.mjs']) || loaded.config.identityProvider) throw new Error('Pages export requires the configured guide review module.');
  const database = new DatabaseSync(join(loaded.dataDirectory, 'community.sqlite'), { readOnly: true });
  let state;
  try {
    database.exec('PRAGMA busy_timeout=5000');
    const row = database.prepare('SELECT value FROM runtime_state WHERE id=1').get();
    if (!row) throw new Error('Pages export requires an initialized runtime database.');
    state = JSON.parse(row.value);
  } finally { database.close(); }
  // Validate with the installed SDK in memory; never initialize, migrate or rewrite the source database.
  const modules = [{ ...contentModule, initialState: () => contentModule.initialState({ profile: loaded.business.content }) }, authModule];
  if (loaded.business.lifecycle) modules.push(lifecycleModule);
  if (loaded.business.participants) modules.push(participantsModule);
  if (loaded.business.anonymousReports) modules.push(reportsModule);
  modules.push(reviewRecords);
  const validator = new RuntimeStore(':memory:', { communityId: loaded.config.communityId, modules });
  try {
    validator.validate(state);
    if (!isDeepStrictEqual(state.modules.content.profile, loaded.business.content)) throw new Error('Pages export requires the current configured content policy.');
  } finally { validator.close(); }
  return state;
}
export async function exportPagesSnapshot({ root = resolve('.'), demo = true, env = process.env, now } = {}) {
  const community = resolve(root, 'community'), configFile = demo ? 'runtime.demo.json' : 'runtime.config.json';
  try {
    await lstat(join(community, '.migration-incomplete'));
    throw new Error('Pages export refuses an incomplete migration.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const loaded = await loadRuntimeConfig({ root: community, configFile });
  // Refuse to create/seed an empty runtime when the intended local database is absent.
  await regularFile(join(loaded.dataDirectory, 'community.sqlite'));
  const keyring = demo ? (await json(join(community, '.dev-secrets.json'))).keyring : JSON.parse(env.RUNTIME_KEYRING ?? 'null');
  if (!keyring) throw new Error('Set RUNTIME_KEYRING for the selected runtime.');
  const config = await json(join(community, 'pages.config.json'));
  const catalog = await json(join(community, loaded.business.catalogFile ?? 'catalog.json'));
  const snapshot = createReviewedPagesData({ state: readExistingState(loaded), catalog, config, keyring, ...(now ? { now } : {}) });
  const snapshotPath = join(community, 'pages-reviewed.json');
  let previous;
  try {
    await regularFile(snapshotPath);
    const saved = await json(snapshotPath);
    // A changed submission destination is deployment metadata, not a reason to
    // discard the last content snapshot. It is used here only for comparison.
    previous = validateReviewedPagesData(saved, { config: { ...config, contributionsRepository: saved.site?.contributionsRepository } });
  }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const changed = previous?.contentHash !== snapshot.contentHash;
  if (changed) {
    const temporary = join(community, `.pages-reviewed-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      await rename(temporary, snapshotPath);
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  return { snapshotPath, answerCount: snapshot.answers.length, reviewedCount: snapshot.answers.filter(answer => answer.reviewStatus === 'approved').length, contentHash: snapshot.contentHash, changed };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flags = process.argv.slice(2);
  if (flags.length > 1 || flags.some(flag => !['--demo', '--production'].includes(flag))) throw new Error('Usage: npm run export:pages -- [--demo|--production]');
  console.log(JSON.stringify(await exportPagesSnapshot({ demo: !flags.includes('--production') })));
}
