import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeEvidenceCoverage,
  containsLikelyPersonalData,
  deriveRevisionStatus,
  isSafePublicUrl,
  normalizeSearchText,
  rankSearchCandidate,
  searchTokens,
} from '../lib/domain.ts';
import {
  emailIsAllowlisted,
  parseEditorAllowlist,
} from '../lib/permissions.ts';

test('normalizes full-width text and expands bilingual aliases', () => {
  assert.equal(normalizeSearchText('  Ｅ－Bridge： 登录？ '), 'e bridge 登录');
  const tokens = searchTokens('LM 帮助');
  assert.ok(tokens.includes('learning mall'));
  assert.ok(tokens.includes('教学平台'));
});

test('ranks title and alias matches above unrelated content', () => {
  const candidate = {
    id: 'one',
    title: '在哪里查 Learning Mall 的操作帮助？',
    summary: '到知识库核对操作说明。',
    searchText: 'learning mall lm 教学平台 知识库',
    topicTitle: '账号与系统',
  };
  const related = rankSearchCandidate(candidate, 'LM 帮助');
  const unrelated = rankSearchCandidate(candidate, '校车时刻');
  assert.ok(related > unrelated);
  assert.equal(unrelated, 0);
});

test('derives overdue and dispute warnings without a truth score', () => {
  assert.equal(deriveRevisionStatus(200, 'none', 100).tone, 'current');
  assert.equal(deriveRevisionStatus(100, 'none', 100).tone, 'warning');
  assert.equal(deriveRevisionStatus(200, 'reported', 100).tone, 'danger');
});

test('computes archived and link coverage separately', () => {
  assert.equal(computeEvidenceCoverage(['link']), 'linked_only');
  assert.equal(computeEvidenceCoverage(['evidence']), 'fully_archived');
  assert.equal(
    computeEvidenceCoverage(['link', 'evidence']),
    'partial_archived',
  );
});

test('rejects unsafe source URLs and detects likely direct identifiers', () => {
  assert.equal(
    isSafePublicUrl('https://www.xjtlu.edu.cn/zh/current-students'),
    true,
  );
  assert.equal(isSafePublicUrl('javascript:alert(1)'), false);
  assert.equal(isSafePublicUrl('http://127.0.0.1/private'), false);
  assert.equal(isSafePublicUrl('http://192.168.1.10/private'), false);
  assert.equal(isSafePublicUrl('http://[::1]/private'), false);
  assert.equal(isSafePublicUrl('http://[fc00::1]/private'), false);
  assert.equal(isSafePublicUrl('http://[fe80::1]/private'), false);
  assert.equal(isSafePublicUrl('http://[::ffff:7f00:1]/private'), false);
  assert.equal(isSafePublicUrl('https://[2001:4860:4860::8888]/'), true);
  assert.equal(containsLikelyPersonalData('联系我：13800138000'), true);
  assert.equal(containsLikelyPersonalData('苏州校区 2026 入学届'), false);
});

test('editor allowlist is case-insensitive and fails closed when empty', () => {
  assert.equal(parseEditorAllowlist(undefined).size, 0);
  assert.equal(emailIsAllowlisted('editor@example.com', undefined), false);
  assert.equal(
    emailIsAllowlisted(
      'Editor@Example.com',
      'other@example.com, editor@example.com',
    ),
    true,
  );
});
