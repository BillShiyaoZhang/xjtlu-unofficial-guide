'use client';

import { Loader2, Send } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export function PublishRevisionPanel({
  revisionId,
  lockVersion,
}: {
  revisionId: string;
  lockVersion: number;
}) {
  const [reason, setReason] = useState(
    '已核对适用范围、逐句来源和复核期限，批准发布。',
  );
  const [state, setState] = useState<'idle' | 'sending' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const key = useRef(crypto.randomUUID());

  async function publish() {
    setState('sending');
    setMessage('');
    try {
      const response = await fetch(
        `/v1/editor/answer-card-revisions/${revisionId}/publish`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': key.current,
            'if-match': `"${lockVersion}"`,
          },
          body: JSON.stringify({ reason }),
        },
      );
      const payload = (await response.json()) as {
        error?: { message: string };
      };
      if (!response.ok) throw new Error(payload.error?.message ?? '发布失败');
      window.location.reload();
    } catch (error) {
      key.current = crypto.randomUUID();
      setMessage(error instanceof Error ? error.message : '发布失败');
      setState('error');
    }
  }

  return (
    <section className="rounded-xl border border-primary/20 bg-primary/6 p-5">
      <h2 className="font-heading text-xl font-semibold">发布审核</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        发布会在数据库事务中再次校验逐句引用、来源公开性、权利、范围、高风险规则和对象版本，然后原子切换公开指针并写入审计事件。
      </p>
      <label
        htmlFor="publish-reason"
        className="mt-5 block text-sm font-semibold"
      >
        审核理由
      </label>
      <Textarea
        id="publish-reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        maxLength={400}
        rows={3}
        className="mt-2 bg-background"
      />
      <Button
        type="button"
        size="lg"
        className="mt-4 min-h-11"
        disabled={state === 'sending'}
        onClick={() => void publish()}
      >
        {state === 'sending' ? <Loader2 className="animate-spin" /> : <Send />}
        批准并发布
      </Button>
      {state === 'error' ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {message}
        </p>
      ) : null}
    </section>
  );
}
