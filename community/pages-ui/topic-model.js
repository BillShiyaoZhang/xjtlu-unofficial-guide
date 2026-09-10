// Public topic metadata only. This module never infers comments, contributors or attendance.
const kinds = new Set(['question', 'event', 'incident']);
const eventStatuses = new Set(['scheduled', 'postponed', 'rescheduled', 'cancelled']);
const registrationStatuses = new Set(['open', 'closed', 'unknown']);
const incidentStatuses = new Set(['ongoing', 'resolved', 'unknown']);
const own = (object, key) => Object.hasOwn(object, key);

function record(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new TypeError(`${label}.${key} is not public topic metadata`);
  return value;
}

function string(value, label, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${label} must be nonempty text`);
  }
  return value.trim();
}

function identifier(value, label) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,119}$/u.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}

// Require an actual calendar date and an explicit timezone; Date.parse alone normalizes February 30.
function timestamp(value, label) {
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match) throw new TypeError(`${label} must be an ISO timestamp with timezone`);
  const [, year, month, day, hour, minute, second, zone] = match;
  const probe = new Date(0);
  probe.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  probe.setUTCHours(Number(hour), Number(minute), Number(second), 0);
  const valid = probe.getUTCFullYear() === Number(year) && probe.getUTCMonth() === Number(month) - 1
    && probe.getUTCDate() === Number(day) && probe.getUTCHours() === Number(hour)
    && probe.getUTCMinutes() === Number(minute) && probe.getUTCSeconds() === Number(second);
  const zoneHours = zone === 'Z' ? 0 : Number(zone.slice(1, 3));
  const zoneMinutes = zone === 'Z' ? 0 : Number(zone.slice(4, 6));
  if (!valid || zoneHours > 14 || zoneMinutes > 59 || (zoneHours === 14 && zoneMinutes !== 0) || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} is not a valid calendar timestamp`);
  }
  return value;
}

function calendarDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new TypeError(`${label} must be a calendar date`);
  // The temporary timestamp validates the calendar only; it is never returned or published.
  timestamp(`${value}T00:00:00Z`, label);
  return value;
}

/** Return a normalized public HTTPS URL, or null. No network or DNS lookup is performed. */
export function safePublicHttpsUrl(value) {
  if (typeof value !== 'string' || /[\s\\\u0000-\u001f\u007f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/u, '');
    // Named public hosts only: literal IPs, local names, credentials and non-HTTPS links are excluded.
    if (url.protocol !== 'https:' || url.username || url.password || !host.includes('.') || host.length > 253
      || host.split('.').some(part => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(part))
      || host.startsWith('[') || /^\d+(?:\.\d+){3}$/u.test(host)
      || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid)$/u.test(host)) return null;
    return url.href;
  } catch { return null; }
}

function optionalTimes(input, output, fields, label) {
  for (const field of fields) if (own(input, field)) output[field] = timestamp(input[field], `${label}.${field}`);
}

function validateSources(input) {
  if (!Array.isArray(input) || !input.length || input.length > 20) throw new TypeError('sources requires 1 to 20 public source records');
  const seen = new Set();
  return input.map(source => {
    record(source, ['url', 'title', 'publisher', 'category', 'accessedAt', 'summary', 'accessStatus', 'publishedOn'], 'source');
    const url = safePublicHttpsUrl(source.url);
    if (!url) throw new TypeError('source.url must be a public HTTPS URL');
    if (seen.has(url)) throw new TypeError('duplicate source URL');
    seen.add(url);
    if (!['official', 'community'].includes(source.category)) throw new TypeError('source.category is unknown');
    if (!['read', 'unavailable'].includes(source.accessStatus)) throw new TypeError('source.accessStatus is unknown');
    const result = { url, title: string(source.title, 'source.title', 240), publisher: string(source.publisher, 'source.publisher', 240),
      category: source.category, accessedAt: timestamp(source.accessedAt, 'source.accessedAt'), accessStatus: source.accessStatus };
    if (own(source, 'summary')) {
      if (source.accessStatus !== 'read') throw new TypeError('an unavailable source cannot have a summary');
      result.summary = string(source.summary, 'source.summary', 2000);
    }
    if (own(source, 'publishedOn')) {
      result.publishedOn = calendarDate(source.publishedOn, 'source.publishedOn');
    }
    return result;
  });
}

function validateEvent(input) {
  record(input, ['startsAt', 'endsAt', 'startsOn', 'endsOn', 'registrationStartsAt', 'registrationEndsAt', 'registrationStatus',
    'status', 'registrationUrl', 'previousStartsAt', 'confirmedAt'], 'event');
  if (!eventStatuses.has(input.status)) throw new TypeError('event.status is unknown');
  const result = { status: input.status };
  optionalTimes(input, result, ['startsAt', 'endsAt', 'registrationStartsAt', 'registrationEndsAt', 'previousStartsAt', 'confirmedAt'], 'event');
  for (const field of ['startsOn', 'endsOn']) if (own(input, field)) result[field] = calendarDate(input[field], `event.${field}`);
  if ((result.startsOn || result.endsOn) && ['startsAt', 'endsAt', 'previousStartsAt'].some(field => own(input, field))) {
    throw new TypeError('event calendar dates and exact start/end timestamps cannot be mixed');
  }
  if (result.endsOn && !result.startsOn) throw new TypeError('event.endsOn requires startsOn');
  if (result.endsOn && result.endsOn < result.startsOn) throw new TypeError('event ends before it starts');
  if (own(input, 'registrationStatus')) {
    if (!registrationStatuses.has(input.registrationStatus)) throw new TypeError('event.registrationStatus is unknown');
    result.registrationStatus = input.registrationStatus;
  }
  if (own(input, 'registrationUrl')) {
    result.registrationUrl = safePublicHttpsUrl(input.registrationUrl);
    if (!result.registrationUrl) throw new TypeError('event.registrationUrl must be a public HTTPS URL');
  }
  if (result.endsAt && !result.startsAt) throw new TypeError('event.endsAt requires startsAt');
  if (result.endsAt && Date.parse(result.endsAt) < Date.parse(result.startsAt)) throw new TypeError('event ends before it starts');
  if (result.registrationStartsAt && result.registrationEndsAt && Date.parse(result.registrationEndsAt) <= Date.parse(result.registrationStartsAt)) {
    throw new TypeError('registration must end after it starts');
  }
  if (result.status === 'rescheduled' && !result.startsAt && !result.startsOn) throw new TypeError('a rescheduled event needs its new startsAt or startsOn');
  if (result.status === 'rescheduled' && result.previousStartsAt && Date.parse(result.previousStartsAt) === Date.parse(result.startsAt)) {
    throw new TypeError('a rescheduled event must have a different new time');
  }
  return result;
}

function validateIncident(input) {
  record(input, ['status', 'occurredAt', 'updatedAt', 'confirmedAt', 'summary'], 'incident');
  if (!incidentStatuses.has(input.status)) throw new TypeError('incident.status is unknown');
  const result = { status: input.status };
  optionalTimes(input, result, ['occurredAt', 'updatedAt', 'confirmedAt'], 'incident');
  if (own(input, 'summary')) result.summary = string(input.summary, 'incident.summary');
  if (result.status === 'resolved' && !result.confirmedAt) throw new TypeError('a resolved incident needs an explicit confirmedAt');
  return result;
}

/** Validate and clone the public allowlist. Invalid or mismatched metadata throws TypeError. */
export function validateTopicsConfig(input, catalog) {
  record(input, ['schemaVersion', 'topics'], 'topics config');
  if (input.schemaVersion !== 1 || !Array.isArray(input.topics) || input.topics.length > 200) throw new TypeError('invalid topics config version or topics array');
  let catalogIds;
  if (catalog !== undefined) {
    const topics = Array.isArray(catalog) ? catalog : catalog?.topics;
    if (!Array.isArray(topics)) throw new TypeError('catalog topics must be an array');
    catalogIds = new Set(topics.map(topic => topic.id));
  }
  const seen = new Set();
  const topics = input.topics.map(inputTopic => {
    record(inputTopic, ['id', 'catalogTopicId', 'title', 'prompt', 'kind', 'editorial', 'createdAt', 'event', 'incident', 'collection', 'sources'], 'topic');
    const id = identifier(inputTopic.id, 'topic.id');
    if (seen.has(id)) throw new TypeError(`duplicate topic ${id}`);
    seen.add(id);
    const catalogTopicId = identifier(inputTopic.catalogTopicId, 'topic.catalogTopicId');
    if (catalogIds && !catalogIds.has(catalogTopicId)) throw new TypeError(`unknown catalog topic ${catalogTopicId}`);
    if (!kinds.has(inputTopic.kind) || inputTopic.editorial !== true) throw new TypeError('invalid topic kind or editorial attribution');
    const result = { id, catalogTopicId, title: string(inputTopic.title, 'topic.title', 240),
      prompt: string(inputTopic.prompt, 'topic.prompt', 4000), kind: inputTopic.kind, editorial: true };
    if (own(inputTopic, 'sources')) result.sources = validateSources(inputTopic.sources);
    if (own(inputTopic, 'collection')) {
      if (inputTopic.collection !== true || !result.sources?.length) throw new TypeError('collection must be true with explicit sources');
      result.collection = true;
    }
    optionalTimes(inputTopic, result, ['createdAt'], 'topic');
    if (own(inputTopic, 'event')) {
      if (result.kind !== 'event') throw new TypeError('event metadata requires event kind');
      result.event = validateEvent(inputTopic.event);
    }
    if (own(inputTopic, 'incident')) {
      if (result.kind !== 'incident') throw new TypeError('incident metadata requires incident kind');
      result.incident = validateIncident(inputTopic.incident);
    }
    return result;
  });
  return { schemaVersion: 1, topics };
}

function cardContext(snapshot, catalogTopicId) {
  const topic = snapshot.catalog.topics.find(row => row.id === catalogTopicId);
  const answerIds = [...new Set((snapshot.answers ?? []).filter(answer => answer.topic?.id === catalogTopicId && typeof answer.id === 'string').map(answer => answer.id))];
  return { catalogTitle: topic?.titleZh ?? topic?.title ?? '', answerIds, answerCount: answerIds.length };
}

/** Featured cards are explicit editorial prompts, never automatically all catalog categories. */
export function topicCards(snapshot, config) {
  if (!Array.isArray(snapshot?.catalog?.topics)) return [];
  const checked = validateTopicsConfig(config ?? { schemaVersion: 1, topics: [] }, snapshot.catalog);
  return checked.topics.map(topic => ({ ...topic, ...cardContext(snapshot, topic.catalogTopicId), derived: false }));
}

/** Directory fallback only. Callers choose whether to expose these outside the directory. */
export function catalogTopicCards(snapshot) {
  if (!Array.isArray(snapshot?.catalog?.topics)) return [];
  return snapshot.catalog.topics.map(topic => ({ id: topic.id, catalogTopicId: topic.id,
    title: topic.titleZh ?? topic.title ?? '', prompt: topic.description ?? '查看相关整理，也欢迎补充消息或分享经历。',
    kind: 'question', editorial: false, ...cardContext(snapshot, topic.id), derived: true }));
}

function nowValue(value) {
  const result = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

const dateFormatter = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const formatTime = value => dateFormatter.format(new Date(value)) + '（北京时间）';
const dayFormatter = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Inclusive calendar dates retain their precision; daily opening hours remain unknown. */
function calendarEventPresentation(event, current) {
  const parts = Object.fromEntries(dayFormatter.formatToParts(new Date(current)).map(part => [part.type, part.value]));
  const today = `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}`;
  const pastEnd = Boolean(event.endsOn && today > event.endsOn);
  const started = today >= event.startsOn;
  const range = `${event.startsOn}${event.endsOn ? ` 至 ${event.endsOn}` : ' 起，结束日期待补'}`;
  const timeLabel = `${range}（北京时间；每日开放时段待确认）`;
  const result = { label: event.status === 'rescheduled' ? '已改期，按新日期安排' : '按计划日期安排',
    timeLabel, registrationLabel: '每日开放时段待确认，报名信息请看原文',
    canRegister: false, registrationUrl: null, history: false, needsConfirmation: true };
  if (event.status === 'cancelled') return { ...result, label: '已取消', registrationLabel: '活动已取消，停止报名', history: true };
  if (event.status === 'postponed') return { ...result, label: '已延期，新时间待定',
    timeLabel: `原计划日期：${range}（北京时间）；新日期待定`, registrationLabel: '活动延期，暂停报名' };
  if (pastEnd) return { ...result, label: '计划结束日期已过，举办情况待确认',
    registrationLabel: '已过计划活动日期，不再提供报名', history: true };
  if (started) result.label = `${event.status === 'rescheduled' ? '已改期，' : ''}计划开始日期已到，现场情况待确认`;
  if (event.registrationEndsAt && current >= Date.parse(event.registrationEndsAt)) result.registrationLabel = '已到报名截止时间';
  else if (event.registrationStatus === 'closed') result.registrationLabel = '报名已关闭';
  return result;
}

/**
 * history means cancelled or past the planned end; it never asserts an event took place.
 * An explicit, confirmed open registration window is necessary for an active registration CTA.
 */
export function eventPresentation(event, now = Date.now()) {
  const unknown = { label: '活动状态待确认', timeLabel: '活动时间待补', registrationLabel: '报名状态待确认',
    canRegister: false, registrationUrl: null, history: false, needsConfirmation: true };
  let checked;
  try { checked = validateEvent(event); } catch { return unknown; }
  const current = nowValue(now);
  if (current === null) return unknown;
  if (checked.startsOn) return calendarEventPresentation(checked, current);
  const starts = checked.startsAt ? Date.parse(checked.startsAt) : null;
  const ends = checked.endsAt ? Date.parse(checked.endsAt) : null;
  const confirmed = checked.confirmedAt && Date.parse(checked.confirmedAt) <= current;
  const pastEnd = ends !== null && current >= ends;
  const started = starts !== null && current >= starts;
  let timeLabel = starts === null ? '活动时间待补' : `${formatTime(checked.startsAt)}${checked.endsAt ? ` 至 ${formatTime(checked.endsAt)}` : ''}`;
  if (checked.status === 'rescheduled' && checked.previousStartsAt) timeLabel += `；原定 ${formatTime(checked.previousStartsAt)}`;
  if (checked.status === 'cancelled') return { ...unknown, label: '已取消', timeLabel,
    registrationLabel: '活动已取消，停止报名', history: true, needsConfirmation: !confirmed };
  if (checked.status === 'postponed') return { ...unknown, label: '已延期，新时间待定',
    timeLabel: starts === null ? '新时间待定' : `原计划 ${formatTime(checked.startsAt)}；新时间待定`,
    registrationLabel: '活动延期，暂停报名', needsConfirmation: true };
  let label = starts === null ? '活动时间待补' : checked.status === 'rescheduled' ? '已改期，按新计划' : '按计划安排';
  if (pastEnd) label = '计划结束时间已过，举办情况待确认';
  else if (started) label = '计划开始时间已到，现场情况待确认';
  const registrationStarts = checked.registrationStartsAt ? Date.parse(checked.registrationStartsAt) : null;
  const registrationEnds = checked.registrationEndsAt ? Date.parse(checked.registrationEndsAt) : null;
  let registrationLabel = '报名状态待确认';
  let canRegister = false;
  if (pastEnd) registrationLabel = '已过计划活动时间，不再提供报名';
  else if (registrationEnds !== null && current >= registrationEnds) registrationLabel = '已到报名截止时间';
  else if (checked.registrationStatus === 'closed') registrationLabel = '报名已关闭';
  else if (registrationStarts !== null && current < registrationStarts) registrationLabel = '尚未到报名开始时间';
  else if (checked.registrationStatus === 'open' && confirmed && starts !== null && (!started || ends !== null)
    && registrationEnds !== null && checked.registrationUrl) {
    canRegister = true;
    registrationLabel = `报名开放，截止 ${formatTime(checked.registrationEndsAt)}`;
  }
  return { label, timeLabel, registrationLabel, canRegister,
    registrationUrl: canRegister ? checked.registrationUrl : null, history: pastEnd,
    needsConfirmation: !confirmed || starts === null || started || registrationLabel === '报名状态待确认' };
}

/** Incident resolution is an explicit recorded update, never elapsed-time inference. */
export function incidentPresentation(incident, now = Date.now()) {
  const unknown = { label: '当前情况待补充', timeLabel: '发生时间待补', updateLabel: '暂无状态确认记录', history: false, needsConfirmation: true };
  let checked;
  try { checked = validateIncident(incident); } catch { return unknown; }
  const current = nowValue(now);
  if (current === null) return unknown;
  if ([checked.occurredAt, checked.updatedAt, checked.confirmedAt].some(value => value && Date.parse(value) > current)) return unknown;
  const confirmed = checked.confirmedAt && Date.parse(checked.confirmedAt) <= current;
  let label = checked.status === 'ongoing' ? '最新记录：仍有影响' : checked.status === 'resolved' && confirmed ? '最新记录：已解决' : '当前情况待补充';
  if (!confirmed && checked.status === 'ongoing') label = '收到影响情况，待进一步确认';
  return { label, timeLabel: checked.occurredAt ? formatTime(checked.occurredAt) : unknown.timeLabel,
    updateLabel: confirmed ? `状态确认于 ${formatTime(checked.confirmedAt)}` : checked.updatedAt
      ? `信息更新于 ${formatTime(checked.updatedAt)}；状态待确认` : unknown.updateLabel,
    history: checked.status === 'resolved' && Boolean(confirmed), needsConfirmation: !confirmed || checked.status === 'unknown' };
}
