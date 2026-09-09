import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RuntimeError, openRuntime, appendAudit, decryptPrivatePayload, lifecycleRecordSummary,
} from '@information-community/runtime';
import { researchWindow, researchTimestamp, QUERY_LENGTH_BANDS, FEEDBACK_OUTCOMES } from '../server/business-validation.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:@-]{0,119}$/u.test(value);
const fields = {
  query: ['batchId', 'kind', 'queryLengthBand'],
  open: ['batchId', 'kind', 'queryEventId', 'revisionId'],
  share: ['batchId', 'kind', 'queryEventId', 'revisionId'],
  feedback: ['batchId', 'kind', 'queryEventId', 'revisionId', 'outcome'],
};
const fail = (code, message) => { throw new RuntimeError(code, message); };

function reportWindow(config, from, to) {
  const window = researchWindow(config);
  if ((from === undefined) !== (to === undefined)) fail('RESEARCH_WINDOW', 'Report --from and --to must be supplied together.');
  const startAt = from === undefined ? window.startAt : researchTimestamp(from);
  const endAt = to === undefined ? window.endAt : researchTimestamp(to);
  if (startAt < window.startAt || endAt > window.endAt || endAt <= startAt) fail('RESEARCH_WINDOW', 'The report interval must stay within the configured batch window.');
  return { ...window, startAt, endAt };
}

function eventPayload(value, batchId) {
  const data = value?.data;
  if (!object(data) || data.batchId !== batchId || !Object.hasOwn(fields, data.kind) ||
      Object.keys(data).some(key => !fields[data.kind].includes(key)) || fields[data.kind].some(key => !Object.hasOwn(data, key))) return null;
  if (data.kind === 'query') return QUERY_LENGTH_BANDS.includes(data.queryLengthBand) ? data : null;
  if (!identifier(data.queryEventId) || !identifier(data.revisionId) ||
      (data.kind === 'feedback' && !FEEDBACK_OUTCOMES.includes(data.outcome))) return null;
  return data;
}

/** Host access authorizes this offline command; the named operator is audited before disclosure. */
export function readResearchReport(store, { business, keyring, operatorId, now = Date.now(), from, to } = {}) {
  if (!identifier(operatorId)) fail('OFFLINE_OPERATOR_REQUIRED', 'Set RUNTIME_OPERATOR_ID to the reviewed operator identity.');
  if (!Number.isSafeInteger(now) || now < 0) fail('RESEARCH_WINDOW', 'The report time is invalid.');
  const window = reportWindow(business.research, from, to);
  return store.transact(state => {
    const events = [];
    for (const record of Object.values(state.modules.lifecycle.records)) {
      const participant = state.modules.participants.subjects.find(subject => subject.id === record.subjectId);
      if (record.type !== 'research_event' || record.createdAt < window.startAt || record.createdAt >= window.endAt || record.createdAt > now ||
          !participant || participant.revokedAt !== null || (business.lifecycle.workflows.research_event.eligibilityFields ?? []).some(field => participant.eligibility[field] !== true) ||
          !lifecycleRecordSummary(state, record.id, { config: business.lifecycle, now })) continue;
      const data = eventPayload(decryptPrivatePayload(record.id, record.payload, keyring), window.batchId);
      if (data) events.push({ record, data });
    }
    const queries = new Map(events.filter(event => event.data.kind === 'query').map(event => [event.record.id, event]));
    const lengths = Object.fromEntries(QUERY_LENGTH_BANDS.map(band => [band, 0]));
    for (const query of queries.values()) lengths[query.data.queryLengthBand]++;
    const revisionIds = new Set(state.modules.content.revisions.filter(revision =>
      state.modules.content.entities.some(entity => entity.id === revision.entityId && entity.type === 'answer')).map(revision => revision.id));
    const related = events.filter(event => {
      const query = queries.get(event.data.queryEventId);
      return query && event.record.subjectId === query.record.subjectId && event.record.createdAt >= query.record.createdAt && revisionIds.has(event.data.revisionId);
    });
    const opened = new Map(), openedQueries = new Set();
    const pair = data => `${data.queryEventId}\0${data.revisionId}`;
    for (const { record, data } of related) if (data.kind === 'open') {
      openedQueries.add(data.queryEventId);
      const id = pair(data);
      opened.set(id, Math.min(opened.get(id) ?? Infinity, record.createdAt));
    }
    const shared = new Set(), feedback = new Set(), resolved = new Set(), unclear = new Set();
    for (const { record, data } of related) {
      if ((opened.get(pair(data)) ?? Infinity) > record.createdAt) continue;
      if (data.kind === 'share') shared.add(data.queryEventId);
      if (data.kind === 'feedback') {
        feedback.add(data.queryEventId);
        (data.outcome === 'resolved' ? resolved : unclear).add(data.queryEventId);
      }
    }
    const report = {
      schemaVersion: 1, batchId: window.batchId,
      window: { from: new Date(window.startAt).toISOString(), to: new Date(window.endAt).toISOString(), endExclusive: true, observedAt: new Date(now).toISOString(), closed: now >= window.endAt },
      counts: { queries: queries.size, openedQueries: openedQueries.size, sharedQueries: shared.size,
        feedbackQueries: feedback.size, resolvedQueries: resolved.size, unclearQueries: unclear.size, unansweredQueries: queries.size - feedback.size },
      queryLengthBands: lengths,
    };
    appendAudit(state, { id: operatorId, sessionId: null }, 'guide.research.report', {}, now);
    return report;
  });
}

export async function main(args = process.argv.slice(2), env = process.env) {
  if (!identifier(env.RUNTIME_OPERATOR_ID)) fail('OFFLINE_OPERATOR_REQUIRED', 'Set RUNTIME_OPERATOR_ID to the reviewed operator identity.');
  const flags = new Map();
  for (let index = 0; index < args.length; index += 2) {
    if (!['--from', '--to'].includes(args[index]) || !args[index + 1] || flags.has(args[index])) fail('USAGE', 'Usage: research-report [--from ZONED_ISO --to ZONED_ISO]');
    flags.set(args[index], args[index + 1]);
  }
  if (flags.size === 1) fail('RESEARCH_WINDOW', 'Report --from and --to must be supplied together.');
  let keyring;
  try { keyring = JSON.parse(env.RUNTIME_KEYRING); } catch { fail('KEYRING_REQUIRED', 'Set RUNTIME_KEYRING using the private runtime keyring.'); }
  if (!object(keyring) || !object(keyring.keys)) fail('KEYRING_REQUIRED', 'Set RUNTIME_KEYRING using the private runtime keyring.');
  const runtime = await openRuntime({ root: resolve(env.GUIDE_ROOT ?? 'community'), configFile: env.RUNTIME_CONFIG ?? 'runtime.config.json', seed: false });
  try {
    return readResearchReport(runtime.store, { business: runtime.business, keyring, operatorId: env.RUNTIME_OPERATOR_ID, from: flags.get('--from'), to: flags.get('--to') });
  } finally { runtime.store.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await main(), null, 2)); }
  catch (error) { console.error(`${error.code ?? 'RESEARCH_REPORT_FAILED'}: ${error instanceof RuntimeError ? error.message : 'Research report failed; private data omitted.'}`); process.exitCode = 1; }
}
