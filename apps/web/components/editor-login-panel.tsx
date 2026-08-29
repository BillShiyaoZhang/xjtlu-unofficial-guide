'use client';

import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function EditorLoginPanel({
  returnTo,
  mode,
}: {
  returnTo: string;
  mode: 'named' | 'legacy' | 'unconfigured';
}) {
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
          ...(mode === 'named'
            ? {
                email: form.get('email'),
                password: form.get('password'),
                mfaCode: form.get('mfaCode'),
              }
            : { secret: form.get('secret') }),
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
      {mode === 'named' ? (
        <>
          <div>
            <label htmlFor="editor-email" className="text-sm font-semibold">
              工作邮箱
            </label>
            <Input
              id="editor-email"
              name="email"
              type="email"
              required
              autoComplete="username"
              className="mt-2 min-h-12"
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="editor-password" className="text-sm font-semibold">
              密码
            </label>
            <Input
              id="editor-password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="mt-2 min-h-12"
            />
          </div>
          <div>
            <label htmlFor="editor-mfa" className="text-sm font-semibold">
              验证器代码
            </label>
            <Input
              id="editor-mfa"
              name="mfaCode"
              inputMode="numeric"
              required
              autoComplete="one-time-code"
              placeholder="6 位代码或恢复码"
              className="mt-2 min-h-12 font-mono tracking-[0.18em]"
            />
          </div>
          <p className="flex gap-3 rounded-xl bg-muted/55 p-4 text-xs leading-5 text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
            会话可单独撤销，空闲 30 分钟自动结束，最长有效 8 小时。
          </p>
        </>
      ) : mode === 'legacy' ? (
        <>
          <div>
            <label htmlFor="editor-secret" className="text-sm font-semibold">
              本地演示口令
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
          <p className="rounded-xl border border-amber-700/20 bg-amber-500/10 p-4 text-xs leading-5 text-amber-950">
            当前是开发兼容入口。创建首个具名账号后会自动停用；真实试点不能使用共享口令。
          </p>
        </>
      ) : (
        <p className="rounded-xl border border-destructive/20 bg-destructive/8 p-4 text-sm leading-6 text-destructive">
          尚未配置编辑账号。请先设置具名账号的安全密钥和首位管理员资料。
        </p>
      )}
      <Button
        type="submit"
        size="lg"
        className="min-h-12 w-full"
        disabled={busy || mode === 'unconfigured'}
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
