'use client';

import {
  CheckCircle2,
  KeyRound,
  Loader2,
  LogOut,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PILOT_NOTICE, PILOT_NOTICE_VERSION } from '@/lib/pilot-contract';

const PILOT_FLASH_KEY = 'xg-pilot-action-result';

export function PilotAccessPanel({
  active,
  expiresAt,
  testSession = false,
  returnTo,
}: {
  active: boolean;
  expiresAt?: number;
  testSession?: boolean;
  returnTo?: string;
}) {
  const [busy, setBusy] = useState<
    'join' | 'exit' | 'withdraw' | 'code-withdraw' | null
  >(null);
  const [message, setMessage] = useState('');
  const [messageIsError, setMessageIsError] = useState(false);
  const [codeWithdrawalComplete, setCodeWithdrawalComplete] = useState(false);

  useEffect(() => {
    if (active) return;
    try {
      const result = window.sessionStorage.getItem(PILOT_FLASH_KEY);
      window.sessionStorage.removeItem(PILOT_FLASH_KEY);
      if (result === 'withdrawn') {
        setMessage('研究同意已撤回，可识别产品研究关联已清理。');
      } else if (result === 'exited') {
        setMessage(
          '已退出这台设备。原邀请不能再次加入；研究同意仍可用原邀请代码撤回。',
        );
      }
    } catch {
      // Some privacy modes disable sessionStorage; server state is still final.
    }
  }, [active]);

  async function join(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('join');
    setMessage('');
    setMessageIsError(false);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/v1/pilot/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inviteCode: form.get('inviteCode'),
          noticeVersion: PILOT_NOTICE_VERSION,
          accepted: form.get('accepted') === 'on',
        }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? '无法加入试点。');
      }
      window.location.replace(returnTo ?? '/pilot');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法加入试点。');
      setMessageIsError(true);
      setBusy(null);
    }
  }

  async function leave(
    withdraw: boolean,
    inviteCode?: FormDataEntryValue | null,
  ) {
    if (
      !withdraw &&
      !window.confirm(
        '确认退出这台设备？当前试点会话会永久失效，原邀请代码不能再次加入；如需继续参与，要联系招募人员补发新邀请。研究同意仍可用原邀请代码撤回。',
      )
    ) {
      return false;
    }
    if (
      withdraw &&
      !window.confirm(
        '确认撤回研究同意？这会立即终止所有试点会话，并清理可识别映射与私有线索载荷。',
      )
    ) {
      return false;
    }
    setBusy(withdraw ? (inviteCode ? 'code-withdraw' : 'withdraw') : 'exit');
    setMessage('');
    setMessageIsError(false);
    try {
      const response = await fetch(
        withdraw ? '/v1/pilot/withdraw' : '/v1/pilot/session/exit',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            withdraw
              ? { confirm: 'withdraw', inviteCode: inviteCode ?? undefined }
              : {},
          ),
        },
      );
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? '操作失败，请稍后重试。');
      }
      if (withdraw && inviteCode) {
        setBusy(null);
        setMessage('研究同意已撤回，可识别产品研究关联已清理。');
      } else {
        try {
          window.sessionStorage.setItem(
            PILOT_FLASH_KEY,
            withdraw ? 'withdrawn' : 'exited',
          );
        } catch {
          // The destination page still reflects the server-side session state.
        }
        window.location.replace('/pilot');
      }
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '操作失败，请稍后重试。',
      );
      setMessageIsError(true);
      setBusy(null);
      return false;
    }
  }

  function withdrawByCode(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    void leave(true, form.get('inviteCode')).then((completed) => {
      if (!completed) return;
      formElement.reset();
      setCodeWithdrawalComplete(true);
    });
  }

  if (active) {
    return (
      <div className="space-y-5">
        <section className="overflow-hidden rounded-2xl border border-emerald-800/15 bg-card shadow-sm">
          <div className="flex items-center gap-4 bg-emerald-900/7 p-5 sm:p-6">
            <span className="grid size-12 place-items-center rounded-2xl bg-emerald-800 text-white">
              <CheckCircle2 aria-hidden="true" className="size-6" />
            </span>
            <div>
              <h2 className="font-heading text-xl font-semibold">
                试点会话已启用
              </h2>
              <p className="mt-1 text-sm text-foreground/65">
                {testSession ? '测试流量，不进入正式指标' : '正式成年研究队列'}
                {expiresAt
                  ? ` · 有效至 ${new Date(expiresAt * 1_000).toLocaleDateString('zh-CN')}`
                  : ''}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-px bg-border">
            <Link
              href="/"
              className="flex min-h-24 flex-col justify-center bg-card px-5 outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/40"
            >
              <Search aria-hidden="true" className="size-5 text-primary" />
              <span className="mt-2 font-semibold">开始查答案</span>
            </Link>
            <Link
              href="/research-intake"
              className="flex min-h-24 flex-col justify-center bg-card px-5 outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/40"
            >
              <ShieldCheck aria-hidden="true" className="size-5 text-primary" />
              <span className="mt-2 font-semibold">提交私有线索</span>
            </Link>
          </div>
        </section>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={busy !== null}
            onClick={() => void leave(false)}
          >
            {busy === 'exit' ? (
              <Loader2 className="animate-spin" />
            ) : (
              <LogOut />
            )}
            退出这台设备
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="text-destructive hover:text-destructive"
            disabled={busy !== null}
            onClick={() => void leave(true)}
          >
            {busy === 'withdraw' ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Trash2 />
            )}
            撤回研究同意
          </Button>
        </div>
        {message ? (
          <p
            role="status"
            className={
              messageIsError
                ? 'text-sm text-destructive'
                : 'text-sm text-emerald-800'
            }
          >
            {message}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={join}
        className="space-y-6 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7"
      >
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary">
            <KeyRound aria-hidden="true" className="size-5" />
          </span>
          <div>
            <h2 className="font-heading text-xl font-semibold">
              兑换一次性邀请
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              研究编号、证件和生日不会保存在浏览器中
            </p>
          </div>
        </div>
        <div>
          <label htmlFor="pilot-invite-code" className="text-sm font-semibold">
            邀请代码
          </label>
          <Input
            id="pilot-invite-code"
            name="inviteCode"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="pi1_…"
            className="mt-2 min-h-12 font-mono"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ['1', '查找行为', '只记结果数与筛选，不记问题正文'],
            ['2', '答案反馈', '关联当前一次查询，不建立匿名画像'],
            ['3', '随时撤回', '会话立即失效并清理私有载荷'],
          ].map(([number, title, detail]) => (
            <div key={number} className="rounded-xl bg-muted/55 p-3">
              <span className="grid size-7 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                {number}
              </span>
              <p className="mt-3 text-sm font-semibold">{title}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {detail}
              </p>
            </div>
          ))}
        </div>
        <section
          aria-labelledby="pilot-notice-heading"
          className="overflow-hidden rounded-xl border border-border"
        >
          <div className="border-b border-border bg-muted/45 px-4 py-3">
            <h3 id="pilot-notice-heading" className="font-semibold">
              参与前确认 · {PILOT_NOTICE.version}
            </h3>
          </div>
          <dl className="grid gap-px bg-border sm:grid-cols-2">
            {PILOT_NOTICE.sections.map((section) => (
              <div key={section.term} className="bg-card p-4">
                <dt className="text-sm font-semibold">{section.term}</dt>
                <dd className="mt-1 text-xs leading-5 text-muted-foreground">
                  {section.detail}
                </dd>
              </div>
            ))}
          </dl>
        </section>
        <label className="flex items-start gap-3 rounded-xl border border-primary/15 bg-primary/5 p-4 text-sm leading-6">
          <input
            type="checkbox"
            name="accepted"
            required
            className="mt-1 size-4 shrink-0 accent-primary"
          />
          {PILOT_NOTICE.consent}
        </label>
        <Button
          type="submit"
          size="lg"
          className="min-h-12"
          disabled={busy !== null}
        >
          {busy === 'join' ? (
            <Loader2 className="animate-spin" />
          ) : (
            <KeyRound />
          )}
          加入试点
        </Button>
      </form>
      {codeWithdrawalComplete ? null : (
        <details className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <summary className="cursor-pointer font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
            已退出或换设备，需要撤回研究同意？
          </summary>
          <form onSubmit={withdrawByCode} className="mt-4 space-y-4">
            <p className="text-xs leading-5 text-muted-foreground">
              输入最初兑换过的完整邀请代码即可撤回，无需恢复会话。撤回后该代码与研究编号的映射会被永久清除。
            </p>
            <div>
              <label
                htmlFor="pilot-withdraw-code"
                className="text-sm font-semibold"
              >
                原邀请代码
              </label>
              <Input
                id="pilot-withdraw-code"
                name="inviteCode"
                required
                autoComplete="off"
                spellCheck={false}
                placeholder="pi1_…"
                className="mt-2 min-h-12 font-mono"
              />
            </div>
            <Button
              type="submit"
              variant="destructive"
              size="lg"
              className="min-h-11"
              disabled={busy !== null}
            >
              {busy === 'code-withdraw' ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Trash2 />
              )}
              撤回研究同意
            </Button>
          </form>
        </details>
      )}
      {message ? (
        <p
          role="status"
          className={
            messageIsError
              ? 'text-sm text-destructive'
              : 'text-sm text-emerald-800'
          }
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
