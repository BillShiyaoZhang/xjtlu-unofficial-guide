'use client';

import { KeyRound, Loader2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function EditorLoginPanel({ returnTo }: { returnTo: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/v1/editor/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          secret: form.get('secret'),
          returnTo,
        }),
      });
      const payload = (await response.json()) as {
        data?: { returnTo?: string };
        error?: { message?: string };
      };
      if (!response.ok || !payload.data?.returnTo) {
        throw new Error(payload.error?.message ?? '无法登录编辑工作台。');
      }
      window.location.replace(payload.data.returnTo);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '无法登录编辑工作台。',
      );
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7"
    >
      <div>
        <label htmlFor="editor-secret" className="text-sm font-semibold">
          本地编辑口令
        </label>
        <Input
          id="editor-secret"
          name="secret"
          type="password"
          required
          autoComplete="current-password"
          className="mt-2 min-h-12"
          autoFocus
        />
      </div>
      <p className="rounded-xl bg-muted/55 p-4 text-xs leading-5 text-muted-foreground">
        应用只签发 8 小时安全会话，不把口令写入 localStorage
        或数据库；是否由密码管理器保存取决于你的浏览器设置。
      </p>
      <Button
        type="submit"
        size="lg"
        className="min-h-12 w-full"
        disabled={busy}
      >
        {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
        进入工作台
      </Button>
      {message ? (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      ) : null}
    </form>
  );
}
