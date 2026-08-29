import { Users } from 'lucide-react';
import type { Metadata } from 'next';

import { EditorAccessDenied } from '@/components/editor-access-denied';
import { EditorAccountManager } from '@/components/editor-account-manager';
import { EditorNav } from '@/components/editor-nav';
import { requireEditorPage } from '@/lib/authz';
import { listEditorAccounts } from '@/lib/editor-session';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '账号与权限' };

export default async function EditorAccountsPage() {
  const { user, allowed } = await requireEditorPage(
    '/editor/accounts',
    'accounts:manage',
  );
  if (!allowed) return <EditorAccessDenied email={user.email} />;
  const accounts = await listEditorAccounts();
  return (
    <main
      id="main-content"
      className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8"
    >
      <EditorNav
        displayName={user.displayName}
        permissions={user.permissions}
      />
      <header className="mb-8 flex items-center gap-4">
        <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Users className="size-6" />
        </span>
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            账号与权限
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            具名归因、职责分离和会话即时撤销
          </p>
        </div>
      </header>
      <EditorAccountManager initial={accounts} />
    </main>
  );
}
