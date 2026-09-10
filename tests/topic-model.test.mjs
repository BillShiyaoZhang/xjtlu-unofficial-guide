import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateTopicsConfig, topicCards, catalogTopicCards, safePublicHttpsUrl, eventPresentation, incidentPresentation } from '../community/pages-ui/topic-model.js';

const readJson = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const now = '2026-09-10T10:00:00+08:00';
const futureEvent = {
  status: 'scheduled', startsAt: '2026-09-12T14:00:00+08:00', endsAt: '2026-09-12T16:00:00+08:00',
  registrationStartsAt: '2026-09-09T09:00:00+08:00', registrationEndsAt: '2026-09-11T18:00:00+08:00',
  registrationStatus: 'open', registrationUrl: 'https://www.xjtlu.edu.cn/event-registration', confirmedAt: '2026-09-10T09:00:00+08:00',
};
const question = { id: 'test-prompt', catalogTopicId: 'topic-study', title: '一个具体问题', prompt: '欢迎补充一个经历。', kind: 'question', editorial: true };
const configWith = topic => ({ schemaVersion: 1, topics: [topic] });
const publicSource = { url: 'https://www.xjtlu.edu.cn/news/test-source', title: '公开来源', publisher: '西交利物浦大学',
  category: 'official', accessedAt: now, accessStatus: 'read', summary: '编辑根据公开正文整理的概括。', publishedOn: '2026-09-09' };

test('the editorial seed keeps three original invitations separate from attributed source collections', async () => {
  const [config, catalog, snapshot] = await Promise.all([
    readJson('../community/community-topics.json'), readJson('../community/catalog.json'), readJson('../community/pages-reviewed.json'),
  ]);
  assert.deepEqual(validateTopicsConfig(config, catalog), config);
  const cards = topicCards(snapshot, config).filter(card => !card.collection);
  assert.equal(cards.length, 3);
  assert.equal(catalogTopicCards(snapshot).length, catalog.topics.length);
  for (const card of cards) {
    assert.equal(card.kind, 'question');
    assert.equal(card.editorial, true);
    assert.equal(card.derived, false);
    assert.equal(card.answerCount, snapshot.answers.filter(answer => answer.topic.id === card.catalogTopicId).length);
    for (const field of ['event', 'incident', 'commentCount', 'contributorCount', 'likes', 'createdAt']) assert.equal(Object.hasOwn(card, field), false);
  }
});

test('source collections clone and preserve explicit public provenance without manufacturing participation', () => {
  const input = configWith({ ...question, collection: true, sources: [publicSource] });
  const snapshot = { catalog: { topics: [{ id: 'topic-study', titleZh: '学习' }] }, answers: [] };
  const [card] = topicCards(snapshot, input);
  assert.equal(card.collection, true);
  assert.deepEqual(card.sources, [publicSource]);
  assert.deepEqual(card.answerIds, []);
  assert.equal(card.answerCount, 0);
  for (const field of ['commentCount', 'contributorCount', 'likes', 'verifiedAt']) assert.equal(Object.hasOwn(card, field), false);
  card.sources[0].summary = '更改投影不会改写输入';
  assert.equal(input.topics[0].sources[0].summary, publicSource.summary);
  assert.throws(() => validateTopicsConfig(configWith({ ...question, collection: true })), /explicit sources/u);
  assert.throws(() => validateTopicsConfig(configWith({ ...question, collection: false, sources: [publicSource] })), /collection/u);
  assert.throws(() => validateTopicsConfig(configWith({ ...question, sources: [] })), /sources/u);
});

test('unavailable sources retain a link and access metadata but reject every summary', () => {
  const { summary, publishedOn, ...source } = publicSource;
  const unavailable = { ...source, category: 'community', accessStatus: 'unavailable', url: 'https://h5.zhitiaox.com/#/pages/forum/forum?id=example' };
  const checked = validateTopicsConfig(configWith({ ...question, collection: true, sources: [unavailable] }));
  assert.deepEqual(checked.topics[0].sources, [unavailable]);
  for (const invalidSummary of ['', '未读到原文时不得推测正文。', undefined]) {
    assert.throws(() => validateTopicsConfig(configWith({ ...question, sources: [{ ...unavailable, summary: invalidSummary }] })), /cannot have a summary/u);
  }
  assert.equal(Object.hasOwn(checked.topics[0].sources[0], 'publishedOn'), false, 'unknown publication time remains absent');
});

test('source metadata rejects unsafe URLs, private fields, invalid states and fabricated timestamp precision', () => {
  for (const url of ['http://www.xjtlu.edu.cn/news', 'https://user:password@www.xjtlu.edu.cn/', 'https://localhost/',
    'https://127.0.0.1/', 'javascript:alert(1)', '/news', 'https://campus.internal/']) {
    assert.throws(() => validateTopicsConfig(configWith({ ...question, sources: [{ ...publicSource, url }] })), /public HTTPS/u, url);
  }
  for (const patch of [{ category: 'verified' }, { accessStatus: 'search-result' }, { publisher: '' },
    { title: ' ' }, { summary: '' }, { accessedAt: '2026-09-10' }, { accessedAt: '2026-02-30T10:00:00+08:00' },
    { publishedOn: '2026-02-30' }, { publishedOn: '2026-09-09T00:00:00Z' }, { comments: 30 }, { privateNote: '内部说明' }]) {
    assert.throws(() => validateTopicsConfig(configWith({ ...question, sources: [{ ...publicSource, ...patch }] })), TypeError);
  }
  assert.throws(() => validateTopicsConfig(configWith({ ...question, sources: [publicSource, publicSource] })), /duplicate source/u);
  assert.throws(() => validateTopicsConfig(configWith({ ...question, sources: Array.from({ length: 21 }, () => publicSource) })), /sources/u);
  const source = { ...publicSource, publishedOn: '2024-02-29' };
  assert.equal(validateTopicsConfig(configWith({ ...question, sources: [source] })).topics[0].sources[0].publishedOn, '2024-02-29');
});

test('empty data does not manufacture featured topics; directory fallbacks are explicitly separate', () => {
  assert.deepEqual(topicCards(), []);
  assert.deepEqual(catalogTopicCards(), []);
  const snapshot = { catalog: { topics: [{ id: 'topic-study', titleZh: '学习与教务' }] }, answers: [] };
  assert.deepEqual(topicCards(snapshot), []);
  assert.equal(catalogTopicCards(snapshot)[0].editorial, false);
  assert.equal(catalogTopicCards(snapshot)[0].derived, true);
  assert.equal(catalogTopicCards(snapshot)[0].answerCount, 0);
});

test('configuration rejects unknown fields, catalog references, duplicates and fake attribution', () => {
  assert.throws(() => validateTopicsConfig({ ...configWith(question), schemaVersion: 2 }), TypeError);
  assert.throws(() => validateTopicsConfig(configWith({ ...question, commentCount: 12 })), /not public/u);
  assert.throws(() => validateTopicsConfig(configWith({ ...question, editorial: false })), TypeError);
  assert.throws(() => validateTopicsConfig(configWith(question), { topics: [] }), /unknown catalog/u);
  assert.throws(() => validateTopicsConfig({ schemaVersion: 1, topics: [question, question] }), /duplicate/u);
  assert.throws(() => validateTopicsConfig(configWith({ ...question, event: futureEvent })), /requires event/u);
  assert.throws(() => validateTopicsConfig(configWith({ ...question, kind: 'event', event: { ...futureEvent, status: 'completed' } })), TypeError);
  assert.throws(() => validateTopicsConfig(configWith({ ...question, kind: 'incident', incident: { status: 'resolved' } })), /confirmedAt/u);
});

test('validation clones the public shape without mutating editorial input or borrowing unrelated answers', () => {
  const input = configWith({ ...question, kind: 'event', event: { ...futureEvent } });
  const checked = validateTopicsConfig(input);
  checked.topics[0].event.status = 'cancelled';
  assert.equal(input.topics[0].event.status, 'scheduled');
  const cards = topicCards({ catalog: { topics: [{ id: 'topic-study', titleZh: '学习' }] }, answers: [
    { id: 'public-a', topic: { id: 'topic-study' } }, { id: 'other-b', topic: { id: 'topic-services' } },
  ] }, configWith(question));
  assert.deepEqual(cards[0].answerIds, ['public-a']);
});

test('timestamps need real dates and timezone, and impossible event ranges fail closed', () => {
  for (const startsAt of ['2026-09-12', '2026-09-12T14:00:00', '2026-02-30T14:00:00+08:00', '2026-09-12T24:00:00+08:00', '2026-09-12T14:00:00+15:00']) {
    const event = { ...futureEvent, startsAt };
    assert.throws(() => validateTopicsConfig(configWith({ ...question, kind: 'event', event })), TypeError);
    assert.equal(eventPresentation(event, now).canRegister, false);
  }
  assert.throws(() => validateTopicsConfig(configWith({ ...question, kind: 'event', event: { ...futureEvent, endsAt: '2026-09-11T14:00:00+08:00' } })), /ends before/u);
  assert.throws(() => validateTopicsConfig(configWith({ ...question, kind: 'event', event: { ...futureEvent, registrationStartsAt: futureEvent.registrationEndsAt } })), /registration/u);
});

test('calendar-only event dates retain their precision and reject mixed or impossible date ranges', () => {
  const event = { status: 'scheduled', startsOn: '2026-05-20', endsOn: '2026-12-31', registrationStatus: 'unknown' };
  const checked = validateTopicsConfig(configWith({ ...question, kind: 'event', event })).topics[0].event;
  assert.deepEqual(checked, event);
  assert.equal(Object.hasOwn(checked, 'startsAt'), false);
  assert.equal(Object.hasOwn(checked, 'endsAt'), false);
  for (const patch of [{ startsOn: '2026-02-30' }, { endsOn: '2026-04-30' }, { startsOn: '2026-05-20T00:00:00+08:00' },
    { startsAt: '2026-05-20T09:00:00+08:00' }, { endsAt: '2026-12-31T18:00:00+08:00' },
    { previousStartsAt: '2026-05-19T09:00:00+08:00' }]) {
    assert.throws(() => validateTopicsConfig(configWith({ ...question, kind: 'event', event: { ...event, ...patch } })), TypeError);
  }
  assert.throws(() => validateTopicsConfig(configWith({ ...question, kind: 'event', event: { status: 'scheduled', endsOn: '2026-12-31' } })), /requires startsOn/u);
  const leapDay = { status: 'scheduled', startsOn: '2024-02-29', endsOn: '2024-02-29' };
  assert.deepEqual(validateTopicsConfig(configWith({ ...question, kind: 'event', event: leapDay })).topics[0].event, leapDay);
});

test('calendar events cross inclusive date boundaries in Beijing without inventing opening times', () => {
  const event = { status: 'scheduled', startsOn: '2026-05-20', endsOn: '2026-12-31' };
  const before = eventPresentation(event, '2026-05-19T15:59:59Z');
  assert.equal(before.label, '按计划日期安排');
  const start = eventPresentation(event, '2026-05-19T16:00:00Z');
  assert.match(start.label, /计划开始日期已到/u);
  assert.equal(start.history, false);
  const lastDay = eventPresentation(event, '2026-12-31T15:59:59.999Z');
  assert.equal(lastDay.history, false, 'the stated last date is inclusive in Beijing');
  assert.match(lastDay.timeLabel, /2026-05-20 至 2026-12-31/u);
  assert.match(lastDay.timeLabel, /每日开放时段待确认/u);
  assert.ok(!/\d\d:\d\d/u.test(lastDay.timeLabel), 'no invented midnight or daily opening hour');
  const after = eventPresentation(event, '2026-12-31T16:00:00Z');
  assert.equal(after.history, true);
  assert.match(after.label, /计划结束日期已过，举办情况待确认/u);
  assert.equal(after.canRegister, false);
  assert.equal(eventPresentation({ status: 'scheduled', startsOn: '2026-05-20' }, '2030-01-01T00:00:00Z').history, false);
});

test('date-only schedules cannot open registration even when a confirmed registration window exists', () => {
  const { startsAt, endsAt, ...registration } = futureEvent;
  const event = { ...registration, startsOn: '2026-09-12', endsOn: '2026-09-12' };
  const result = eventPresentation(event, now);
  assert.equal(result.canRegister, false);
  assert.equal(result.registrationUrl, null);
  assert.equal(result.needsConfirmation, true);
  assert.match(result.registrationLabel, /每日开放时段待确认/u);
  assert.match(eventPresentation(event, event.registrationEndsAt).registrationLabel, /报名截止/u);
  assert.match(eventPresentation({ ...event, registrationStatus: 'closed' }, now).registrationLabel, /报名已关闭/u);
});

test('calendar-only cancellation, postponement and rescheduling preserve explicit lifecycle meaning', () => {
  const event = { status: 'scheduled', startsOn: '2026-09-12', endsOn: '2026-09-12' };
  assert.equal(eventPresentation({ ...event, status: 'cancelled' }, now).history, true);
  const postponed = eventPresentation({ ...event, status: 'postponed' }, '2027-01-01T00:00:00Z');
  assert.equal(postponed.history, false);
  assert.match(postponed.timeLabel, /原计划日期：2026-09-12 至 2026-09-12.*新日期待定/u);
  const rescheduled = { ...event, status: 'rescheduled' };
  assert.deepEqual(validateTopicsConfig(configWith({ ...question, kind: 'event', event: rescheduled })).topics[0].event, rescheduled);
  assert.match(eventPresentation(rescheduled, now).label, /已改期/u);
  assert.equal(eventPresentation(rescheduled, '2026-09-12T16:00:00Z').history, true);
});

test('registration links accept named public HTTPS hosts only', () => {
  assert.equal(safePublicHttpsUrl('https://www.xjtlu.edu.cn/path?event=1'), 'https://www.xjtlu.edu.cn/path?event=1');
  for (const link of ['http://www.xjtlu.edu.cn', 'javascript:alert(1)', '/local-path', '//www.xjtlu.edu.cn',
    'https://user:secret@www.xjtlu.edu.cn', 'https://localhost/', 'https://sub.localhost/', 'https://10.0.0.1/',
    'https://127.1/', 'https://2130706433/', 'https://[::1]/', 'https://campus.internal/', 'https://campus.local./',
    'https://foo..com/', 'https://www.xjtlu.edu.cn\\@localhost/', 'https://www.xjtlu.edu.cn/\n']) {
    assert.equal(safePublicHttpsUrl(link), null, link);
    assert.equal(eventPresentation({ ...futureEvent, registrationUrl: link }, now).canRegister, false, link);
  }
});

test('registration is open only within an explicitly open, confirmed window', () => {
  assert.equal(eventPresentation(futureEvent, now).canRegister, true);
  assert.equal(eventPresentation(futureEvent, now).registrationUrl, futureEvent.registrationUrl);
  assert.equal(eventPresentation(futureEvent, '2026-09-09T08:59:59+08:00').canRegister, false);
  assert.equal(eventPresentation({ ...futureEvent, confirmedAt: '2026-09-09T08:00:00+08:00' }, futureEvent.registrationStartsAt).canRegister, true);
  for (const patch of [{ registrationStatus: 'unknown' }, { registrationStatus: 'closed' }, { confirmedAt: '2026-09-11T09:00:00+08:00' }]) {
    assert.equal(eventPresentation({ ...futureEvent, ...patch }, now).canRegister, false);
  }
  for (const field of ['registrationStatus', 'confirmedAt', 'registrationEndsAt', 'registrationUrl']) {
    const missing = { ...futureEvent };
    delete missing[field];
    assert.equal(eventPresentation(missing, now).canRegister, false, field);
  }
  const noEnd = { ...futureEvent, registrationEndsAt: '2026-09-13T12:00:00+08:00' };
  delete noEnd.endsAt;
  assert.equal(eventPresentation(noEnd, now).canRegister, true, 'a known future start does not require an invented end time');
  assert.equal(eventPresentation(noEnd, noEnd.startsAt).canRegister, false, 'after the planned start an absent end cannot imply the event is still open');
});

test('the exact registration deadline closes registration without ending the event', () => {
  assert.equal(eventPresentation(futureEvent, '2026-09-11T17:59:59+08:00').canRegister, true);
  const result = eventPresentation(futureEvent, futureEvent.registrationEndsAt);
  assert.equal(result.canRegister, false);
  assert.equal(result.registrationUrl, null);
  assert.equal(result.history, false);
  assert.match(result.registrationLabel, /报名截止/u);
  assert.equal(result.label, '按计划安排');
});

test('cancellation and postponement stop registration even if the original window is open', () => {
  const cancelled = eventPresentation({ ...futureEvent, status: 'cancelled' }, now);
  assert.equal(cancelled.label, '已取消');
  assert.equal(cancelled.history, true);
  assert.equal(cancelled.canRegister, false);
  assert.equal(cancelled.registrationUrl, null);
  const postponed = eventPresentation({ ...futureEvent, status: 'postponed' }, '2026-09-20T10:00:00+08:00');
  assert.match(postponed.label, /新时间待定/u);
  assert.equal(postponed.canRegister, false);
  assert.equal(postponed.history, false, 'an old planned date must not end an indefinitely postponed event');
  assert.equal(postponed.needsConfirmation, true);
});

test('rescheduling uses the new dates while preserving the old planned start', () => {
  const moved = { ...futureEvent, status: 'rescheduled', previousStartsAt: '2026-09-08T14:00:00+08:00' };
  const result = eventPresentation(moved, now);
  assert.equal(result.canRegister, true);
  assert.equal(result.history, false);
  assert.match(result.timeLabel, /2026\/09\/12/u);
  assert.match(result.timeLabel, /原定.*2026\/09\/08/u);
  const missingDate = { ...moved };
  delete missingDate.startsAt;
  assert.equal(eventPresentation(missingDate, now).canRegister, false);
});

test('passing a planned start or end never asserts attendance or successful completion', () => {
  const started = eventPresentation(futureEvent, futureEvent.startsAt);
  assert.match(started.label, /现场情况待确认/u);
  assert.equal(started.history, false);
  const ended = eventPresentation(futureEvent, futureEvent.endsAt);
  assert.equal(ended.history, true);
  assert.equal(ended.canRegister, false);
  assert.equal(ended.needsConfirmation, true);
  assert.match(ended.label, /举办情况待确认/u);
  assert.equal(/已举办|已结束|圆满|成功/u.test(ended.label), false);
  const unknownEnd = { ...futureEvent };
  delete unknownEnd.endsAt;
  assert.equal(eventPresentation(unknownEnd, '2027-01-01T00:00:00Z').history, false);
});

test('no data, unknown status and invalid now never enable an event action', () => {
  for (const event of [undefined, null, {}, { status: 'completed' }, { status: 'scheduled' }]) {
    const result = eventPresentation(event, now);
    assert.equal(result.canRegister, false);
    assert.equal(result.registrationUrl, null);
    assert.equal(result.needsConfirmation, true);
  }
  assert.equal(eventPresentation(futureEvent, 'not-a-date').canRegister, false);
});

test('event presentation is based only on event facts; unrelated new comments cannot revive a historical event', () => {
  const config = configWith({ ...question, kind: 'event', event: futureEvent, createdAt: '2026-09-01T00:00:00Z' });
  const historical = eventPresentation(config.topics[0].event, '2026-10-01T00:00:00Z');
  const afterComment = { topic: config.topics[0], comments: [{ postedAt: '2026-10-01T00:00:00Z' }] };
  assert.deepEqual(eventPresentation(afterComment.topic.event, '2026-10-01T00:00:00Z'), historical);
  assert.equal(historical.history, true);
});

test('incidents never resolve by elapsed time and confirmation is distinct from posting time', () => {
  const ongoing = { status: 'ongoing', occurredAt: '2026-09-09T09:00:00+08:00', updatedAt: '2026-09-10T09:00:00+08:00', confirmedAt: '2026-09-09T12:00:00+08:00' };
  const old = incidentPresentation(ongoing, '2027-09-10T00:00:00Z');
  assert.equal(old.history, false);
  assert.match(old.label, /最新记录：仍有影响/u);
  assert.match(old.updateLabel, /09\/09/u);
  const resolved = incidentPresentation({ ...ongoing, status: 'resolved' }, now);
  assert.equal(resolved.history, true);
  assert.match(resolved.label, /最新记录：已解决/u);
  for (const incident of [undefined, {}, { status: 'resolved' }, { status: 'complete' },
    { status: 'resolved', confirmedAt: '2026-09-11T00:00:00Z' }]) {
    assert.equal(incidentPresentation(incident, now).history, false);
    assert.equal(incidentPresentation(incident, now).needsConfirmation, true);
  }
  const withoutConfirmation = { status: 'ongoing', updatedAt: '2026-09-10T09:00:00+08:00' };
  assert.match(incidentPresentation(withoutConfirmation, now).updateLabel, /信息更新于.*状态待确认/u);
});
