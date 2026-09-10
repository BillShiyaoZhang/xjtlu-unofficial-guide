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

test('the editorial seed contains exactly three real prompts with existing catalog topics and no invented participation or events', async () => {
  const [config, catalog, snapshot] = await Promise.all([
    readJson('../community/community-topics.json'), readJson('../community/catalog.json'), readJson('../community/pages-reviewed.json'),
  ]);
  assert.deepEqual(validateTopicsConfig(config, catalog), config);
  const cards = topicCards(snapshot, config);
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
