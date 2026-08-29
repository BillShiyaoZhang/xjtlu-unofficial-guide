'use client';

import {
  Copy,
  KeyRound,
  LifeBuoy,
  Loader2,
  LogOut,
  ShieldCheck,
} from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDateTime } from '@/lib/presentation';

type Session = {
  id: string;
  issuedAt: number;
  lastSeenAt: number;
  idleExpiresAt: number;
  absoluteExpiresAt: number;
  revokedAt: number | null;
};

export function EditorSecurityPanel({
  sessions: initial,
  currentSessionId,
  legacy,
}: {
  sessions: Session[];
  currentSessionId: string | null;
  legacy: boolean;
}) {
  const [sessions, setSessions] = useState(initial);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  async function changePassword(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('password');
    setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/v1/editor/account/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          currentPassword: form.get('currentPassword'),
          newPassword: form.get('newPassword'),
          mfaCode: form.get('mfaCode'),
        }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(payload.error?.message ?? '修改失败。');
      window.location.replace('/editor/login');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '修改失败。');
      setBusy('');
    }
  }

  async function revoke(sessionId: string) {
    setBusy(sessionId);
    setMessage('');
    try {
      const response = await fetch(`/v1/editor/sessions/${sessionId}/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(payload.error?.message ?? '撤销失败。');
      if (sessionId === currentSessionId) {
        window.location.replace('/editor/login');
        return;
      }
      setSessions((current) =>
        current.map((item) =>
          item.id === sessionId
            ? { ...item, revokedAt: Math.floor(Date.now() / 1_000) }
            : item,
        ),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '撤销失败。');
    } finally {
      setBusy('');
    }
  }

  async function regenerateRecoveryCodes(
    event: React.SyntheticEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    setBusy('recovery');
    setMessage('');
    setRecoveryCodes([]);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/v1/editor/account/recovery-codes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          currentPassword: form.get('currentPassword'),
          mfaCode: form.get('mfaCode'),
        }),
      });
      const payload = (await response.json()) as {
        data?: { codes?: string[] };
        error?: { message?: string };
      };
      if (!response.ok || !payload.data?.codes?.length) {
        throw new Error(payload.error?.message ?? '生成失败。');
      }
      setRecoveryCodes(payload.data.codes);
      event.currentTarget.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '生成失败。');
    } finally {
      setBusy('');
    }
  }

  async function copyRecoveryCodes() {
    await navigator.clipboard.writeText(recoveryCodes.join('\n'));
    setMessage('恢复码已复制。请保存到密码管理器，并清空剪贴板历史。');
  }

  async function revokeAll() {
    setBusy('all');
    setMessage('');
    try {
      const response = await fetch('/v1/editor/sessions/revoke-all', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) {
        const payload = (await response.json()) as {
          error?: { message?: string };
        };
        throw new Error(payload.error?.message ?? '撤销失败。');
      }
      window.location.replace('/editor/login');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '撤销失败。');
      setBusy('');
    }
  }

  if (legacy) {
    return (
      <div className="rounded-2xl border border-amber-700/20 bg-amber-500/10 p-6 text-sm leading-6 text-amber-950">
        当前使用本地演示共享账号。配置具名管理员后，共享入口会自动停用，并开放密码、双重验证和会话管理。
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <form
        onSubmit={changePassword}
        className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
      >
        <div className="flex items-center gap-3">
          <KeyRound className="size-5 text-primary" />
          <h2 className="font-heading text-xl font-semibold">修改密码</h2>
        </div>
        <div className="mt-5 space-y-4">
          <label className="block text-sm font-semibold">
            当前密码
            <Input
              name="currentPassword"
              type="password"
              required
              className="mt-2 min-h-11"
            />
          </label>
          <label className="block text-sm font-semibold">
            新密码
            <Input
              name="newPassword"
              type="password"
              required
              minLength={14}
              className="mt-2 min-h-11"
            />
          </label>
          <label className="block text-sm font-semibold">
            验证器代码
            <Input
              name="mfaCode"
              required
              inputMode="numeric"
              pattern="[0-9]{6}"
              className="mt-2 min-h-11 font-mono tracking-[0.18em]"
            />
          </label>
        </div>
        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          修改后会撤销所有会话，需要使用新密码重新登录。
        </p>
        <Button type="submit" className="mt-5" disabled={Boolean(busy)}>
          {busy === 'password' ? (
            <Loader2 className="animate-spin" />
          ) : (
            <ShieldCheck />
          )}
          修改并重新登录
        </Button>
      </form>

      <form
        onSubmit={regenerateRecoveryCodes}
        className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
      >
        <div className="flex items-center gap-3">
          <LifeBuoy className="size-5 text-primary" />
          <h2 className="font-heading text-xl font-semibold">登录恢复码</h2>
        </div>
        {recoveryCodes.length ? (
          <div className="mt-5">
            <p className="rounded-lg bg-amber-500/10 p-3 text-xs leading-5 text-amber-950">
              这组代码只显示一次，旧恢复码已经全部失效。
            </p>
            <ol className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-border bg-muted/35 p-4 font-mono text-xs">
              {recoveryCodes.map((code) => (
                <li key={code}>{code}</li>
              ))}
            </ol>
            <Button
              type="button"
              variant="outline"
              className="mt-4"
              onClick={copyRecoveryCodes}
            >
              <Copy /> 复制全部
            </Button>
          </div>
        ) : (
          <>
            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              忘记验证器时，每个恢复码只能登录一次。生成新一组会立即废止旧码。
            </p>
            <div className="mt-5 space-y-4">
              <label className="block text-sm font-semibold">
                当前密码
                <Input
                  name="currentPassword"
                  type="password"
                  required
                  className="mt-2 min-h-11"
                />
              </label>
              <label className="block text-sm font-semibold">
                验证器代码
                <Input
                  name="mfaCode"
                  required
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  className="mt-2 min-h-11 font-mono tracking-[0.18em]"
                />
              </label>
            </div>
            <Button type="submit" className="mt-5" disabled={Boolean(busy)}>
              {busy === 'recovery' ? (
                <Loader2 className="animate-spin" />
              ) : (
                <LifeBuoy />
              )}
              生成新恢复码
            </Button>
          </>
        )}
      </form>

      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-heading text-xl font-semibold">登录会话</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              最多显示最近 20 条
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={revokeAll}
            disabled={Boolean(busy)}
          >
            <LogOut />
            全部退出
          </Button>
        </div>
        <div className="mt-5 space-y-3">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="rounded-xl border border-border p-4 text-xs"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">
                    {session.id === currentSessionId ? '当前会话' : '编辑会话'}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    最近活动 {formatDateTime(session.lastSeenAt)}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    最晚结束 {formatDateTime(session.absoluteExpiresAt)}
                  </p>
                </div>
                {session.revokedAt ? (
                  <span className="text-muted-foreground">已结束</span>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => revoke(session.id)}
                    disabled={Boolean(busy)}
                  >
                    {busy === session.id ? (
                      <Loader2 className="animate-spin" />
                    ) : null}
                    撤销
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
      {message ? (
        <p role="alert" className="lg:col-span-2 text-sm text-destructive">
          {message}
        </p>
      ) : null}
    </div>
  );
}
