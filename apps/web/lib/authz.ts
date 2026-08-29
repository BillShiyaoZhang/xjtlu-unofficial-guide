import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import {
  getLocalEditorFromCookieHeader,
  hasEditorPermission,
  type EditorPermission,
  type LocalEditorUser,
  parseEditorReturnTo,
} from './editor-session';

export type EditorAuthResult =
  | { ok: true; user: LocalEditorUser }
  | {
      ok: false;
      status: 401 | 403;
      code:
        | 'sign_in_required'
        | 'editor_forbidden'
        | 'editor_password_change_required';
      requiredPermission?: EditorPermission;
    };

export async function getEditorApiAuth(
  requiredPermission?: EditorPermission,
): Promise<EditorAuthResult> {
  const requestHeaders = await headers();
  const localUser = await getLocalEditorFromCookieHeader(
    requestHeaders.get('cookie'),
  );
  if (!localUser) return { ok: false, status: 401, code: 'sign_in_required' };
  if (requiredPermission && localUser.mustChangePassword) {
    return {
      ok: false,
      status: 403,
      code: 'editor_password_change_required',
      requiredPermission,
    };
  }
  if (
    requiredPermission &&
    !hasEditorPermission(localUser, requiredPermission)
  ) {
    return {
      ok: false,
      status: 403,
      code: 'editor_forbidden',
      requiredPermission,
    };
  }
  return { ok: true, user: localUser };
}

export async function getEditorUser(): Promise<LocalEditorUser | null> {
  const auth = await getEditorApiAuth();
  return auth.ok ? auth.user : null;
}

export async function requireEditorPage(
  returnTo: string,
  requiredPermission?: EditorPermission,
) {
  const requestHeaders = await headers();
  const localUser = await getLocalEditorFromCookieHeader(
    requestHeaders.get('cookie'),
  );
  if (localUser) {
    return {
      user: localUser,
      allowed:
        !requiredPermission ||
        (!localUser.mustChangePassword &&
          hasEditorPermission(localUser, requiredPermission)),
    };
  }

  const safeReturnTo = parseEditorReturnTo(returnTo);
  redirect(`/editor/login?returnTo=${encodeURIComponent(safeReturnTo)}`);
}
