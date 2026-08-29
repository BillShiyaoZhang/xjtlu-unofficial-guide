'use client';

import { Loader2, Send } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';

type CardOption = { id: string; title: string };

export function ReportForm({
  cards,
  defaultCardId = '',
  defaultType = '',
  pilotActive,
}: {
  cards: CardOption[];
  defaultCardId?: string;
  defaultType?: string;
  pilotActive: boolean;
}) {
  const [state, setState] = useState<'idle' | 'sending' | 'error'>('idle');
  const [reportType, setReportType] = useState(defaultType);
  const [cardId, setCardId] = useState(defaultCardId);
  const [message, setMessage] = useState('');
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const router = useRouter();

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setState('sending');
    setMessage('');
    const form = new FormData(event.currentTarget);
    const payload = {
      cardId: form.get('cardId') || null,
      type: form.get('type'),
      affectedArea: form.get('affectedArea') || null,
    };
    const fingerprint = JSON.stringify(payload);
    if (!attempt.current || attempt.current.fingerprint !== fingerprint) {
      attempt.current = { fingerprint, key: crypto.randomUUID() };
    }
    try {
      const response = await fetch('/v1/reports', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': attempt.current.key,
        },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as {
        data?: { code: string };
        error?: { message: string };
      };
      if (!response.ok || !result.data)
        throw new Error(result.error?.message ?? 'submit_failed');
      router.replace(`/reports/${result.data.code}`);
    } catch (error) {
      setMessage(
        error instanceof Error && error.message !== 'submit_failed'
          ? error.message
          : '暂时无法提交，请检查选择后重试。',
      );
      setState('error');
    }
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
          onChange={(event) => setCardId(event.target.value)}
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
      {reportType === 'privacy' && !cardId ? (
        <div>
          <label
            htmlFor="report-affected-area"
            className="text-sm font-semibold"
          >
            隐私问题出现在哪个区域
          </label>
          <select
            id="report-affected-area"
            name="affectedArea"
            required
            defaultValue=""
            className="mt-2 min-h-12 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            <option value="" disabled>
              请选择功能区域
            </option>
            <option value="home">首页</option>
            <option value="search">查找页（不要粘贴具体搜索链接）</option>
            <option value="topics">话题页</option>
            <option value="pilot">试点加入与撤回</option>
            <option value="intake">私有线索</option>
            <option value="reporting">报告流程</option>
            <option value="other">其他公开页面</option>
          </select>
        </div>
      ) : null}
      {reportType && reportType !== 'privacy' ? (
        <div className="rounded-lg border border-border bg-muted/35 p-4 text-sm leading-6">
          {pilotActive ? (
            <p className="font-medium text-emerald-900">
              当前成年试点会话有效，可提交这类结构化报告。
            </p>
          ) : (
            <p>
              这类报告只向已加入试点的成年参与者开放。{' '}
              <Link
                href={`/pilot?returnTo=${encodeURIComponent(
                  `/report?${new URLSearchParams({
                    ...(cardId ? { card: cardId } : {}),
                    ...(reportType ? { type: reportType } : {}),
                  }).toString()}`,
                )}`}
                className="font-semibold text-primary underline underline-offset-4"
              >
                使用邀请代码加入
              </Link>
            </p>
          )}
        </div>
      ) : null}
      <div className="rounded-lg bg-muted/60 p-4 text-sm leading-6 text-muted-foreground">
        阶段 1
        只收集结构化选项，不收自由文本或账号信息。隐私问题不会关联试点研究 ID
        或应用账号；网络安全日志仍按运营说明处理。其他类型会关联当前试点的随机研究
        ID，以便去重和处理，但不会保存研究编号原文。紧急人身安全事件请联系相应正式渠道。
      </div>
      <Button
        type="submit"
        size="lg"
        className="min-h-12"
        disabled={
          state === 'sending' ||
          (reportType !== '' && reportType !== 'privacy' && !pilotActive)
        }
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
