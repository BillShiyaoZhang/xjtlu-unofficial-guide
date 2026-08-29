'use client';

import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';

export function AnswerCardVisibilityPanel({
  cardId,
  status,
  lockVersion,
}: {
  cardId: string;
  status: string;
  lockVersion: number;
}) {
  const [state, setState] = useState<'idle' | 'sending' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const key = useRef(crypto.randomUUID());
  if (status !== 'published' && status !== 'hidden') return null;
  const targetStatus = status === 'published' ? 'hidden' : 'published';

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setState('sending');
    setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(
        `/v1/editor/answer-cards/${cardId}/visibility`,
        {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': key.current,
            'if-match': `"${lockVersion}"`,
          },
          body: JSON.stringify({
            status: targetStatus,
            reason: form.get('reason'),
          }),
        },
      );
      const payload = (await response.json()) as {
        error?: { message: string };
      };
      if (!response.ok) throw new Error(payload.error?.message ?? '操作失败');
      window.location.reload();
    } catch (error) {
      key.current = crypto.randomUUID();
      setMessage(error instanceof Error ? error.message : '操作失败');
      setState('error');
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mb-8 rounded-xl border border-border bg-card p-5"
    >
      <div className="flex items-start gap-3">
        {status === 'published' ? (
          <EyeOff className="mt-0.5 size-5 shrink-0 text-destructive" />
        ) : (
          <Eye className="mt-0.5 size-5 shrink-0 text-primary" />
        )}
        <div className="flex-1">
          <h2 className="font-heading text-xl font-semibold">
            {status === 'published' ? '紧急隐藏答案卡' : '恢复公开答案卡'}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {status === 'published'
              ? '隐藏会立即阻断当前页和全部历史版本的公开读取；原始审计与不可变修订仍只在编辑区保留。'
              : '恢复前请确认隐私、版权或准确性问题已经处理。'}
          </p>
          <label
            htmlFor="visibility-reason"
            className="mt-4 block text-sm font-semibold"
          >
            操作理由
          </label>
          <textarea
            id="visibility-reason"
            name="reason"
            required
            minLength={8}
            maxLength={400}
            rows={3}
            className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
          />
          <Button
            type="submit"
            variant={status === 'published' ? 'destructive' : 'outline'}
            className="mt-4 min-h-11"
            disabled={state === 'sending'}
          >
            {state === 'sending' ? <Loader2 className="animate-spin" /> : null}
            {status === 'published' ? '隐藏全部公开版本' : '恢复公开'}
          </Button>
          {state === 'error' ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {message}
            </p>
          ) : null}
        </div>
      </div>
    </form>
  );
}
