'use client';

import { Loader2, Send } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type CardOption = { id: string; title: string };

export function ReportForm({
  cards,
  defaultCardId = '',
}: {
  cards: CardOption[];
  defaultCardId?: string;
}) {
  const [state, setState] = useState<'idle' | 'sending' | 'error'>('idle');
  const [result, setResult] = useState<{ code: string } | null>(null);
  const [reportType, setReportType] = useState('');
  const [message, setMessage] = useState('');
  const key = useRef(crypto.randomUUID());

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setState('sending');
    setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/v1/reports', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': key.current,
        },
        body: JSON.stringify({
          cardId: form.get('cardId') || null,
          type: form.get('type'),
          inviteSecret: form.get('inviteSecret') || '',
          adultAttested: form.get('adultAttested') === 'on',
        }),
      });
      const payload = (await response.json()) as {
        data?: { code: string };
        error?: { message: string };
      };
      if (!response.ok || !payload.data)
        throw new Error(payload.error?.message ?? 'submit_failed');
      setResult(payload.data);
      setState('idle');
    } catch (error) {
      key.current = crypto.randomUUID();
      setMessage(
        error instanceof Error && error.message !== 'submit_failed'
          ? error.message
          : '暂时无法提交，请检查选择后重试。',
      );
      setState('error');
    }
  }

  if (result) {
    return (
      <output className="block rounded-xl border border-emerald-800/15 bg-emerald-900/7 p-6">
        <h2 className="font-heading text-2xl font-semibold">报告已收到</h2>
        <p className="mt-3 leading-7 text-foreground/75">
          报告编号为 <strong>{result.code}</strong>
          。报告不会自动更改公开内容，编辑复核后再处理。
        </p>
        <Link
          href={`/reports/${result.code}`}
          className={cn(
            buttonVariants({ variant: 'outline', size: 'lg' }),
            'mt-5 min-h-11',
          )}
        >
          查看处理状态
        </Link>
      </output>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-6 rounded-xl border border-border bg-card p-5 shadow-sm sm:p-7"
    >
      <div>
        <label htmlFor="report-card" className="text-sm font-semibold">
          相关答案卡
        </label>
        <select
          id="report-card"
          name="cardId"
          defaultValue={defaultCardId}
          required={reportType !== '' && reportType !== 'privacy'}
          className="mt-2 min-h-12 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          <option value="">不确定 / 全站隐私问题</option>
          {cards.map((card) => (
            <option key={card.id} value={card.id}>
              {card.title}
            </option>
          ))}
        </select>
      </div>
      <fieldset>
        <legend className="text-sm font-semibold">问题类型</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {[
            ['stale', '疑似过期'],
            ['scope_error', '适用范围错误'],
            ['source_mismatch', '来源与原文不符'],
            ['privacy', '隐私或敏感信息'],
          ].map(([value, label]) => (
            <label
              key={value}
              className="flex min-h-12 items-center gap-3 rounded-lg border border-border px-3 hover:bg-muted"
            >
              <input
                type="radio"
                name="type"
                value={value}
                required
                checked={reportType === value}
                onChange={(event) => setReportType(event.target.value)}
                className="size-4 accent-primary"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      {reportType && reportType !== 'privacy' ? (
        <fieldset className="space-y-4 rounded-lg border border-border bg-muted/35 p-4">
          <legend className="px-1 text-sm font-semibold">
            受邀成年试点参与者确认
          </legend>
          <div>
            <label
              htmlFor="report-invite-secret"
              className="text-sm font-medium"
            >
              邀请凭证
            </label>
            <input
              id="report-invite-secret"
              name="inviteSecret"
              type="password"
              required
              autoComplete="off"
              className="mt-2 min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
            />
          </div>
          <label className="flex items-start gap-3 text-sm leading-6">
            <input
              type="checkbox"
              name="adultAttested"
              required
              className="mt-1 size-4 shrink-0 accent-primary"
            />
            我已通过招募方的线下流程确认成年。邀请凭证不会写入报告记录。
          </label>
        </fieldset>
      ) : null}
      <div className="rounded-lg bg-muted/60 p-4 text-sm leading-6 text-muted-foreground">
        阶段 1 只收集结构化选项，不收自由文本、账号、Cookie
        或持久用户标识。隐私问题可匿名报告；其他类型只向受邀成年试点参与者开放。紧急人身安全事件请联系相应正式渠道。
      </div>
      <Button
        type="submit"
        size="lg"
        className="min-h-12"
        disabled={state === 'sending'}
      >
        {state === 'sending' ? <Loader2 className="animate-spin" /> : <Send />}
        提交报告
      </Button>
      {state === 'error' ? (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      ) : null}
    </form>
  );
}
