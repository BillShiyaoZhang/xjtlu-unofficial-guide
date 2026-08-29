import { ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';

import { EditorNav } from '@/components/editor-nav';
import { EditorSecurityPanel } from '@/components/editor-security-panel';
import { requireEditorPage } from '@/lib/authz';
import { listOwnEditorSessions } from '@/lib/editor-session';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '账号安全' };

export default async function EditorSecurityPage() {
  const { user } = await requireEditorPage('/editor/security');
  const sessions = user.legacy ? [] : await listOwnEditorSessions(user.userId);
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
          <ShieldCheck className="size-6" />
        </span>
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            账号安全
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{user.email}</p>
        </div>
      </header>
      <EditorSecurityPanel
        sessions={sessions}
        currentSessionId={user.sessionId}
        legacy={user.legacy}
      />
    </main>
  );
}
