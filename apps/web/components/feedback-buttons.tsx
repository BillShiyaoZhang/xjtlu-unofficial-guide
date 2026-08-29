'use client';

import { Check, HelpCircle, Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';

export function FeedbackButtons({
  revisionId,
  queryEventId,
}: {
  revisionId: string;
  queryEventId?: string;
}) {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>(
    'idle',
  );
  const [pendingOutcome, setPendingOutcome] = useState<
    'resolved' | 'unclear' | null
  >(null);
  const [message, setMessage] = useState('');
  const keys = useRef(new Map<string, string>());

  async function submit(outcome: 'resolved' | 'unclear') {
    setState('sending');
    setPendingOutcome(outcome);
    setMessage('');
    const fingerprint = JSON.stringify({
      cardRevisionId: revisionId,
      queryEventId: queryEventId ?? null,
      outcome,
    });
    const key = keys.current.get(fingerprint) ?? crypto.randomUUID();
    keys.current.set(fingerprint, key);
    try {
      const response = await fetch('/v1/feedback', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': key,
        },
        body: JSON.stringify({
          cardRevisionId: revisionId,
          queryEventId: queryEventId ?? null,
          outcome,
        }),
      });
      const result = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(result.error?.message ?? 'feedback_failed');
      }
      setState('done');
      setPendingOutcome(null);
    } catch (error) {
      setMessage(
        error instanceof Error && error.message !== 'feedback_failed'
          ? error.message
          : '暂时无法记录，请稍后重试。',
      );
      setState('error');
      setPendingOutcome(null);
    }
  }

  if (state === 'done') {
    return (
      <output className="flex items-center gap-2 text-sm text-emerald-900">
        <Check aria-hidden="true" className="size-4" />
        谢谢。你的选择只用于汇总改进，不会自动改变答案状态。
      </output>
    );
  }

  return (
    <div aria-busy={state === 'sending'}>
      <p className="font-heading text-sm font-semibold">
        这张答案卡解决了你的问题吗？
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="min-h-12 w-full sm:w-auto"
          disabled={state === 'sending'}
          onClick={() => void submit('resolved')}
        >
          {state === 'sending' && pendingOutcome === 'resolved' ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Check />
          )}
          已解决
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="min-h-12 w-full sm:w-auto"
          disabled={state === 'sending'}
          onClick={() => void submit('unclear')}
        >
          {state === 'sending' && pendingOutcome === 'unclear' ? (
            <Loader2 className="animate-spin" />
          ) : (
            <HelpCircle />
          )}
          仍不清楚
        </Button>
      </div>
      {state === 'error' ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {message}
        </p>
      ) : null}
    </div>
  );
}
