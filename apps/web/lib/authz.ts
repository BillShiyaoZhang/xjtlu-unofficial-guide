import { getRuntimeValue } from '@/db';

import {
  getChatGPTUser,
  requireChatGPTUser,
  type ChatGPTUser,
} from '@/app/chatgpt-auth';

import { emailIsAllowlisted, parseEditorAllowlist } from './permissions';

export type EditorAuthResult =
  | { ok: true; user: ChatGPTUser }
  | {
      ok: false;
      status: 401 | 403;
      code: 'sign_in_required' | 'editor_forbidden';
    };

export function editorAllowlist(): Set<string> {
  return parseEditorAllowlist(getRuntimeValue('EDITOR_EMAILS'));
}

export function isEditorEmail(email: string): boolean {
  return emailIsAllowlisted(email, getRuntimeValue('EDITOR_EMAILS'));
}

export async function getEditorApiAuth(): Promise<EditorAuthResult> {
  const user = await getChatGPTUser();
  if (!user) return { ok: false, status: 401, code: 'sign_in_required' };
  if (!isEditorEmail(user.email)) {
    return { ok: false, status: 403, code: 'editor_forbidden' };
  }
  return { ok: true, user };
}

export async function requireEditorPage(returnTo: string) {
  const user = await requireChatGPTUser(returnTo);
  return { user, allowed: isEditorEmail(user.email) };
}
