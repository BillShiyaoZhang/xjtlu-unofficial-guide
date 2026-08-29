import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import {
  getLocalEditorFromCookieHeader,
  type LocalEditorUser,
  parseEditorReturnTo,
} from './editor-session';

export type EditorAuthResult =
  | { ok: true; user: LocalEditorUser }
  | {
      ok: false;
      status: 401 | 403;
      code: 'sign_in_required' | 'editor_forbidden';
    };

export async function getEditorApiAuth(): Promise<EditorAuthResult> {
  const requestHeaders = await headers();
  const localUser = await getLocalEditorFromCookieHeader(
    requestHeaders.get('cookie'),
  );
  if (localUser) return { ok: true, user: localUser };
  return { ok: false, status: 401, code: 'sign_in_required' };
}

export async function getEditorUser(): Promise<LocalEditorUser | null> {
  const auth = await getEditorApiAuth();
  return auth.ok ? auth.user : null;
}

export async function requireEditorPage(returnTo: string) {
  const requestHeaders = await headers();
  const localUser = await getLocalEditorFromCookieHeader(
    requestHeaders.get('cookie'),
  );
  if (localUser) return { user: localUser, allowed: true };

  const safeReturnTo = parseEditorReturnTo(returnTo);
  redirect(`/editor/login?returnTo=${encodeURIComponent(safeReturnTo)}`);
}
