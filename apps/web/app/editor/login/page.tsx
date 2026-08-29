import { KeyRound } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { EditorLoginPanel } from '@/components/editor-login-panel';
import { getEditorApiAuth } from '@/lib/authz';
import { getEditorLoginMode, parseEditorReturnTo } from '@/lib/editor-session';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '编辑登录' };

export default async function EditorLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const returnTo = parseEditorReturnTo(
    typeof params.returnTo === 'string' ? params.returnTo : undefined,
  );
  const auth = await getEditorApiAuth();
  if (auth.ok) redirect(returnTo);
  const loginMode = await getEditorLoginMode();

  return (
    <main
      id="main-content"
      className="mx-auto max-w-lg px-4 py-8 sm:px-6 sm:py-16"
    >
      <header className="mb-7 flex items-center gap-4">
        <span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
          <KeyRound aria-hidden="true" className="size-6" />
        </span>
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            编辑登录
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            本机内容维护与试点管理
          </p>
        </div>
      </header>
      <EditorLoginPanel returnTo={returnTo} mode={loginMode.mode} />
    </main>
  );
}
