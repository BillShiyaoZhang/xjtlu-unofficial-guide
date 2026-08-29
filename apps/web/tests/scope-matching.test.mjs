import assert from 'node:assert/strict';
import test from 'node:test';

import { matchesScopeSelection } from '../lib/scope-matching.ts';

function scope(id, dimension) {
  return {
    id,
    dimension,
    code: id,
    labelZh: id,
    labelEn: null,
  };
}

test('scope filtering always keeps universal cards and keeps unknown cards only without filters', () => {
  const campusFilter = new Map([['campus', new Set(['campus-sip'])]]);

  assert.equal(matchesScopeSelection('universal', [], campusFilter), true);
  assert.equal(matchesScopeSelection('unknown', [], campusFilter), false);
  assert.equal(matchesScopeSelection('unknown', [], new Map()), true);
});

test('constrained scope filtering is OR within a dimension and AND across dimensions', () => {
  const selection = new Map([
    ['campus', new Set(['campus-sip', 'campus-taicang'])],
    ['student-level', new Set(['undergraduate'])],
  ]);

  assert.equal(
    matchesScopeSelection(
      'constrained',
      [
        scope('campus-taicang', 'campus'),
        scope('undergraduate', 'student-level'),
      ],
      selection,
    ),
    true,
  );
  assert.equal(
    matchesScopeSelection(
      'constrained',
      [scope('campus-sip', 'campus')],
      selection,
    ),
    false,
  );
  assert.equal(
    matchesScopeSelection(
      'constrained',
      [
        scope('campus-other', 'campus'),
        scope('undergraduate', 'student-level'),
      ],
      selection,
    ),
    false,
  );
});
