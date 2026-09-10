import { randomUUID } from 'node:crypto';
import {
  RuntimeError, executeAuthorized, readAuthorized, appendAudit,
  publishContent, hideContent, setSourceDisposition, getEntity, encryptPrivatePayload, decryptPrivatePayload,
} from '@information-community/runtime';
import { containsLikelyPersonalData } from './business-validation.mjs';

export function reviewReason(value) {
  const reason = typeof value === 'string' ? value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/gu, ' ').trim() : '';
  if (reason.length < 8 || reason.length > 400) throw new RuntimeError('GUIDE_REASON', '审核理由需要 8 至 400 字。');
  if (containsLikelyPersonalData(reason)) throw new RuntimeError('PERSONAL_DATA', '审核理由不得包含邮箱、电话、学号或证件号。');
  return reason;
}

export function recordReview(state, principal, { action, entity, reason, now, keyring }) {
  const recordId = randomUUID();
  state.modules['guide-reviews'].records.push({
    id: recordId, actorId: principal.id, action, entityId: entity.id,
    revisionId: entity.publicRevisionId ?? null, version: entity.version, createdAt: now,
    payload: encryptPrivatePayload(recordId, { reason, outcome: {
      hidden: entity.hidden, disposition: entity.disposition,
      publicRevisionId: entity.publicRevisionId ?? null,
    } }, keyring),
  });
  return recordId;
}

function reviewHistory(state, entityId, keyring) {
  return state.modules['guide-reviews'].records.filter(row => row.entityId === entityId).map(({ payload, ...row }) => ({
    ...row, ...decryptPrivatePayload(row.id, payload, keyring),
  }));
}

const commands = {
  publish: ['content:publish', publishContent, ['entityId', 'revisionId', 'expectedVersion', 'reason']],
  hide: ['content:visibility', hideContent, ['entityId', 'expectedVersion', 'hidden', 'reason']],
  source: ['content:visibility', setSourceDisposition, ['entityId', 'expectedVersion', 'disposition', 'reason']],
};
export function reviewContent(store, token, command, input, options) {
  const [permission, apply, fields] = commands[command];
  const { keyring, ...auth } = options;
  return executeAuthorized(store, token, { ...auth, permission, action: `content.${command}`, input }, (state, principal) => {
    if (Object.keys(input).some(field => !fields.includes(field))) throw new RuntimeError('GUIDE_FIELD', '不支持的审核字段。');
    if (!auth.key) throw new RuntimeError('IDEMPOTENCY_KEY_REQUIRED', '写入需要幂等键。');
    const reason = reviewReason(input.reason);
    const { reason: omitted, ...operation } = input;
    state.modules.content = apply(state.modules.content, { ...operation, now: new Date(auth.now).toISOString() });
    const entity = getEntity(state.modules.content, input.entityId);
    const reviewId = recordReview(state, principal, { action: `content.${command}`, entity, reason, now: auth.now, keyring });
    return { entityId: entity.id, version: entity.version, publicRevisionId: entity.publicRevisionId ?? null, reviewId };
  });
}

export function readReviews(store, token, entityId, options) {
  const { keyring, ...auth } = options;
  return readAuthorized(store, token, { ...auth, permission: ['content:read', 'content:visibility'] }, (state, principal) => {
    const records = reviewHistory(state, entityId, keyring);
    appendAudit(state, principal, 'guide.reviews.read', { entityId }, auth.now);
    return records;
  });
}
