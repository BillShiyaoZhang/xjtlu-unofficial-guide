import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decidePilotInvitationParticipant,
  isPilotInvitationMode,
} from '../lib/pilot-invitation-mode.ts';

const activeParticipant = {
  status: 'active',
  recruitmentChannel: 'campus',
  isTest: false,
};

test('pilot invitation mode is explicit and rejects missing or unknown values', () => {
  assert.equal(isPilotInvitationMode('new'), true);
  assert.equal(isPilotInvitationMode('reissue'), true);
  assert.equal(isPilotInvitationMode(undefined), false);
  assert.equal(isPilotInvitationMode('auto'), false);
});

test('new participant mode never silently attaches an existing participant', () => {
  assert.deepEqual(
    decidePilotInvitationParticipant({
      mode: 'new',
      participant: null,
      recruitmentChannel: 'campus',
      isTest: false,
    }),
    { ok: true, action: 'create' },
  );
  assert.deepEqual(
    decidePilotInvitationParticipant({
      mode: 'new',
      participant: activeParticipant,
      recruitmentChannel: 'campus',
      isTest: false,
    }),
    { ok: false, error: 'participant_ref_conflict' },
  );
});

test('reissue mode requires a matching active participant profile', () => {
  assert.deepEqual(
    decidePilotInvitationParticipant({
      mode: 'reissue',
      participant: null,
      recruitmentChannel: 'campus',
      isTest: false,
    }),
    { ok: false, error: 'participant_reissue_not_found' },
  );
  assert.deepEqual(
    decidePilotInvitationParticipant({
      mode: 'reissue',
      participant: activeParticipant,
      recruitmentChannel: 'campus',
      isTest: false,
    }),
    { ok: true, action: 'reissue' },
  );
  assert.deepEqual(
    decidePilotInvitationParticipant({
      mode: 'reissue',
      participant: activeParticipant,
      recruitmentChannel: 'referral',
      isTest: false,
    }),
    { ok: false, error: 'participant_profile_conflict' },
  );
  assert.deepEqual(
    decidePilotInvitationParticipant({
      mode: 'reissue',
      participant: activeParticipant,
      recruitmentChannel: 'campus',
      isTest: true,
    }),
    { ok: false, error: 'participant_profile_conflict' },
  );
  assert.deepEqual(
    decidePilotInvitationParticipant({
      mode: 'reissue',
      participant: { ...activeParticipant, status: 'withdrawn' },
      recruitmentChannel: 'campus',
      isTest: false,
    }),
    { ok: false, error: 'participant_withdrawn' },
  );
});
