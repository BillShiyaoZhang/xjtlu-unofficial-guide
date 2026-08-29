'use client';

import { Check, HelpCircle, Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';

export function FeedbackButtons({ revisionId }: { revisionId: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>(
    'idle',
  );
  const key = useRef<string>(crypto.randomUUID());

  async function submit(outcome: 'resolved' | 'unclear') {
    setState('sending');
    try {
      const response = await fetch('/v1/feedback', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': key.current,
        },
        body: JSON.stringify({ cardRevisionId: revisionId, outcome }),
      });
      if (!response.ok) throw new Error('feedback_failed');
      setState('done');
    } catch {
      key.current = crypto.randomUUID();
      setState('error');
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
    <div>
      <p className="font-heading text-sm font-semibold">
        这张答案卡解决了你的问题吗？
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="min-h-11"
          disabled={state === 'sending'}
          onClick={() => void submit('resolved')}
        >
          {state === 'sending' ? (
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
          className="min-h-11"
          disabled={state === 'sending'}
          onClick={() => void submit('unclear')}
        >
          <HelpCircle />
          仍不清楚
        </Button>
      </div>
      {state === 'error' ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          暂时无法记录，请稍后重试。
        </p>
      ) : null}
    </div>
  );
}
