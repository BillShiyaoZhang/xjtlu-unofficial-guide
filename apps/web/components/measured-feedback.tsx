'use client';

import { useEffect, useState } from 'react';

import { FeedbackButtons } from '@/components/feedback-buttons';

export function MeasuredFeedback({
  revisionId,
  queryEventId,
}: {
  revisionId: string;
  queryEventId?: string;
}) {
  const [authorizedQueryId, setAuthorizedQueryId] = useState<
    string | null | false | undefined
  >(queryEventId ? undefined : null);

  useEffect(() => {
    if (!queryEventId) return;
    let active = true;
    void fetch('/v1/answer-opens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ queryEventId, cardRevisionId: revisionId }),
      cache: 'no-store',
      keepalive: true,
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          data?: { recorded?: boolean };
        };
        if (active) {
          setAuthorizedQueryId(
            response.ok && payload.data?.recorded ? queryEventId : false,
          );
        }
      })
      .catch(() => {
        if (active) setAuthorizedQueryId(false);
      });
    return () => {
      active = false;
    };
  }, [queryEventId, revisionId]);

  if (authorizedQueryId === undefined) {
    return (
      <p aria-live="polite" className="text-sm text-muted-foreground">
        正在准备本次查询的反馈…
      </p>
    );
  }
  if (authorizedQueryId === false) {
    return (
      <p role="status" className="text-sm leading-6 text-muted-foreground">
        无法关联这次查询，反馈尚未开放。请返回查找页后重新打开答案。
      </p>
    );
  }
  return (
    <FeedbackButtons
      revisionId={revisionId}
      queryEventId={authorizedQueryId ?? undefined}
    />
  );
}
