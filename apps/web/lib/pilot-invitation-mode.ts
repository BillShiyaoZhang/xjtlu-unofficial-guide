export const PILOT_INVITATION_MODES = ['new', 'reissue'] as const;

export type PilotInvitationMode = (typeof PILOT_INVITATION_MODES)[number];

export type PilotParticipantMatch = {
  status: string;
  recruitmentChannel: string;
  isTest: boolean;
};

export type PilotInvitationParticipantDecision =
  | { ok: true; action: 'create' | 'reissue' }
  | {
      ok: false;
      error:
        | 'participant_reissue_not_found'
        | 'participant_withdrawn'
        | 'participant_profile_conflict'
        | 'participant_ref_conflict';
    };

export function isPilotInvitationMode(
  value: unknown,
): value is PilotInvitationMode {
  return value === 'new' || value === 'reissue';
}

export function decidePilotInvitationParticipant(input: {
  mode: PilotInvitationMode;
  participant: PilotParticipantMatch | null;
  recruitmentChannel: string;
  isTest: boolean;
}): PilotInvitationParticipantDecision {
  const { mode, participant } = input;
  if (!participant) {
    return mode === 'new'
      ? { ok: true, action: 'create' }
      : { ok: false, error: 'participant_reissue_not_found' };
  }
  if (participant.status === 'withdrawn') {
    return { ok: false, error: 'participant_withdrawn' };
  }
  if (mode === 'new') {
    return { ok: false, error: 'participant_ref_conflict' };
  }
  if (
    participant.recruitmentChannel !== input.recruitmentChannel ||
    participant.isTest !== input.isTest
  ) {
    return { ok: false, error: 'participant_profile_conflict' };
  }
  return { ok: true, action: 'reissue' };
}
