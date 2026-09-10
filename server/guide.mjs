import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  openRuntime, buildRuntime, createRuntimeApp, RuntimeError, projectPublic,
  readPublicRevision, readRevision, executeAuthorized, assertParticipantOperation,
  lifecycleCommand, issueParticipantInvitation, submitAnonymousReport, readAuthorized,
} from '@information-community/runtime';
import { reviewContent, readReviews } from './content-review.mjs';
import { readReviewArticles, submitArticleReviews } from './article-review.mjs';
import { validateGuideCreate, validateGuideAnonymousReport, validateGuideTransition, researchAvailability } from './business-validation.mjs';

const fail = (code, message, status = 400) => { throw new RuntimeError(code, message, status); };
const jsonFile = async path => JSON.parse(await readFile(path, 'utf8'));
const tokenOf = req => req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
const send = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
};
async function bodyOf(req, maxBytes = 32768) {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) fail('UNSUPPORTED_MEDIA_TYPE', '需要 JSON 请求。', 415);
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) fail('PAYLOAD_TOO_LARGE', '请求过大。', 413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { fail('INVALID_JSON', '需要 JSON 对象。'); }
}
/** Visibility stays in the platform. Only business-owned display fields are added. */
export function guideAnswer(state, node, catalog) {
  const entity = state.modules.content.entities.find(item => item.id === node.id);
  const data = state.modules.content.revisions.find(item => item.id === node.revisionId).data;
  const topic = catalog.topics.find(item => item.id === (data.topicId ?? entity.topicId ?? entity.extensions?.topicId));
  const dispute = { reported: '该答案收到争议报告，正在复核，请对照原始来源。', confirmed: '该答案存在已确认的争议，请勿据此单独作出决定。' }[data.disputeStatus];
  return {
    ...node, slug: data.slug ?? entity.slug ?? entity.extensions?.slug ?? entity.id, demo: data.demo === true,
    warnings: [...node.warnings, ...(dispute ? [dispute] : [])],
    summary: data.summary ?? '', asOf: data.asOf ?? null,
    verifiedAt: data.verifiedAt ?? null, reviewDueAt: data.reviewDueAt ?? null,
    reviewOwnerLabel: data.reviewOwnerLabel ?? '', disputeStatus: data.disputeStatus ?? 'none',
    evidenceNote: data.evidenceNote ?? null,
    topic: topic ? { id: topic.id, slug: topic.slug, title: topic.titleZh ?? topic.title_zh ?? topic.title } : null,
  };
}
export function createGuideServer({ store, business, catalog, keyring, mfaKey, assets = {}, clock = Date.now, provider }) {
  const policy = business.roles;
  const lifecycle = { config: business.lifecycle, keyring, participants: business.participants, provider, policy };
  const app = createRuntimeApp({ store, auth: { mfaKey, rolePermissions: policy, participants: business.participants, provider }, lifecycle, anonymousReports: business.anonymousReports, assets, clock });
  const native = app.listeners('request')[0];
  app.removeListener('request', native);
  app.on('request', async (req, res) => {
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const url = new URL(req.url, 'http://guide.local'), path = url.pathname;
      if (req.method === 'POST' && (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host))) fail('ORIGIN_REJECTED', '请从本站提交。', 403);
      if (req.method === 'GET' && path === '/api/guide/catalog') return send(res, 200, catalog);
      if (req.method === 'GET' && path === '/api/guide/notice') return send(res, 200, {
        ...(business.guide?.notice ?? catalog.notice ?? {}), research: researchAvailability(business.research, clock()),
      });
      if (req.method === 'GET' && path === '/api/guide/editor-config') {
        const result = readAuthorized(store, tokenOf(req), { permission: ['content:read', 'lifecycle:manage'], policy, provider, participantsConfig: business.participants, now: clock() }, (state, principal) => ({
          workflows: business.lifecycle.workflows,
          permissions: [...new Set(principal.roles.flatMap(role => policy[role] ?? []))],
        }));
        return send(res, 200, result);
      }
      if (req.method === 'POST' && /^\/api\/content\/(publish|hide|source)$/u.test(path)) {
        const input = await bodyOf(req), now = clock();
        return send(res, 200, reviewContent(store, tokenOf(req), path.split('/').at(-1), input, {
          policy, provider, participantsConfig: business.participants, keyring, now, key: req.headers['idempotency-key'],
        }));
      }
      if (req.method === 'GET' && path === '/api/guide/review-articles') return send(res, 200, readReviewArticles(store, tokenOf(req), {
        policy, provider, participantsConfig: business.participants, keyring, catalog, now: clock(),
      }));
      if (req.method === 'POST' && path === '/api/guide/reviews/batch') {
        const input = await bodyOf(req, 524288);
        return send(res, 200, submitArticleReviews(store, tokenOf(req), input, {
          policy, provider, participantsConfig: business.participants, keyring, now: clock(), key: req.headers['idempotency-key'],
        }));
      }
      if (req.method === 'GET' && path === '/api/guide/reviews') return send(res, 200, readReviews(store, tokenOf(req), url.searchParams.get('entityId'), {
        policy, provider, participantsConfig: business.participants, keyring, now: clock(),
      }));
      if (req.method === 'GET' && path === '/api/guide/answers') {
        let scope = {};
        try { scope = JSON.parse(url.searchParams.get('scope') ?? '{}'); } catch { fail('INVALID_SCOPE', '范围无效。'); }
        const state = store.read();
        const graph = projectPublic(state.modules.content, { query: url.searchParams.get('q') ?? '', scope, now: new Date(clock()).toISOString() });
        return send(res, 200, graph.nodes.map(node => guideAnswer(state, node, catalog)));
      }
      if (req.method === 'GET' && path.startsWith('/api/guide/answers/')) {
        const slug = decodeURIComponent(path.slice('/api/guide/answers/'.length));
        const state = store.read(), content = state.modules.content;
        const entity = content.entities.find(item => item.slug === slug || item.extensions?.slug === slug || item.id === slug || content.revisions.some(revision => revision.entityId === item.id && revision.data.slug === slug));
        let id = url.searchParams.get('revision') ?? entity?.publicRevisionId;
        if (/^\d+$/u.test(id ?? '')) id = content.revisions.find(item => item.entityId === entity?.id && item.number === Number(id))?.id;
        const node = id && readPublicRevision(content, id, { now: new Date(clock()).toISOString() });
        if (!node || node.id !== entity?.id) fail('NOT_FOUND', '答案目前不可公开。', 404);
        const history = content.revisions.filter(item => item.entityId === entity.id)
          .map(item => readPublicRevision(content, item.id, { now: new Date(clock()).toISOString() }))
          .filter(Boolean).map(item => ({ id: item.revisionId, number: item.revisionNumber, title: item.title }));
        return send(res, 200, { ...guideAnswer(state, node, catalog), history });
      }
      if (req.method === 'POST' && path === '/api/guide/invitations') {
        const input = await bodyOf(req), now = clock();
        if (input.eligibility?.adult !== true || input.eligibility?.eligible !== true) fail('INELIGIBLE', '签发前需要完成成年及参与资格核验。', 403);
        const result = executeAuthorized(store, tokenOf(req), { permission: 'guide:participants:manage', action: 'guide.invitation', input, policy, provider, participantsConfig: business.participants, now }, state => issueParticipantInvitation(state, input, { config: business.participants, now }));
        return send(res, 201, result);
      }
      if (req.method === 'POST' && path === '/api/reports') {
        const input = await bodyOf(req), now = clock();
        // Validate the campus target in the same transaction opened by the SDK.
        const checkedStore = { transact: handler => store.transact(state => {
          validateGuideAnonymousReport(input, { state, now });
          return handler(state);
        }) };
        return send(res, 201, submitAnonymousReport(checkedStore, input, { config: business.anonymousReports, lifecycle, key: req.headers['idempotency-key'], now }));
      }
      if (req.method === 'POST' && path === '/api/private/command') {
        const input = await bodyOf(req), now = clock();
        const commandInput = input.action === 'create' && input.type === 'research_event'
          ? { ...input, payload: { ...input.payload, batchId: business.research?.batchId ?? null } } : input;
        const self = ['create', 'consent', 'withdraw', 'logout'].includes(input.action);
        if (!self && !['transition', 'retain'].includes(input.action)) fail('GUIDE_ACTION', '此操作仅通过离线运行工具执行。', 403);
        const permission = self ? ['lifecycle:self', 'lifecycle:manage'] : input.action === 'retain' ? 'operations:manage' : 'lifecycle:manage';
        const key = ['withdraw', 'logout'].includes(input.action) ? null : req.headers['idempotency-key'];
        if (key === undefined) fail('IDEMPOTENCY_KEY_REQUIRED', '写入需要幂等键。');
        const result = executeAuthorized(store, tokenOf(req), {
          permission, action: `private.${input.action}`, key, input: commandInput, policy, provider, participantsConfig: business.participants,
          now, audit: false, assurance: self ? 'invitation' : undefined,
          authorize: (principal, state) => {
            if (self) assertParticipantOperation(principal, input, business.participants);
            if (input.action === 'create') validateGuideCreate(input, { state, principal, business, keyring, now });
          },
        }, (state, principal) => {
          if (input.action === 'transition') {
            const command = validateGuideTransition(input, { state, now });
            if (command.entityId !== undefined) {
              const record = state.modules.lifecycle.records[command.id];
              record.entityId = command.entityId;
              if (command.revisionId !== undefined) record.revisionId = command.revisionId;
            }
            return lifecycleCommand(state, principal, command, { ...lifecycle, now });
          }
          return lifecycleCommand(state, principal, commandInput, { ...lifecycle, now });
        });
        return send(res, 200, result);
      }
      if (req.method === 'GET' && /^\/answers\/[^/]+(?:\/versions\/[^/]+)?$/u.test(path) && assets['/']) req.url = '/';
      return native(req, res);
    } catch (error) {
      if (!res.headersSent) send(res, error instanceof RuntimeError ? error.status : 500, { code: error instanceof RuntimeError ? error.code : 'INTERNAL_ERROR', error: error instanceof RuntimeError ? error.message : '服务器内部错误。' });
      else res.end();
    }
  });
  return app;
}

export async function startGuide({ root = resolve(process.env.GUIDE_ROOT ?? 'community'), configFile = 'runtime.config.json', env = process.env, port = Number(env.PORT ?? 4317), host = env.HOST ?? '127.0.0.1' } = {}) {
  let incomplete = false;
  try { await access(resolve(root, '.migration-incomplete')); incomplete = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (incomplete) throw new Error('Migration is incomplete; resolve the failed restore before starting this community.');
  if (!/^[a-f\d]{64}$/iu.test(env.RUNTIME_MFA_KEY ?? '') || !env.RUNTIME_KEYRING) throw new Error('Set RUNTIME_MFA_KEY and RUNTIME_KEYRING; use npm run dev for an isolated local demo.');
  const runtime = await openRuntime({ root, configFile });
  try {
    const catalog = await jsonFile(resolve(root, 'catalog.json'));
    runtime.business.guide = { notice: await jsonFile(resolve(root, runtime.business.consentFile ?? 'consent.json')) };
    const { assets } = await buildRuntime(runtime);
    assets['/runtime-editor'] = assets['/'];
    assets['/editor'] = assets['/extensions/editor.html'] ?? assets['/'];
    if (assets['/extensions/index.html']) {
      assets['/'] = assets['/extensions/index.html'];
      for (const path of ['/about', '/participate', '/report']) assets[path] = assets['/'];
    }
    const app = createGuideServer({ store: runtime.store, business: runtime.business, catalog, keyring: JSON.parse(env.RUNTIME_KEYRING), mfaKey: env.RUNTIME_MFA_KEY, assets, provider: runtime.identityProvider });
    await new Promise((accept, reject) => { app.once('error', reject); app.listen(port, host, accept); });
    const timer = setInterval(() => {
      try {
        runtime.store.transact(state => lifecycleCommand(state, { id: 'system:maintenance', mfa: true, roles: ['maintenance'] }, { action: 'retain' }, {
          config: runtime.business.lifecycle, keyring: JSON.parse(env.RUNTIME_KEYRING), provider: runtime.identityProvider,
          policy: { maintenance: ['operations:manage'] },
        }));
      } catch (error) { console.error(`Maintenance failed: ${error.code ?? 'INTERNAL_ERROR'}`); }
    }, runtime.config.maintenanceIntervalMs ?? 60000);
    timer.unref();
    app.once('close', () => { clearInterval(timer); runtime.store.close(); });
    console.log(`Guide listening at http://${host}:${app.address().port}`);
    return app;
  } catch (error) { runtime.store.close(); throw error; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await startGuide();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { app.close(); app.closeIdleConnections(); });
}
