import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { buildPages, createPagesData } from '../scripts/build-pages.mjs';
import { loadCommunity, loadDemoPagesConfig } from './helpers.mjs';

const community = new URL('../community/', import.meta.url);
const readJson = async name => JSON.parse(await readFile(new URL(name, community), 'utf8'));
async function fixture() {
  const config = await loadDemoPagesConfig();
  delete config.collectedRevisionIds;
  return { config, profile: await readJson('content-profile.json'), content: (await loadCommunity({ includeDemo: true })).bundle, catalog: await readJson('catalog.json'), now: '2026-09-10T00:00:00Z' };
}

test('Pages exports exactly the reviewed demo revisions as public DTOs', async () => {
  const data = createPagesData(await fixture());
  assert.equal(data.mode, 'public-demo');
  assert.equal(data.answers.length, 4);
  assert.ok(data.catalog.scopes.every(scope => typeof scope.code === 'string' && scope.code.length > 0));
  assert.ok(data.answers.every(value => value.demo && value.history.length === 1));
  const serialized = JSON.stringify(data);
  for (const privateField of ['reviewOwnerId', 'searchText', 'extensions', 'payload', 'passwordHash', 'consent', 'keyring', 'localhost']) assert.ok(!serialized.includes(privateField), privateField);
  assert.equal(data.answers.flatMap(value => value.citations).find(value => value.sourceRevisionId === 'artifact-revision-method').url, 'https://billshiyaozhang.github.io/xjtlu-unofficial-guide/#/about');
});

test('unlisted drafts and private metadata never enter the static output', async () => {
  const input = await fixture();
  const answer = input.content.revisions.find(value => value.data.demo === true && value.entityId.startsWith('card-'));
  answer.data.internalNotes = 'PRIVATE_METADATA_SENTINEL';
  answer.extensions = { secret: 'PRIVATE_EXTENSION_SENTINEL' };
  input.catalog.topics[0].privateNote = 'PRIVATE_CATALOG_SENTINEL';
  input.content.entities.push({ id: 'unlisted-draft', type: 'answer' });
  input.content.revisions.push({ id: 'unlisted-draft-v1', entityId: 'unlisted-draft', number: 1, parentRevisionId: null, createdAt: input.now, data: { ...answer.data, title: 'UNPUBLISHED_DRAFT_SENTINEL', demo: true } });
  const serialized = JSON.stringify(createPagesData(input));
  for (const value of ['PRIVATE_METADATA_SENTINEL', 'PRIVATE_EXTENSION_SENTINEL', 'PRIVATE_CATALOG_SENTINEL', 'UNPUBLISHED_DRAFT_SENTINEL']) assert.ok(!serialized.includes(value));
});

test('Pages refuses non-demo, restricted, expired-rights and unknown revision inputs', async () => {
  let input = await fixture();
  input.content.revisions.find(value => value.id === input.config.publishedRevisionIds[0]).data.demo = false;
  assert.throws(() => createPagesData(input), /existing demo/);
  input = await fixture();
  input.content.revisions.find(value => value.id === input.config.publishedRevisionIds[0]).data.visibility = 'restricted';
  assert.throws(() => createPagesData(input), /restricted or unpublished/);
  input = await fixture();
  input.content.revisions[0].data.rights = { expiresAt: '2099-01-01T00:00:00Z' };
  assert.throws(() => createPagesData(input), /time-limited/);
  input = await fixture();
  input.config.publishedRevisionIds.push('unknown');
  assert.throws(() => createPagesData(input), /existing demo/);
  input = await fixture();
  input.config.sourceRevisionIds = input.config.sourceRevisionIds.slice(1);
  assert.throws(() => createPagesData(input), /not explicitly allowed/);
  input = await fixture();
  input.content.modules = { auth: {} };
  assert.throws(() => createPagesData(input), /never a state backup/);
});

test('Pages uses deployment-relative public links and validates deployment settings', async () => {
  const input = await fixture();
  const data = createPagesData({ ...input, origin: 'https://example.github.io', basePath: '/different-project/' });
  assert.equal(data.site.publicUrl, 'https://example.github.io/different-project/');
  assert.equal(data.catalog.publishers.find(value => value.id === 'publisher-guide').canonicalUrl, data.site.publicUrl + '#/about');
  assert.throws(() => createPagesData({ ...input, basePath: '/../private/' }), /basePath/);
  assert.throws(() => createPagesData({ ...input, origin: 'http://localhost:4317' }), /HTTPS origin/);
});

test('Pages exposes only an explicitly configured GitHub owner/repository for contributions', async () => {
  const input = await fixture();
  assert.equal(createPagesData(input).site.contributionsRepository, 'BillShiyaoZhang/xjtlu-unofficial-guide');
  delete input.config.contributionsRepository;
  assert.equal(createPagesData(input).site.contributionsRepository, undefined);
  for (const repository of ['https://example.com/issues', 'owner/repo/extra', 'owner/repo?redirect=other', 'owner/..', 'owner/repo#fragment']) {
    assert.throws(() => createPagesData({ ...input, config: { ...input.config, contributionsRepository: repository } }), /contributions repository/u);
  }
});

test('build reads no runtime database and emits only the fixed Pages asset list', async t => {
  const root = await mkdtemp(resolve(tmpdir(), 'guide-pages-build-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = resolve(root, 'community');
  await mkdir(resolve(directory, 'pages-ui'), { recursive: true });
  for (const name of ['pages.config.json', 'content-profile.json', 'content.json', 'catalog.json']) await writeFile(resolve(directory, name), await readFile(new URL(name, community)));
  const input = await fixture();
  await writeFile(resolve(directory, 'pages.config.json'), JSON.stringify(input.config));
  await writeFile(resolve(directory, 'content.json'), JSON.stringify(input.content));
  for (const [name, contents] of Object.entries({ 'index.html': '<script type="module" src="./app.js"></script>', 'app.js': 'fetch("./public.json")', 'contributions.js': 'export const contributionTypes = {};', 'style.css': 'body { color: black; }', 'brand.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>' })) await writeFile(resolve(directory, 'pages-ui', name), contents);
  await mkdir(resolve(directory, '.runtime'));
  await writeFile(resolve(directory, '.runtime', 'community.sqlite'), 'PRIVATE_DATABASE_SENTINEL');
  await writeFile(resolve(directory, '.dev-secrets.json'), 'PRIVATE_SECRETS_SENTINEL');
  const result = await buildPages({ root, now: '2026-09-10T00:00:00Z' });
  assert.equal(result.answerCount, 4);
  assert.deepEqual((await readdir(result.output)).sort(), ['.nojekyll', 'app.js', 'branch-model.js', 'branches.css', 'branches.js', 'brand.svg', 'contributions.js', 'core', 'index.html', 'public.json', 'style.css']);
  assert.deepEqual((await readdir(resolve(result.output, 'core'))).sort(), ['LICENSE', 'branches.js', 'index.js']);
  const serialized = await readFile(resolve(result.output, 'public.json'), 'utf8');
  assert.ok(!serialized.includes('PRIVATE_DATABASE_SENTINEL'));
  assert.ok(!serialized.includes('PRIVATE_SECRETS_SENTINEL'));
  await writeFile(resolve(result.output, 'private-backup.json'), 'DO_NOT_PUBLISH');
  await assert.rejects(buildPages({ root }), /unexpected output private-backup.json/);
});

test('the production Pages build contains exactly the 76 real articles and no demonstration fallback', async t => {
  const root = await mkdtemp(resolve(tmpdir(), 'guide-pages-production-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = resolve(root, 'community');
  await mkdir(resolve(directory, 'pages-ui'), { recursive: true });
  for (const name of ['pages.config.json', 'pages-reviewed.json', 'content-profile.json', 'content.json', 'catalog.json']) {
    await writeFile(resolve(directory, name), await readFile(new URL(name, community)));
  }
  for (const name of ['index.html', 'app.js', 'contributions.js', 'style.css', 'brand.svg']) {
    await writeFile(resolve(directory, 'pages-ui', name), await readFile(new URL(`pages-ui/${name}`, community)));
  }
  const result = await buildPages({ root, now: '2026-09-10T00:00:00Z' });
  const data = JSON.parse(await readFile(resolve(result.output, 'public.json'), 'utf8'));
  assert.equal(result.answerCount, 76);
  assert.ok(data.answers.every(answer => answer.demo === false && answer.reviewStatus === 'collected'));
  const handbook = await readJson('handbook/runtime-import.json');
  assert.deepEqual(new Set(data.answers.map(answer => answer.id)), new Set(handbook.entities.filter(entity => entity.type === 'answer').map(entity => entity.id)));
  const input = await fixture();
  input.config = await readJson('pages.config.json');
  delete input.config.collectedRevisionIds;
  assert.deepEqual(createPagesData(input).answers, [], 'cleared authorizations cannot publish even the explicit test-only demo bundle');
});
