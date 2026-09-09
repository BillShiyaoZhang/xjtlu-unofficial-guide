import {
  RuntimeError, readPublicRevision, readRevision, lifecycleRecordSummary, decryptPrivatePayload,
} from '@information-community/runtime';

const fail = (code, message, status = 400) => { throw new RuntimeError(code, message, status); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/u.test(value);
export const MATERIAL_RELATIONS = Object.freeze(['original_author', 'reteller', 'lead_only']);
export const RESEARCH_KINDS = Object.freeze(['query', 'open', 'share', 'feedback']);
export const QUERY_LENGTH_BANDS = Object.freeze(['short', 'medium', 'long']);
export const FEEDBACK_OUTCOMES = Object.freeze(['resolved', 'unclear']);
const REPORT_TYPES = ['stale', 'source_mismatch', 'scope_error'];
const REPORT_AREAS = ['home', 'search', 'topics', 'pilot', 'intake', 'reporting', 'other'];

export function researchTimestamp(value) {
  const match = typeof value === 'string' && value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/u);
  if (!match) fail('RESEARCH_WINDOW', '研究窗口必须使用带时区的 ISO 时间。');
  const local = `${match[1]}T${match[2]}:${match[3]}:${match[4] ?? '00'}`;
  const calendar = Date.parse(local + 'Z'), timestamp = Date.parse(value);
  if (!Number.isFinite(calendar) || !Number.isFinite(timestamp) || new Date(calendar).toISOString().slice(0, 19) !== local) fail('RESEARCH_WINDOW', '研究窗口时间无效。');
  return timestamp;
}

export function researchWindow(config) {
  if (!object(config) || typeof config.enabled !== 'boolean' || !identifier(config.batchId) ||
      Object.keys(config).some(key => !['enabled', 'batchId', 'startAt', 'endAt'].includes(key))) fail('RESEARCH_WINDOW', '研究批次配置无效。');
  const startAt = researchTimestamp(config.startAt), endAt = researchTimestamp(config.endAt);
  if (endAt <= startAt) fail('RESEARCH_WINDOW', '研究窗口结束必须晚于开始。');
  return { batchId: config.batchId, startAt, endAt };
}

export function researchAvailability(config, now = Date.now()) {
  if (config?.enabled !== true) return { enabled: false, active: false };
  const window = researchWindow(config);
  return { enabled: true, active: now >= window.startAt && now < window.endAt, batchId: window.batchId,
    startAt: new Date(window.startAt).toISOString(), endAt: new Date(window.endAt).toISOString() };
}

function activeResearchWindow(options) {
  if (options.business?.research?.enabled !== true) fail('RESEARCH_DISABLED', '本批次研究记录尚未启用。', 403);
  const window = researchWindow(options.business.research);
  if (!Number.isSafeInteger(options.now)) fail('RESEARCH_WINDOW', '研究记录时间无效。');
  if (options.now < window.startAt || options.now >= window.endAt) fail('RESEARCH_WINDOW_CLOSED', '当前不在本批次研究记录窗口内。', 403);
  return window;
}

function exact(value, fields) {
  if (!object(value) || Object.keys(value).some(key => !fields.includes(key))) fail('GUIDE_FIELD', '不支持的提交类型或字段。');
}
function text(value, label, max, min = 0) {
  if (value === undefined && min === 0) return;
  if (typeof value !== 'string' || value.length > max || value.trim().length < min) fail('GUIDE_FIELD', `${label}无效。`);
}
function choice(value, values, label) {
  if (!values.includes(value)) fail('GUIDE_FIELD', `${label}无效。`);
}

/** Campus intake policy retained from the legacy domain, not a network fetcher. */
export function isSafePublicUrl(value) {
  let url;
  try { url = new URL(value); } catch { return false; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/gu, '').replace(/\.$/u, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (!host.includes('.') && !host.includes(':')) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host)) return !privateIpv4(host);
  if (!host.includes(':')) return true;
  if (host === '::' || host === '::1') return false;
  const first = Number.parseInt(host.split(':')[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00) return false;
  const mapped = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u);
  if (mapped) {
    const high = Number.parseInt(mapped[1], 16), low = Number.parseInt(mapped[2], 16);
    return !privateIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  return true;
}
function privateIpv4(host) {
  const octets = host.split('.').map(Number), [first, second] = octets;
  return octets.some(octet => octet > 255) || first === 0 || first === 10 || first === 127 ||
    (first === 100 && second >= 64 && second <= 127) || (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) || first >= 224;
}
export function containsLikelyPersonalData(value) {
  return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.test(value) ||
    /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/u.test(value) ||
    /(?<!\d)\d{8,12}(?!\d)/u.test(value) || /(?<!\d)\d{17}[\dXx](?!\d)/u.test(value);
}
function decodedUrl(value = '') {
  let decoded = value.replaceAll('+', ' ');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      if (attempt === 0) fail('GUIDE_FIELD', '来源地址编码无效。');
      break;
    }
  }
  return decoded;
}
function publicAnswer(state, { cardId, revisionId }, now) {
  if ((cardId !== undefined && !identifier(cardId)) || (revisionId !== undefined && !identifier(revisionId))) fail('GUIDE_FIELD', '答案标识无效。');
  const entity = cardId === undefined ? null : state.modules.content.entities.find(item => item.id === cardId);
  const id = revisionId ?? entity?.publicRevisionId;
  const node = id && readPublicRevision(state.modules.content, id, { now: new Date(now).toISOString() });
  if (!node || node.type !== 'answer' || (cardId !== undefined && node.id !== cardId)) fail('NOT_FOUND', '答案目前不可公开。', 404);
  return node;
}

function ownedEvent(state, id, principal, options, required = true) {
  if (!identifier(id)) fail('GUIDE_FIELD', '查询上下文标识无效。');
  const record = state.modules.lifecycle.records[id];
  if (!record || record.type !== 'research_event' || record.subjectId !== principal.id ||
    !lifecycleRecordSummary(state, id, { config: options.business.lifecycle, now: options.now })) {
    if (!required) return null;
    fail('QUERY_CONTEXT_UNAVAILABLE', '该查询上下文已失效或不属于当前参与者。', 403);
  }
  const payload = decryptPrivatePayload(id, record.payload, options.keyring);
  return object(payload?.data) ? payload.data : null;
}
function ownedQuery(state, id, principal, options) {
  const event = ownedEvent(state, id, principal, options);
  if (event?.kind !== 'query') fail('QUERY_CONTEXT_UNAVAILABLE', '该记录不是可用的查询上下文。', 403);
  return event;
}
function validateResearchEvent(input, options) {
  const { state, principal, now } = options, payload = input.payload;
  choice(payload.kind, RESEARCH_KINDS, '交互类型');
  if (input.id !== undefined) fail('GUIDE_FIELD', '研究事件编号由平台生成。');
  if (payload.kind === 'query') {
    exact(payload, ['kind', 'queryLengthBand']);
    choice(payload.queryLengthBand, QUERY_LENGTH_BANDS, '查询长度档');
    activeResearchWindow(options);
    return;
  }
  exact(payload, payload.kind === 'feedback' ? ['kind', 'queryEventId', 'revisionId', 'outcome'] : ['kind', 'queryEventId', 'revisionId']);
  const window = activeResearchWindow(options);
  const query = ownedQuery(state, payload.queryEventId, principal, options);
  const queryRecord = state.modules.lifecycle.records[payload.queryEventId];
  if (query.batchId !== window.batchId || queryRecord.createdAt < window.startAt || queryRecord.createdAt >= window.endAt) fail('QUERY_CONTEXT_UNAVAILABLE', '查询不属于当前研究批次。', 403);
  if (!identifier(payload.revisionId)) fail('GUIDE_FIELD', '答案版本无效。');
  publicAnswer(state, { revisionId: payload.revisionId }, now);
  if (payload.kind === 'feedback') choice(payload.outcome, FEEDBACK_OUTCOMES, '反馈结果');
  if (['share', 'feedback'].includes(payload.kind)) {
    const opened = Object.values(state.modules.lifecycle.records).some(record => {
      if (record.type !== 'research_event' || record.subjectId !== principal.id) return false;
      const event = ownedEvent(state, record.id, principal, options, false);
      return event?.kind === 'open' && event.batchId === window.batchId && event.queryEventId === payload.queryEventId && event.revisionId === payload.revisionId && record.createdAt >= window.startAt && record.createdAt < window.endAt;
    });
    if (!opened) fail('ANSWER_NOT_OPENED', '请先从本次查询打开该答案。', 403);
  }
}

/** Run after platform authentication, inside the protected command transaction. */
export function validateGuideCreate(input, options) {
  exact(input, ['action', 'type', 'id', 'subjectId', 'consentEpoch', 'payload']);
  const payload = input.payload;
  if (input.type === 'research_event') {
    if (!object(payload)) fail('GUIDE_FIELD', '缺少交互记录。');
    validateResearchEvent(input, options);
    return;
  }
  if (input.type === 'report') {
    exact(payload, ['cardId', 'type']);
    choice(payload.type, REPORT_TYPES, '报告类型');
    text(payload.cardId, '答案', 120, 1);
    publicAnswer(options.state, { cardId: payload.cardId }, options.now);
    return;
  }
  if (!['question', 'material'].includes(input.type)) fail('GUIDE_FIELD', '不支持的提交类型。');
  exact(payload, input.type === 'question' ? ['body', 'contextScope', 'originQueryEventId'] : ['body', 'contextScope', 'sourceUrl', 'provenanceRole']);
  text(payload.contextScope, '适用背景', 160, 1);
  text(payload.body, '正文', 1500, input.type === 'question' ? 10 : 0);
  if (input.type === 'material') {
    text(payload.sourceUrl, '来源地址', 1500);
    if (!payload.body?.trim() && !payload.sourceUrl?.trim()) fail('GUIDE_FIELD', '材料线索至少需要链接或简短说明。');
    choice(payload.provenanceRole, MATERIAL_RELATIONS, '材料关系');
    if (payload.sourceUrl && !isSafePublicUrl(payload.sourceUrl)) fail('GUIDE_FIELD', '材料链接必须是公开 HTTP(S) 地址。');
  }
  if (containsLikelyPersonalData(`${payload.contextScope} ${payload.body ?? ''} ${decodedUrl(payload.sourceUrl)}`)) fail('PERSONAL_DATA', '请移除邮箱、电话、学号或证件号。');
  if (payload.originQueryEventId !== undefined) ownedQuery(options.state, payload.originQueryEventId, options.principal, options);
}

export function validateGuideAnonymousReport(input, { state, now }) {
  exact(input, ['type', 'cardId', 'affectedArea']);
  if (input.type !== 'privacy') fail('GUIDE_FIELD', '匿名入口仅接受隐私问题。');
  text(input.cardId, '答案', 120);
  text(input.affectedArea, '功能区域', 80);
  if (!input.cardId && !input.affectedArea) fail('GUIDE_FIELD', '请选择答案或功能区域。');
  if (input.affectedArea) choice(input.affectedArea, REPORT_AREAS, '功能区域');
  if (input.cardId) publicAnswer(state, { cardId: input.cardId }, now);
}

/** Normalize business-only case updates inside the SDK's authorized transaction. */
export function validateGuideTransition(input, { state, now }) {
  exact(input, ['action', 'id', 'expectedVersion', 'status', 'decisionCode', 'note', 'assignee', 'entityId', 'revisionId']);
  const record = state.modules.lifecycle.records[input.id];
  if (!record) fail('NOT_FOUND', '找不到该处置记录。', 404);
  if (!['question', 'material', 'report', 'privacy_report'].includes(record.type)) fail('GUIDE_ACTION', '此类记录不能通过处置队列修改。', 403);
  const command = { ...input };
  const sameStatus = input.status === record.status;
  const terminal = ['actioned', 'rejected', 'resolved', 'closed'].includes(input.status);
  if (input.note !== undefined) {
    if (typeof input.note !== 'string') fail('GUIDE_FIELD', '内部备注无效。');
    command.note = input.note.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '').trim();
    text(command.note, '内部备注', 1000, terminal && !sameStatus ? 8 : 4);
    if (containsLikelyPersonalData(command.note)) fail('PERSONAL_DATA', '内部备注不能包含邮箱、电话、学号或证件号。');
  }
  if (terminal && !sameStatus && command.note === undefined) fail('GUIDE_REASON', '终态处理需要至少 8 字的内部理由。');
  if (input.assignee !== undefined && input.assignee !== null && !identifier(input.assignee)) fail('GUIDE_FIELD', '指派对象无效。');

  if (sameStatus) {
    // Notes and assignment changes must not rewrite an already recorded outcome.
    for (const field of ['decisionCode', 'entityId', 'revisionId']) {
      if (input[field] !== undefined && input[field] !== record[field]) fail('GUIDE_RESULT_IMMUTABLE', '追加记录不能改变既有决定或结果关联。', 409);
    }
    if (command.note === undefined && (input.assignee === undefined || input.assignee === record.assignee)) fail('GUIDE_NO_CHANGE', '请添加备注或调整指派对象。', 409);
    command.decisionCode = record.decisionCode;
    return command;
  }

  const intake = ['question', 'material'].includes(record.type);
  if (intake && input.status === 'actioned') choice(input.decisionCode, ['draft_created', 'linked_existing'], '采用线索的决定');
  if (intake && input.status === 'rejected') choice(input.decisionCode, ['rejected_out_of_scope', 'rejected_insufficient', 'duplicate'], '拒绝线索的决定');
  if (!terminal && (input.decisionCode != null || input.entityId !== undefined || input.revisionId !== undefined)) fail('GUIDE_DECISION', '处理中不能提前记录结案结果。');

  const hidden = !intake && input.decisionCode === 'hidden';
  const needsLink = hidden || (intake && input.status === 'actioned') || input.decisionCode === 'corrected';
  if (!needsLink && input.entityId === undefined && input.revisionId === undefined) return command;
  if (!identifier(input.entityId)) fail('GUIDE_RESULT_LINK', '处理结果需要有效的答案标识。');
  const entity = state.modules.content.entities.find(item => item.id === input.entityId && item.type === 'answer');
  if (!entity) fail('GUIDE_RESULT_LINK', '处理结果必须关联答案。');
  if (hidden) {
    if (entity.hidden !== true) fail('GUIDE_RESULT_LINK', '已隐藏结论必须关联已经暂停公开的答案。');
    if (input.revisionId != null) {
      if (!identifier(input.revisionId)) fail('GUIDE_RESULT_LINK', '答案版本无效。');
      const revision = readRevision(state.modules.content, input.revisionId);
      if (revision.entityId !== entity.id) fail('GUIDE_RESULT_LINK', '答案版本不属于指定答案。');
    }
    command.revisionId = input.revisionId ?? null;
    return command;
  }
  if (!identifier(input.revisionId)) fail('GUIDE_RESULT_LINK', '处理结果需要精确的答案版本。');
  const draft = intake && input.decisionCode === 'draft_created';
  const revision = draft ? readRevision(state.modules.content, input.revisionId) : readPublicRevision(state.modules.content, input.revisionId, { now: new Date(now).toISOString() });
  if (!revision || (draft ? revision.entityId : revision.id) !== entity.id) fail('GUIDE_RESULT_LINK', '处理结果必须关联有效的答案版本。');
  return command;
}
