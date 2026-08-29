'use client';

import { Check, Copy, Share2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

type ShareState = 'idle' | 'sharing' | 'copied' | 'cancelled' | 'error';

export function ShareAnswerButton({
  slug,
  title,
  revisionId,
  queryEventId,
}: {
  slug: string;
  title: string;
  revisionId: string;
  queryEventId?: string;
}) {
  const [state, setState] = useState<ShareState>('idle');
  const [canonicalUrl, setCanonicalUrl] = useState('');

  async function share() {
    const url = new URL(
      `/answers/${encodeURIComponent(slug)}`,
      window.location.origin,
    ).toString();
    setCanonicalUrl(url);
    setState('sharing');

    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text: '查看这张有来源的答案卡', url });
        recordShare();
        setState('idle');
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          setState('cancelled');
          return;
        }
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      recordShare();
      setState('copied');
    } catch {
      setState('error');
    }
  }

  function recordShare() {
    if (!queryEventId) return;
    void fetch('/v1/answer-shares', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ queryEventId, cardRevisionId: revisionId }),
      cache: 'no-store',
      keepalive: true,
    });
  }

  const label =
    state === 'copied'
      ? '链接已复制'
      : state === 'sharing'
        ? '正在分享'
        : '分享答案';

  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1">
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="min-h-11 rounded-full bg-card"
        onClick={share}
        disabled={state === 'sharing'}
      >
        {state === 'copied' ? (
          <Check aria-hidden="true" />
        ) : state === 'error' ? (
          <Copy aria-hidden="true" />
        ) : (
          <Share2 aria-hidden="true" />
        )}
        {label}
      </Button>
      <p aria-live="polite" className="text-xs text-muted-foreground">
        {state === 'cancelled' ? '已取消分享' : null}
        {state === 'error' ? (
          <span>
            无法自动复制。请复制这个干净链接：{' '}
            <span className="break-all font-mono select-all">
              {canonicalUrl}
            </span>
          </span>
        ) : null}
      </p>
    </div>
  );
}
