export const EDITOR_ROLES = [
  'content_editor',
  'content_reviewer',
  'pilot_operator',
  'safety_reviewer',
  'account_admin',
  'operations_admin',
] as const;
export type EditorRole = (typeof EDITOR_ROLES)[number];

export const EDITOR_PERMISSIONS = [
  'content:read',
  'content:edit',
  'content:publish',
  'content:visibility',
  'pilot:manage',
  'safety:manage',
  'accounts:manage',
  'operations:manage',
] as const;
export type EditorPermission = (typeof EDITOR_PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<EditorRole, readonly EditorPermission[]> =
  {
    content_editor: ['content:read', 'content:edit'],
    content_reviewer: ['content:read', 'content:publish', 'content:visibility'],
    pilot_operator: ['pilot:manage'],
    safety_reviewer: ['safety:manage', 'content:visibility'],
    account_admin: ['accounts:manage'],
    operations_admin: ['operations:manage'],
  };
