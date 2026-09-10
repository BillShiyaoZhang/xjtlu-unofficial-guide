import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import reviewRecords from '../community/review-records.mjs';
import {
  RuntimeStore,
  authModule,
  bootstrapAccount,
  contentModule,
  createRuntimeApp,
  importContent,
  lifecycleModule,
  loadRuntimeConfig,
  participantsModule,
  publishContent,
  reportsModule,
  totpCode,
} from '@information-community/runtime';

export const repoRoot = fileURLToPath(new URL('../', import.meta.url));
export const communityRoot = fileURLToPath(new URL('../community/', import.meta.url));
export const initialTime = Date.parse('2098-01-01T00:00:00Z');
export const syntheticResearch = Object.freeze({ enabled: true, batchId: 'synthetic-research-2098', startAt: '2098-01-01T00:00:00Z', endAt: '2099-01-01T00:00:00Z' });
export const mfaKey = 'ab'.repeat(32);
export const keyring = { activeVersion: 'test-v1', keys: { 'test-v1': Buffer.alloc(32, 17) } };
const password = 'synthetic-integration-password';
const totpSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

export async function loadDemoContent() {
  return JSON.parse(await readFile(new URL('./fixtures/demo-content.json', import.meta.url), 'utf8'));
}

export async function loadDemoPagesConfig() {
  const config = JSON.parse(await readFile(join(communityRoot, 'pages.config.json'), 'utf8'));
  const fixture = await loadDemoContent();
  const answers = new Set(fixture.entities.filter(entity => entity.type === 'answer').map(entity => entity.id));
  return {
    ...config,
    publishedRevisionIds: fixture.revisions.filter(revision => answers.has(revision.entityId)).map(revision => revision.id),
    sourceRevisionIds: [...new Set(fixture.citations.map(citation => citation.sourceRevisionId))],
  };
}

export async function loadCommunity({ includeDemo = false } = {}) {
  const loaded = await loadRuntimeConfig({ root: communityRoot });
  const bundle = JSON.parse(await readFile(loaded.contentFile, 'utf8'));
  if (includeDemo) {
    const fixture = await loadDemoContent();
    for (const key of ['entities', 'revisions', 'citations', 'links']) bundle[key] = [...fixture[key], ...bundle[key]];
  }
  return { ...loaded, bundle };
}

export function createStore({ business, config }) {
  return new RuntimeStore(':memory:', {
    communityId: config.communityId,
    modules: [
      { ...contentModule, initialState: () => contentModule.initialState({ profile: business.content }) },
      authModule,
      lifecycleModule,
      participantsModule,
      reportsModule,
      reviewRecords,
    ],
  });
}

export function publishDemo(store, bundle, now = initialTime) {
  store.transact(state => { state.modules.content = importContent(state.modules.content, bundle); });
  const types = new Map(store.read().modules.content.profile.entityTypes.map(type => [type.id, type.role]));
  const content = bundle.entities.filter(entity => types.get(entity.type) === 'content' && bundle.revisions.some(revision => revision.entityId === entity.id && revision.data.demo === true));
  for (const entity of content) {
    const revision = bundle.revisions.filter(item => item.entityId === entity.id).sort((a, b) => b.number - a.number)[0];
    store.transact(state => {
      const current = state.modules.content.entities.find(item => item.id === entity.id);
      state.modules.content = publishContent(state.modules.content, {
        entityId: entity.id,
        revisionId: revision.id,
        expectedVersion: current.version,
        now: new Date(now).toISOString(),
      });
    });
  }
  return content;
}

export async function readJson(response, expectedStatus = 200) {
  const value = await response.json();
  assert.equal(response.status, expectedStatus, JSON.stringify(value));
  return value;
}

export async function harness(t, options = {}) {
  const community = await loadCommunity({ includeDemo: options.includeDemo ?? true });
  community.business.research = structuredClone(syntheticResearch);
  const bundle = structuredClone(community.bundle);
  options.mutateBundle?.(bundle, community.business);
  const store = createStore(community);
  let now = initialTime;
  let requestNumber = 0;
  const { business } = community;
  const serverOptions = {
    store,
    auth: { mfaKey, participants: business.participants, rolePermissions: business.roles },
    lifecycle: { config: business.lifecycle, keyring },
    anonymousReports: business.anonymousReports,
    assets: options.assets,
    clock: () => now,
  };
  const catalog = JSON.parse(await readFile(join(communityRoot, business.catalogFile), 'utf8'));
  const server = options.guide
    ? (await import('../server/guide.mjs')).createGuideServer({
      store, business, catalog, mfaKey, keyring, clock: () => now, assets: options.assets,
      localPasswordOnly: options.localPasswordOnly ?? false,
    })
    : createRuntimeApp(serverOptions);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    store.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (path, token) => fetch(`${base}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const post = (path, input, token, key = `integration-request-${++requestNumber}`) => fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(key ? { 'idempotency-key': key } : {}),
    },
    body: JSON.stringify(input),
  });
  async function operator(roles = Object.keys(business.roles), id = 'integration-operator') {
    bootstrapAccount(store, {
      id, displayName: 'Integration Operator', roles, password, totpSecret,
    }, { now, mfaKey });
    return readJson(await post('/api/auth/login', {
      accountId: id, password, code: totpCode(totpSecret, now),
    }, undefined, null));
  }
  async function enroll(operatorToken, subjectId) {
    const workflow = business.lifecycle.workflows.question;
    const eligibility = Object.fromEntries((workflow.eligibilityFields ?? []).map(field => [field, true]));
    const invitation = await readJson(await post('/api/participants/invitations', {
      eligibility, ...(subjectId ? { subjectId } : {}),
    }, operatorToken));
    const session = await readJson(await post('/api/participants/redeem', { token: invitation.token }, undefined, null));
    return { invitation, ...session };
  }
  return {
    ...community, bundle, catalog, store, server, base, get, post, operator, enroll,
    time: () => now,
    setTime: value => { now = value; },
    publish: () => publishDemo(store, bundle, now),
  };
}
