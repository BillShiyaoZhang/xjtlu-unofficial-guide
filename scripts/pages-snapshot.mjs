import { createHash } from 'node:crypto';
import { projectPublic, decryptPrivatePayload } from '@information-community/runtime';
import { isSafePublicUrl } from '../server/business-validation.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pick = (value, fields) => Object.fromEntries(fields.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
const fail = message => { throw Object.assign(new Error(`Pages snapshot: ${message}`), { code: 'PAGES_SNAPSHOT_INVALID' }); };
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export function pagesContentHash(snapshot) {
  const { generatedAt, contentHash, ...data } = snapshot;
  return createHash('sha256').update(JSON.stringify(canonical(data))).digest('hex');
}
function exact(value, fields) {
  if (!object(value) || Object.keys(value).some(key => !fields.includes(key))) fail('unexpected or private fields');
}
function text(value, max = 20000, min = 0) {
  if (typeof value !== 'string' || value.length > max || value.trim().length < min) fail('invalid text');
}
function id(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/u.test(value)) fail('invalid identifier'); }
function date(value) { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail('invalid date'); }
function list(value, max = 40000) { if (!Array.isArray(value) || value.length > max) fail('invalid list'); }
function distinct(values) { if (new Set(values).size !== values.length) fail('duplicate identifiers'); }
export function pagesSite(config, overrides = {}) {
  const origin = overrides.origin ?? config.origin, basePath = overrides.basePath ?? config.basePath;
  let url;
  try { url = new URL(origin); } catch { fail('invalid site origin'); }
  if (!isSafePublicUrl(origin) || url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) fail('site origin must be public HTTPS');
  if (typeof basePath !== 'string' || !/^\/(?:[a-zA-Z0-9._-]+\/)*$/u.test(basePath) || basePath.split('/').some(part => part === '.' || part === '..')) fail('invalid basePath');
  text(config.siteName, 160, 1);
  const repository = config.contributionsRepository;
  if (repository !== undefined && (typeof repository !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/u.test(repository) || ['.', '..'].includes(repository.split('/')[1]))) fail('invalid contributions repository');
  return { name: config.siteName, basePath, publicUrl: url.origin + basePath, ...(repository ? { contributionsRepository: repository } : {}) };
}
function publicUrl(value, site) {
  if (['http://localhost:4317/about', 'http://localhost:4317/about#method'].includes(value)) return site.publicUrl + '#/about';
  if (!isSafePublicUrl(value) || new URL(value).protocol !== 'https:') fail('source URL must be public HTTPS without credentials');
  return new URL(value).href;
}

/** This is a public DTO, not a content import or a database backup. */
export function validateReviewedPagesData(input, { config, ...overrides } = {}) {
  exact(input, ['schemaVersion', 'mode', 'generatedAt', 'contentHash', 'site', 'catalog', 'search', 'answers']);
  if (input.schemaVersion !== 1 || input.mode !== 'public-reviewed') fail('expected public-reviewed snapshot, never a runtime backup');
  date(input.generatedAt);
  if (!/^[a-f0-9]{64}$/u.test(input.contentHash) || pagesContentHash(input) !== input.contentHash) fail('content hash mismatch');
  const site = pagesSite(config, overrides);
  exact(input.site, ['name', 'basePath', 'publicUrl', 'contributionsRepository']);
  // Old snapshots remain valid until the first export after enabling submissions.
  const expectedSite = { ...site };
  if (input.site.contributionsRepository === undefined) delete expectedSite.contributionsRepository;
  if (JSON.stringify(canonical(input.site)) !== JSON.stringify(canonical(expectedSite))) fail('snapshot site differs from Pages configuration; export it again');
  exact(input.catalog, ['topics', 'scopes', 'publishers']);
  for (const [key, fields] of [
    ['topics', ['id', 'slug', 'titleZh', 'description']], ['scopes', ['id', 'dimension', 'code', 'labelZh']],
    ['publishers', ['id', 'nameZh', 'canonicalUrl']],
  ]) {
    list(input.catalog[key]); distinct(input.catalog[key].map(row => row?.id));
    for (const row of input.catalog[key]) {
      exact(row, fields); id(row.id);
      for (const [name, value] of Object.entries(row)) {
        text(value, 2000);
        if (name === 'canonicalUrl' && publicUrl(value, site) !== value) fail('snapshot URLs must already be normalized public HTTPS');
      }
    }
  }
  exact(input.search, ['aliases']);
  if (!object(input.search.aliases) || Object.keys(input.search.aliases).length > 5000) fail('invalid search aliases');
  for (const [word, aliases] of Object.entries(input.search.aliases)) { text(word, 200, 1); list(aliases, 100); aliases.forEach(value => text(value, 200, 1)); }
  list(input.answers); distinct(input.answers.map(answer => answer?.id));
  distinct(input.answers.map(answer => answer?.revisionId));
  for (const answer of input.answers) {
    exact(answer, ['id', 'title', 'revisionId', 'revisionNumber', 'sentences', 'citations', 'scope', 'warnings', 'slug', 'demo',
      'summary', 'asOf', 'verifiedAt', 'reviewDueAt', 'reviewOwnerLabel', 'evidenceNote', 'topic', 'history', 'origin', 'originalOrigin', 'reviewStatus']);
    id(answer.id); id(answer.revisionId); text(answer.title, 160, 1); text(answer.slug, 200, 1);
    if (!Number.isSafeInteger(answer.revisionNumber) || answer.revisionNumber < 1 || typeof answer.demo !== 'boolean' ||
        answer.origin !== 'human' || !['ai_draft', 'human'].includes(answer.originalOrigin)) fail('only human-confirmed public content is accepted');
    if (answer.reviewStatus === 'demo') {
      if (!answer.demo || !config.publishedRevisionIds?.includes(answer.revisionId)) fail('unapproved demo revision');
    } else {
      if (answer.reviewStatus !== 'approved') fail('article has not passed review');
      date(answer.verifiedAt); text(answer.reviewOwnerLabel, 120, 1);
      if (Date.parse(answer.verifiedAt) > Date.parse(input.generatedAt)) fail('verification occurs after export');
    }
    for (const name of ['summary', 'asOf', 'verifiedAt', 'reviewDueAt', 'reviewOwnerLabel', 'evidenceNote']) text(answer[name], name === 'evidenceNote' ? 20000 : 2000);
    if (answer.reviewDueAt) date(answer.reviewDueAt);
    exact(answer.scope, ['campus', 'audience', 'academic_year']);
    for (const values of Object.values(answer.scope)) { list(values, 100); values.forEach(value => text(value, 100, 1)); }
    list(answer.warnings, 20); answer.warnings.forEach(value => text(value, 2000));
    list(answer.sentences, 1000); if (!answer.sentences.length) fail('missing article body');
    distinct(answer.sentences.map(sentence => sentence?.id));
    for (const sentence of answer.sentences) {
      exact(sentence, ['id', 'kind', 'text']); id(sentence.id); text(sentence.text, 20000, 1);
      if (!['fact', 'advice'].includes(sentence.kind)) fail('invalid sentence kind');
    }
    list(answer.citations, 5000); distinct(answer.citations.map(citation => citation?.id));
    for (const citation of answer.citations) {
      exact(citation, ['id', 'sentenceId', 'sourceEntityId', 'sourceRevisionId', 'position', 'order', 'title', 'url', 'mode', 'excerpt']);
      for (const name of ['id', 'sentenceId', 'sourceEntityId', 'sourceRevisionId']) id(citation[name]);
      if (!answer.sentences.some(sentence => sentence.id === citation.sentenceId)) fail('citation refers to missing sentence');
      if (!Number.isSafeInteger(citation.order) || citation.order < 0) fail('invalid citation order');
      text(citation.title, 160, 1);
      if (publicUrl(citation.url, site) !== citation.url) fail('snapshot URLs must already be normalized public HTTPS');
      if (citation.mode === 'link-only') {
        exact(citation.position, ['kind']);
        if (citation.position.kind !== 'link' || citation.excerpt !== undefined) fail('link-only sources cannot contain copied text');
      } else if (citation.mode === 'excerpt') {
        exact(citation.position, ['kind', 'start', 'end']);
        if (citation.position.kind !== 'text' || !Number.isSafeInteger(citation.position.start) || !Number.isSafeInteger(citation.position.end) ||
            citation.position.start < 0 || citation.position.end <= citation.position.start) fail('invalid excerpt position');
        text(citation.excerpt, 100000, 1);
        if (citation.excerpt.length !== citation.position.end - citation.position.start) fail('excerpt length differs from citation');
      } else fail('invalid citation mode');
    }
    distinct(answer.citations.map(citation => `${citation.sentenceId}|${citation.order}`));
    for (const sentence of answer.sentences) if (sentence.kind === 'fact' && !answer.citations.some(citation => citation.sentenceId === sentence.id)) fail('fact is missing evidence');
    if (answer.topic !== null) {
      exact(answer.topic, ['id', 'slug', 'title']); id(answer.topic.id); text(answer.topic.slug, 200, 1); text(answer.topic.title, 160, 1);
      if (!input.catalog.topics.some(topic => topic.id === answer.topic.id)) fail('unknown topic');
    }
    list(answer.history, 1);
    if (answer.history.length !== 1) fail('only the current public version belongs in this snapshot');
    const [history] = answer.history;
    exact(history, ['id', 'number', 'title']);
    if (history.id !== answer.revisionId || history.number !== answer.revisionNumber || history.title !== answer.title) fail('history differs from published version');
  }
  return structuredClone(input);
}

export function createReviewedPagesData({ state, catalog, config, keyring, now = new Date().toISOString() }) {
  date(now);
  const content = state.modules.content, site = pagesSite(config);
  const revisions = new Map(content.revisions.map(row => [row.id, row]));
  const entities = new Map(content.entities.map(row => [row.id, row]));
  const topics = catalog.topics.filter(row => row.status !== 'hidden').map(row => pick(row, ['id', 'slug', 'titleZh', 'description']));
  const scopes = catalog.scopes.filter(row => row.status !== 'hidden').map(row => pick(row, ['id', 'dimension', 'code', 'labelZh']));
  const publishers = catalog.publishers.map(row => ({ ...pick(row, ['id', 'nameZh']), ...(row.canonicalUrl ? { canonicalUrl: publicUrl(row.canonicalUrl, site) } : {}) }));
  const approved = new Map();
  for (const record of state.modules['guide-reviews'].records) {
    if (record.action !== 'content.review') continue;
    const payload = decryptPrivatePayload(record.id, record.payload, keyring);
    if (payload.outcome?.decision === 'approved' && payload.outcome.publishedRevisionId) approved.set(payload.outcome.publishedRevisionId, record);
  }
  const answers = projectPublic(content, { now }).nodes.map(node => {
    const revision = revisions.get(node.revisionId), data = revision.data, entity = entities.get(node.id);
    const legacyDemo = data.demo === true && config.publishedRevisionIds?.includes(revision.id);
    if (!legacyDemo) {
      const review = approved.get(revision.id);
      if (!review || review.entityId !== entity.id || review.revisionId !== revision.parentRevisionId ||
          data.reviewedFromRevisionId !== review.revisionId || data.reviewOwnerId !== review.actorId ||
          data.verifiedAt !== new Date(review.createdAt).toISOString() || data.origin !== 'human') fail(`public article ${entity.id} needs explicit approval and publication before export`);
    }
    const topic = topics.find(row => row.id === (data.topicId ?? entity.topicId ?? entity.extensions?.topicId));
    const citations = node.citations.map(citation => {
      const source = revisions.get(citation.sourceRevisionId);
      if (source.data.rights?.expiresAt !== undefined) fail('time-limited sources cannot enter permanent static artifacts');
      return { ...pick(citation, ['id', 'sentenceId', 'sourceEntityId', 'sourceRevisionId', 'position', 'order', 'title', 'mode', 'excerpt']), url: publicUrl(citation.url, site) };
    });
    const dispute = { reported: '该答案收到争议报告，正在复核，请对照原始来源。', confirmed: '该答案存在已确认的争议，请勿据此单独作出决定。' }[data.disputeStatus];
    return {
      ...pick(node, ['id', 'title', 'revisionId', 'revisionNumber', 'sentences', 'scope']), citations,
      warnings: [...node.warnings, ...(dispute ? [dispute] : [])],
      slug: data.slug ?? entity.slug ?? entity.extensions?.slug ?? entity.id,
      demo: data.demo === true, origin: data.origin, originalOrigin: data.originalOrigin ?? data.origin, reviewStatus: legacyDemo ? 'demo' : 'approved',
      ...Object.fromEntries(['summary', 'asOf', 'verifiedAt', 'reviewDueAt', 'reviewOwnerLabel', 'evidenceNote'].map(key => [key, data[key] ?? ''])),
      topic: topic ? { id: topic.id, slug: topic.slug, title: topic.titleZh } : null,
      history: [{ id: revision.id, number: revision.number, title: data.title }],
    };
  });
  const snapshot = {
    schemaVersion: 1, mode: 'public-reviewed', generatedAt: new Date(now).toISOString(), site,
    catalog: { topics, scopes, publishers }, search: { aliases: structuredClone(content.profile.search.aliases) }, answers,
  };
  snapshot.contentHash = pagesContentHash(snapshot);
  return validateReviewedPagesData(snapshot, { config });
}
