import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadRuntimeConfig, openRuntime, RuntimeStore, contentModule, authModule,
  lifecycleModule, participantsModule, reportsModule,
} from '@information-community/runtime';
import guideReviewsModule from '../community/review-records.mjs';

const load = async file => JSON.parse(await readFile(file, 'utf8'));

export async function prepareGuideRestore({ source, review, templateRoot }) {
  if (!review || !['withdrawnSubjectIds', 'revokedSubjectIds'].every(name => Array.isArray(review[name])) ||
      Object.keys(review).some(name => !['withdrawnSubjectIds', 'revokedSubjectIds'].includes(name))) {
    throw new Error('Review must explicitly contain current withdrawnSubjectIds and revokedSubjectIds arrays.');
  }
  const loaded = await loadRuntimeConfig({ root: templateRoot });
  const extensions = loaded.config.extensions ?? [];
  if (loaded.config.identityProvider || extensions.length > 1 || extensions.some(name => name !== 'review-records.mjs')) throw new Error('Custom platform extensions require a separate reviewed migration.');
  if (extensions.includes('review-records.mjs')) {
    const extension = await readFile(join(templateRoot, 'review-records.mjs'));
    if (!extension.equals(await readFile(new URL('../community/review-records.mjs', import.meta.url)))) throw new Error('Custom platform extensions require a separate reviewed migration.');
  }
  const modules = [{ ...contentModule, initialState: () => contentModule.initialState({ profile: loaded.business.content }) }, authModule, lifecycleModule, participantsModule, reportsModule];
  const backup = structuredClone(source), migrationWarnings = [];
  if (extensions.includes('review-records.mjs')) {
    modules.push(guideReviewsModule);
    if (backup?.state?.modules && backup?.state?.moduleVersions &&
        !Object.hasOwn(backup.state.modules, guideReviewsModule.name) && !Object.hasOwn(backup.state.moduleVersions, guideReviewsModule.name)) {
      // Older five-module artifacts predate business review records, not platform data.
      backup.state.modules[guideReviewsModule.name] = guideReviewsModule.initialState();
      backup.state.moduleVersions[guideReviewsModule.name] = guideReviewsModule.schemaVersion;
      migrationWarnings.push('Legacy migration artifacts do not contain guide review records; the known guide-reviews module was initialized empty. Existing platform data was not synthesized.');
    }
  }
  if (JSON.stringify(backup?.state?.modules?.content?.profile) !== JSON.stringify(loaded.business.content)) throw new Error('Migration content profile must match the target business profile.');
  return { loaded, modules, backup, migrationWarnings, extensions };
}

export async function restoreMigration({ artifactFile, target, reviewFile, templateRoot = resolve('community') }) {
  const artifact = await load(artifactFile), review = await load(reviewFile);
  if (artifact.report?.kind !== 'private-legacy-migration' || artifact.report.schemaVersion !== 1 ||
      artifact.catalog?.schemaVersion !== 1 || !['topics', 'scopes', 'publishers'].every(name => Array.isArray(artifact.catalog[name]))) {
    throw new Error('Expected a reviewed guide migration artifact with a catalog.');
  }
  const { loaded, modules, backup, migrationWarnings, extensions } = await prepareGuideRestore({ source: artifact.backup, review, templateRoot });
  const validator = new RuntimeStore(':memory:', { communityId: loaded.config.communityId, modules });
  try {
    validator.restore(backup, review);
  } finally { validator.close(); }

  // A new directory keeps the live catalog and live database untouched on any failure.
  const root = resolve(target);
  await mkdir(root);
  await writeFile(join(root, '.migration-incomplete'), 'Do not start this directory until migration succeeds.\n', { flag: 'wx' });
  const config = { ...loaded.config, businessFile: 'business.json', dataDirectory: '.runtime', uiDirectory: 'ui' };
  delete config.contentFile;
  const { content, lifecycle, ...business } = loaded.business;
  Object.assign(business, { contentProfileFile: 'content-profile.json', lifecycleFile: 'lifecycle.json', catalogFile: 'catalog.json', policyFile: 'policy.json', consentFile: 'consent.json' });
  for (const [name, value] of Object.entries({ 'runtime.config.json': config, 'business.json': business, 'content-profile.json': content, 'lifecycle.json': lifecycle, 'catalog.json': artifact.catalog })) {
    await writeFile(join(root, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  for (const name of ['policy.json', 'consent.json']) await copyFile(join(templateRoot, name), join(root, name));
  for (const name of extensions) await copyFile(join(templateRoot, name), join(root, name));
  await mkdir(join(root, 'ui'));
  for (const name of ['index.html', 'guide.css', 'guide.js', 'brand.svg', 'editor.html', 'editor.js', 'editor.css', 'batch-review.js']) await copyFile(join(templateRoot, 'ui', name), join(root, 'ui', name));
  const runtime = await openRuntime({ root, seed: false });
  let restored;
  try { restored = runtime.store.restore(backup, review); }
  finally { runtime.store.close(); }
  const { unlink } = await import('node:fs/promises');
  await unlink(join(root, '.migration-incomplete'));
  return { root, ...restored, credentialsImported: false, migrationWarnings };
}

async function main(args) {
  const flags = new Map();
  for (let index = 0; index < args.length; index += 2) {
    if (!['--artifact', '--target', '--review'].includes(args[index]) || !args[index + 1] || flags.has(args[index])) throw new Error('Usage: npm run migrate:restore -- --artifact private.json --target NEW_DIRECTORY --review current-revocations.private.json');
    flags.set(args[index], args[index + 1]);
  }
  if (flags.size !== 3) throw new Error('Explicit --artifact, --target and --review are required.');
  console.log(JSON.stringify(await restoreMigration({ artifactFile: flags.get('--artifact'), target: flags.get('--target'), reviewFile: flags.get('--review') })));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); }
  catch (error) { console.error(`${error.code ?? 'MIGRATION_FAILED'}: ${error.message}`); process.exitCode = 1; }
}
