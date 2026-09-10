import { randomUUID } from 'node:crypto';
import {
  RuntimeError, executeAuthorized, readAuthorized, appendAudit,
  encryptPrivatePayload, decryptPrivatePayload, importContent, publishContent, getEntity,
} from '@information-community/runtime';
import { reviewReason } from './content-review.mjs';
import { assertPublishedSupplements } from './supplements.mjs';

const decisions = ['approved', 'changes-requested', 'needs-verification', 'excluded'];
const itemFields = ['entityId', 'revisionId', 'expectedVersion', 'expectedReviewId', 'decision', 'reason'];
const isId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/u.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = () => { throw new RuntimeError('GUIDE_FIELD', '请核对文章、审核决定及版本字段。'); };
const conflict = () => { throw new RuntimeError('CONFLICT', '文章或审核记录已更新，请刷新后重新核对；本批未保存。', 409); };

function indexes(state, keyring) {
  const content = state.modules.content;
  const latest = new Map();
  for (const revision of content.revisions) {
    if (!latest.has(revision.entityId) || latest.get(revision.entityId).number < revision.number) latest.set(revision.entityId, revision);
  }
  const reviews = new Map(), reviewPayloads = new Map();
  const revisions = new Map(content.revisions.map(row => [row.id, row]));
  // Append order is authoritative, including when two reviews share a timestamp.
  for (const record of state.modules['guide-reviews'].records) {
    if (record.action !== 'content.review') continue;
    const payload = decryptPrivatePayload(record.id, record.payload, keyring);
    reviewPayloads.set(record.id, payload);
    reviews.set(record.revisionId, record);
    // A confirmation is an immutable child of the version the reviewer actually read.
    // Later unrelated revisions must start pending instead of inheriting this approval.
    const published = revisions.get(payload.outcome?.publishedRevisionId);
    if (payload.outcome?.decision === 'approved' && published?.entityId === record.entityId &&
        published.parentRevisionId === record.revisionId && published.data.reviewedFromRevisionId === record.revisionId) {
      reviews.set(published.id, record);
    }
  }
  return {
    latest, reviews, reviewPayloads,
    entities: new Map(content.entities.map(row => [row.id, row])),
    revisions,
    contentTypes: new Set(content.profile.entityTypes.filter(row => row.role === 'content').map(row => row.id)),
  };
}

function scopeLabel(scope, catalog, profile) {
  const dimensions = { campus: '校区', audience: '人群', academic_year: '学年' };
  return Object.entries(scope ?? {}).map(([dimension, codes]) => {
    const values = (Array.isArray(codes) ? codes : [codes]).map(code => {
      if (code === profile.scope.universal) return '不限';
      if (code === profile.scope.unknown) return '待核实';
      const entry = catalog?.scopes?.find(row => row.dimension === dimension && row.code === code);
      return entry?.labelZh ?? code;
    });
    return `${dimensions[dimension] ?? dimension}：${values.join('、')}`;
  }).join('；') || '适用范围待核实';
}

/** Drafts are available only to authenticated content readers; never use public projections here. */
export function readReviewArticles(store, token, options) {
  const { keyring, catalog, ...auth } = options;
  return readAuthorized(store, token, { ...auth, permission: 'content:read' }, (state, principal) => {
    const content = state.modules.content, index = indexes(state, keyring);
    const citations = new Map();
    for (const citation of content.citations) {
      const key = `${citation.revisionId}|${citation.sentenceId}`;
      if (!citations.has(key)) citations.set(key, []);
      citations.get(key).push(citation);
    }
    const articles = content.entities.filter(entity => index.contentTypes.has(entity.type) && index.latest.has(entity.id)).map(entity => {
      const revision = index.latest.get(entity.id), data = revision.data;
      const record = index.reviews.get(revision.id);
      const payload = record ? index.reviewPayloads.get(record.id) : null;
      return {
        entityId: entity.id, revisionId: revision.id, revisionNumber: revision.number, version: entity.version,
        title: data.title, summary: data.summary ?? '', topicId: data.topicId ?? entity.topicId ?? entity.extensions?.topicId ?? '',
        ...(Object.hasOwn(data, 'supplementTo') ? { supplement: {
          entityId: typeof data.supplementTo === 'string' ? data.supplementTo : '',
          title: index.latest.get(data.supplementTo)?.data.title ?? '未找到原陈述',
          publicRevisionId: index.entities.get(data.supplementTo)?.publicRevisionId ?? null,
          hidden: index.entities.get(data.supplementTo)?.hidden ?? false,
        } } : {}),
        scope: scopeLabel(data.scope, catalog, content.profile),
        origin: data.origin, demo: data.demo === true, impact: data.impact,
        originalOrigin: data.originalOrigin ?? data.origin, reviewedFromRevisionId: data.reviewedFromRevisionId ?? null,
        researchedAt: data.researchedAt ?? '', verifiedAt: data.verifiedAt ?? '', asOf: data.asOf ?? '',
        evidenceNote: data.evidenceNote ?? '', reviewDueAt: data.reviewDueAt ?? '', reviewOwnerLabel: data.reviewOwnerLabel ?? '',
        publicRevisionId: entity.publicRevisionId, hidden: entity.hidden,
        reviewStatus: payload?.outcome.decision ?? 'pending',
        latestReview: record ? {
          id: record.id, decision: payload.outcome.decision, reason: payload.reason,
          actorId: record.actorId, createdAt: record.createdAt,
          reviewedRevisionId: record.revisionId, publishedRevisionId: payload.outcome.publishedRevisionId ?? null,
        } : null,
        sentences: data.sentences.map(sentence => ({
          id: sentence.id, kind: sentence.kind, text: sentence.text,
          citations: (citations.get(`${revision.id}|${sentence.id}`) ?? []).sort((a, b) => a.order - b.order).map(citation => {
            const source = index.revisions.get(citation.sourceRevisionId), sourceEntity = index.entities.get(citation.sourceEntityId);
            return {
              sourceId: source.entityId, sourceRevisionId: source.id,
              title: source.data.title, url: source.data.url, publisher: source.data.publisher ?? '',
              accessedAt: source.data.accessedAt ?? '', mode: source.data.mode,
              locator: citation.position.kind === 'link' ? '原站链接' : `文字位置 ${citation.position.start}–${citation.position.end}`,
              sourceHidden: sourceEntity.hidden, sourceDisposition: sourceEntity.disposition,
            };
          }),
        })),
      };
    });
    appendAudit(state, principal, 'guide.review-articles.read', {}, auth.now);
    return { articles };
  });
}

function confirmationNote(originalOrigin, reviewedNote) {
  return `${originalOrigin === 'ai_draft' ? '本版基于 AI 初稿，由人工审核确认后发布。' : '本版由人工审核确认后发布。'}本次确认未改写正文。${reviewedNote ? `被审稿资料说明（原记录）：${reviewedNote}` : ''}`;
}

function confirmationRevision(original, principal, now) {
  const data = structuredClone(original.data), timestamp = new Date(now).toISOString();
  const originalOrigin = data.originalOrigin ?? data.origin;
  const originalEvidenceNote = data.originalEvidenceNote ?? data.evidenceNote ?? '';
  const previousNote = data.reviewedEvidenceNote ?? originalEvidenceNote;
  // Remove our own unchanged wrapper, but retain any source limitations the editor
  // added to the version they are now approving, even if it inherited root metadata.
  const reviewedEvidenceNote = data.reviewedFromRevisionId && data.evidenceNote === confirmationNote(originalOrigin, previousNote)
    ? previousNote : data.evidenceNote ?? '';
  // Keep the existing maintenance cadence after a fresh human review, bounded to 1–90 days.
  const previousCheck = Date.parse(data.verifiedAt || data.researchedAt || data.asOf || original.createdAt);
  const interval = Date.parse(data.reviewDueAt) - previousCheck;
  const reviewInterval = Number.isFinite(interval) && interval > 0
    ? Math.min(90 * 86400000, Math.max(86400000, interval)) : 30 * 86400000;
  Object.assign(data, {
    origin: 'human', originalOrigin, reviewedFromRevisionId: original.id,
    verifiedAt: timestamp, reviewOwnerId: principal.id, reviewOwnerLabel: principal.displayName ?? principal.id,
    reviewDueAt: new Date(now + reviewInterval).toISOString(), reviewStatus: 'approved',
    originalEvidenceNote, reviewedEvidenceNote,
    evidenceNote: confirmationNote(originalOrigin, reviewedEvidenceNote),
  });
  return {
    id: `reviewed-${randomUUID()}`, entityId: original.entityId, number: original.number + 1,
    parentRevisionId: original.id, createdAt: timestamp, data,
  };
}

/** One atomic, replayable batch: human approvals create confirmed revisions and publish them. */
export function submitArticleReviews(store, token, input, options) {
  const { keyring, ...auth } = options;
  return executeAuthorized(store, token, { ...auth, permission: 'content:publish', action: 'guide.reviews.batch.v2', input }, (state, principal) => {
    if (!auth.key) throw new RuntimeError('IDEMPOTENCY_KEY_REQUIRED', '写入需要幂等键。');
    if (!object(input)) invalid();
    // Old open tabs meant “save only”. They must reload before authorizing publication.
    if (input.mode !== 'review-and-publish') throw new RuntimeError('GUIDE_REVIEW_MODE', '审核流程已更新为通过并发布，请重新加载工作台后提交。');
    if (Object.keys(input).length !== 2 || !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100) invalid();
    const index = indexes(state, keyring), seen = new Set();
    const checked = input.items.map(item => {
      if (!object(item) || Object.keys(item).length !== itemFields.length || itemFields.some(field => !Object.hasOwn(item, field)) ||
          !isId(item.entityId) || !isId(item.revisionId) || seen.has(item.entityId) ||
          !Number.isSafeInteger(item.expectedVersion) || item.expectedVersion < 0 ||
          !(item.expectedReviewId === null || isId(item.expectedReviewId)) || !decisions.includes(item.decision)) invalid();
      seen.add(item.entityId);
      const reason = reviewReason(item.reason);
      const entity = index.entities.get(item.entityId), revision = index.revisions.get(item.revisionId);
      if (!entity || !index.contentTypes.has(entity.type) || !revision || revision.entityId !== entity.id) invalid();
      if (index.latest.get(entity.id).id !== revision.id || entity.version !== item.expectedVersion ||
          (index.reviews.get(revision.id)?.id ?? null) !== item.expectedReviewId) conflict();
      if (item.decision === 'approved' && entity.hidden) throw new RuntimeError('CONTENT_HIDDEN', '文章已隐藏，请先处理可见性再审核发布；本批未保存。', 422);
      return { ...item, reason };
    });
    const batchId = randomUUID();
    const confirmations = new Map(checked.filter(item => item.decision === 'approved').map(item => [
      item.entityId, confirmationRevision(index.revisions.get(item.revisionId), principal, auth.now),
    ]));
    if (confirmations.size) {
      const sources = new Map([...confirmations.values()].map(revision => [revision.parentRevisionId, revision]));
      const citations = state.modules.content.citations.filter(citation => sources.has(citation.revisionId)).map(citation => ({
        ...structuredClone(citation), id: `citation-${randomUUID()}`, revisionId: sources.get(citation.revisionId).id,
      }));
      state.modules.content = importContent(state.modules.content, {
        schemaVersion: 1, entities: [], revisions: [...confirmations.values()], citations, links: [],
      });
    }
    const records = checked.map(item => {
      const reviewId = randomUUID();
      const publishedRevisionId = confirmations.get(item.entityId)?.id ?? null;
      if (publishedRevisionId) {
        state.modules.content = publishContent(state.modules.content, {
          entityId: item.entityId, revisionId: publishedRevisionId, expectedVersion: item.expectedVersion,
          now: new Date(auth.now).toISOString(),
        });
        appendAudit(state, principal, 'content.publish', { entityId: item.entityId }, auth.now);
      }
      const entity = getEntity(state.modules.content, item.entityId);
      state.modules['guide-reviews'].records.push({
        id: reviewId, actorId: principal.id, action: 'content.review',
        entityId: item.entityId, revisionId: item.revisionId, version: item.expectedVersion, createdAt: auth.now,
        payload: encryptPrivatePayload(reviewId, { reason: item.reason, outcome: { decision: item.decision, batchId, publishedRevisionId } }, keyring),
      });
      appendAudit(state, principal, 'content.review', { entityId: item.entityId }, auth.now);
      return {
        entityId: item.entityId, revisionId: item.revisionId, reviewId, decision: item.decision,
        publicRevisionId: entity.publicRevisionId, publishedRevisionId, version: entity.version,
      };
    });
    if (confirmations.size) assertPublishedSupplements(state.modules.content, [...confirmations.keys()]);
    return { batchId, records, count: records.length, publishedCount: confirmations.size };
  });
}
