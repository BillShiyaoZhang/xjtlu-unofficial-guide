import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentModule, importContent, publishContent, projectPublic, readPublicRevision } from '@information-community/runtime';
import { pagesSite, validateReviewedPagesData } from './pages-snapshot.mjs';
import { sourceCategories } from '../community/source-categories.mjs';
import { publicSourceMetadata } from '../community/source-registry.mjs';
import { branchBrowserAssets } from './branch-assets.mjs';
import { connectedSupplements, supplementMetadata } from '../community/supplements.mjs';
import { validateTopicsConfig } from '../community/pages-ui/topic-model.js';

const assets = ['index.html', 'app.js', 'contributions.js', 'topic-model.js', 'discussions.js', 'search.js', 'community.js', 'style.css', 'brand.svg'];
const branchAssets = ['branches.js', 'branch-model.js', 'branches.css', 'core/index.js', 'core/branches.js', 'core/LICENSE'];
const outputs = [...assets, ...branchAssets, 'public.json', 'community-topics.json', '.nojekyll'];
const pick = (value, names) => Object.fromEntries(names.filter(name => value[name] !== undefined).map(name => [name, value[name]]));
const fail = message => { throw new Error(`Pages build: ${message}`); };
const jsonFile = async path => JSON.parse(await readFile(path, 'utf8'));

function uniqueIds(values, name) {
  if (!Array.isArray(values) || values.some(value => typeof value !== 'string' || !value) || new Set(values).size !== values.length) fail(`${name} requires an explicit list of unique revision IDs`);
  return new Set(values);
}

function deployment(config, overrides) {
  const origin = overrides.origin ?? config.origin;
  const basePath = overrides.basePath ?? config.basePath;
  let url;
  try { url = new URL(origin); } catch { fail('origin must be an HTTPS origin'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) fail('origin must be a public HTTPS origin without a path');
  if (typeof basePath !== 'string' || !/^\/(?:[a-zA-Z0-9._-]+\/)*$/u.test(basePath) || basePath.split('/').some(part => part === '.' || part === '..')) fail('basePath must be an absolute directory path without traversal');
  return { origin: url.origin, basePath, publicUrl: url.origin + basePath };
}

function publicUrl(value, site) {
  if (value === 'http://localhost:4317/about#method' || value === 'http://localhost:4317/about') return site.publicUrl + '#/about';
  let url;
  try { url = new URL(value); } catch { fail('public source URLs must be absolute HTTPS URLs'); }
  if (url.protocol !== 'https:' || url.username || url.password || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) fail('public source URLs must be HTTPS and must not contain local addresses or credentials');
  return url.href;
}

function unrestricted(value) {
  if (!value || typeof value !== 'object') return;
  if (value.hidden === true || value.private === true || value.draft === true ||
      (value.visibility !== undefined && value.visibility !== 'public') ||
      (value.disposition !== undefined && value.disposition !== 'active') ||
      (value.publicationStatus !== undefined && value.publicationStatus !== 'published')) fail('allowlisted demo content contains restricted or unpublished state');
}

/** Build only an explicitly reviewed Git demo bundle, never a runtime backup. */
export function createPagesData({ config, profile, content: input, catalog, now = new Date().toISOString(), ...overrides }) {
  if (config.schemaVersion !== 1 || config.mode !== 'public-demo' || typeof config.siteName !== 'string' || !config.siteName.trim()) fail('an explicit public-demo config is required');
  if (!Number.isFinite(Date.parse(now))) fail('now must be a valid date');
  if (input.schemaVersion !== 1 || Object.keys(input).some(key => !['schemaVersion', 'entities', 'revisions', 'citations', 'links'].includes(key))) fail('only content interchange is accepted, never a state backup');
  const site = deployment(config, overrides);
  const published = uniqueIds(config.publishedRevisionIds, 'publishedRevisionIds');
  const allowedSources = uniqueIds(config.sourceRevisionIds, 'sourceRevisionIds');
  const revisions = new Map(input.revisions.map(value => [value.id, value]));
  const entities = new Map(input.entities.map(value => [value.id, value]));
  if (revisions.size !== input.revisions.length || entities.size !== input.entities.length) fail('duplicate input IDs');
  const roles = new Map(profile.entityTypes.map(value => [value.id, value.role]));
  const selected = [...published].map(id => {
    const revision = revisions.get(id);
    if (!revision || roles.get(entities.get(revision.entityId)?.type) !== 'content' || revision.data?.demo !== true) fail(`allowlisted revision ${id} must be an existing demo content revision`);
    return revision;
  });
  const citations = input.citations.filter(value => published.has(value.revisionId));
  const requiredSources = new Set(citations.map(value => value.sourceRevisionId));
  const sources = [...requiredSources].map(id => {
    const revision = revisions.get(id);
    if (!allowedSources.has(id) || !revision || roles.get(entities.get(revision.entityId)?.type) !== 'source') fail(`source revision ${id} is not explicitly allowed`);
    if (revision.data.rights?.expiresAt !== undefined) fail('time-limited sources cannot be copied to permanent static Pages artifacts');
    return revision;
  });
  const selectedRevisions = structuredClone([...selected, ...sources]);
  const selectedEntityIds = new Set(selectedRevisions.map(value => value.entityId));
  for (const revision of selectedRevisions) {
    for (const value of [revision, revision.data, revision.extensions, entities.get(revision.entityId), entities.get(revision.entityId)?.extensions]) unrestricted(value);
    if (revision.parentRevisionId && !selectedRevisions.some(value => value.id === revision.parentRevisionId)) fail('a selected revision references an unapproved parent revision');
    if (roles.get(entities.get(revision.entityId).type) === 'source') revision.data.url = publicUrl(revision.data.url, site);
  }
  const bundle = {
    schemaVersion: 1,
    entities: input.entities.filter(value => selectedEntityIds.has(value.id)),
    revisions: selectedRevisions,
    citations,
    links: input.links.filter(link => selectedEntityIds.has(link.from) && selectedEntityIds.has(link.to)),
  };
  let content = importContent(contentModule.initialState({ profile }), bundle);
  for (const revision of [...selected].sort((left, right) => left.number - right.number)) {
    const entity = content.entities.find(value => value.id === revision.entityId);
    content = publishContent(content, { entityId: entity.id, revisionId: revision.id, expectedVersion: entity.version, now });
  }
  const topics = catalog.topics.filter(value => value.status !== 'hidden').map(value => pick(value, ['id', 'slug', 'titleZh', 'description']));
  const scopes = catalog.scopes.filter(value => value.status !== 'hidden').map(value => pick(value, ['id', 'dimension', 'code', 'labelZh']));
  const publishers = catalog.publishers.map(value => ({ ...pick(value, ['id', 'nameZh']), ...(value.canonicalUrl ? { canonicalUrl: publicUrl(value.canonicalUrl, site) } : {}) }));
  const graph = projectPublic(content, { now });
  const answers = graph.nodes.map(node => {
    const revision = selected.find(value => value.id === node.revisionId);
    const entity = entities.get(node.id);
    const data = revision.data;
    const topic = topics.find(value => value.id === (data.topicId ?? entity.topicId ?? entity.extensions?.topicId));
    const history = selected.filter(value => value.entityId === node.id).map(value => readPublicRevision(content, value.id, { now })).filter(Boolean)
      .map(value => ({ id: value.revisionId, number: value.revisionNumber, title: value.title }));
    const citations = node.citations.map(citation => ({ ...citation, ...publicSourceMetadata(revisions.get(citation.sourceRevisionId).data) }));
    return {
      ...pick(node, ['id', 'title', 'revisionId', 'revisionNumber', 'sentences', 'citations', 'scope', 'warnings']),
      citations, sourceCategories: sourceCategories(citations),
      slug: data.slug ?? entity.slug ?? entity.extensions?.slug ?? entity.id,
      demo: true,
      ...pick(data, ['summary', 'asOf', 'verifiedAt', 'reviewDueAt', 'reviewOwnerLabel', 'evidenceNote']),
      topic: topic ? { id: topic.id, slug: topic.slug, title: topic.titleZh } : null,
      ...supplementMetadata(data),
      history,
    };
  });
  if (answers.length !== new Set(selected.map(value => value.entityId)).size) fail('not every selected answer passes the public projection');
  const visibleAnswers = connectedSupplements(answers), visible = new Set(visibleAnswers.map(answer => answer.id));
  return {
    schemaVersion: 1,
    mode: 'public-demo',
    generatedAt: new Date(now).toISOString(),
    site: pagesSite(config, overrides),
    catalog: { topics, scopes, publishers },
    search: { aliases: structuredClone(profile.search.aliases) },
    answers: visibleAnswers, links: graph.edges.filter(edge => visible.has(edge.from) && visible.has(edge.to)),
  };
}

export async function buildPages({ root = resolve('.'), now, origin, basePath } = {}) {
  const community = resolve(root, 'community');
  const config = await jsonFile(resolve(community, 'pages.config.json'));
  let data;
  try {
    const snapshotFile = resolve(community, 'pages-reviewed.json');
    const stat = await lstat(snapshotFile);
    if (!stat.isFile() || stat.isSymbolicLink()) fail('reviewed snapshot must be a regular file');
    data = validateReviewedPagesData(await jsonFile(snapshotFile), { config, now, origin, basePath });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (config.collectedRevisionIds?.length) fail('an explicit collection requires an exported public snapshot; run export:pages first');
    const profile = await jsonFile(resolve(community, 'content-profile.json'));
    const content = await jsonFile(resolve(community, 'content.json'));
    const catalog = await jsonFile(resolve(community, 'catalog.json'));
    data = createPagesData({ config, profile, content, catalog, now, origin, basePath });
  }
  let topics = { schemaVersion: 1, topics: [] };
  try {
    const topicsFile = resolve(community, 'community-topics.json');
    const stat = await lstat(topicsFile);
    if (!stat.isFile() || stat.isSymbolicLink()) fail('community topics must be a regular file');
    topics = await jsonFile(topicsFile);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Use the public catalog: an editorial prompt must not expose a hidden catalog category.
  topics = validateTopicsConfig(topics, data.catalog);
  const source = resolve(community, 'pages-ui');
  for (const name of assets) {
    const stat = await lstat(resolve(source, name));
    if (!stat.isFile() || stat.isSymbolicLink()) fail(`UI asset ${name} must be a regular file`);
  }
  const output = resolve(community, 'pages-dist');
  const shared = await branchBrowserAssets();
  async function inspectOutput(directory, prefix = '') {
    for (const name of await readdir(directory)) {
      const relative = prefix + name, path = resolve(directory, name);
      const entry = await lstat(path);
      if (relative === 'core' && entry.isDirectory() && !entry.isSymbolicLink()) {
        await inspectOutput(path, 'core/');
        continue;
      }
      if (!outputs.includes(relative)) fail(`unexpected output ${relative}; refusing to retain or overwrite an unknown artifact`);
      if (!entry.isFile() || entry.isSymbolicLink()) fail(`output ${relative} must be a regular file`);
    }
  }
  try {
    const stat = await lstat(output);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('output must be a regular directory');
    await inspectOutput(output);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(output, { recursive: true });
  for (const name of assets) await copyFile(resolve(source, name), resolve(output, name));
  for (const [name, body] of Object.entries(shared)) {
    await mkdir(dirname(resolve(output, name)), { recursive: true });
    await writeFile(resolve(output, name), body);
  }
  await writeFile(resolve(output, 'public.json'), JSON.stringify(data, null, 2) + '\n');
  await writeFile(resolve(output, 'community-topics.json'), JSON.stringify(topics, null, 2) + '\n');
  await writeFile(resolve(output, '.nojekyll'), '');
  return { output, answerCount: data.answers.length, topicCount: topics.topics.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildPages({ origin: process.env.PAGES_ORIGIN, basePath: process.env.PAGES_BASE_PATH });
  console.log(`Built ${result.answerCount} public answers: ${result.output}`);
}
