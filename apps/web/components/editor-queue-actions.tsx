'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export function ReportActions({
  code,
  status,
  lockVersion,
}: {
  code: string;
  status: string;
  lockVersion: number;
}) {
  const [publicResponse, setPublicResponse] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const keys = useRef(new Map<string, string>());
  const router = useRouter();

  async function update(nextStatus: 'reviewing' | 'resolved') {
    const payload = {
      status: nextStatus,
      publicResponse: nextStatus === 'resolved' ? publicResponse : null,
    };
    const fingerprint = JSON.stringify(payload);
    const key = keys.current.get(fingerprint) ?? crypto.randomUUID();
    keys.current.set(fingerprint, key);
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/v1/editor/reports/${code}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': key,
          'if-match': `"${lockVersion}"`,
        },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(result.error?.message ?? '处理失败，请稍后重试。');
      }
      setBusy(false);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : '处理失败，请刷新后重试。',
      );
      setBusy(false);
    }
  }

  if (status === 'received') {
    return (
      <ActionError error={error}>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void update('reviewing')}
        >
          {busy ? '正在更新…' : '开始复核'}
        </Button>
      </ActionError>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void update('resolved');
      }}
      className="space-y-3"
    >
      <div>
        <label
          htmlFor={`report-response-${code}`}
          className="text-xs font-semibold text-foreground"
        >
          给报告人的公开处理说明
        </label>
        <Textarea
          id={`report-response-${code}`}
          value={publicResponse}
          onChange={(event) => setPublicResponse(event.target.value)}
          minLength={10}
          maxLength={500}
          rows={3}
          required
          placeholder="说明核查结论，以及内容是否已更正或无需变更。"
          className="mt-2"
        />
      </div>
      <Button
        type="submit"
        size="sm"
        disabled={busy || publicResponse.trim().length < 10}
      >
        {busy ? '正在发布…' : '发布处理结果'}
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function IntakeActions({
  id,
  status,
  lockVersion,
}: {
  id: string;
  status: string;
  lockVersion: number;
}) {
  return (
    <QueueActions
      endpoint={`/v1/editor/research-intakes/${id}`}
      lockVersion={lockVersion}
      actions={
        status === 'submitted'
          ? [
              ['screening', '进入筛查'],
              ['rejected', '拒绝'],
            ]
          : [
              ['actioned', '已转为选题'],
              ['rejected', '拒绝'],
            ]
      }
    />
  );
}

function QueueActions({
  endpoint,
  actions,
  lockVersion,
}: {
  endpoint: string;
  actions: Array<[string, string]>;
  lockVersion: number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const keys = useRef(new Map<string, string>());
  async function update(status: string) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'idempotency-key':
            keys.current.get(status) ??
            (() => {
              const key = crypto.randomUUID();
              keys.current.set(status, key);
              return key;
            })(),
          'if-match': `"${lockVersion}"`,
        },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error('处理失败');
      window.location.reload();
    } catch {
      setError('处理失败，请刷新后重试。');
      setBusy(false);
    }
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {actions.map(([value, label]) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={value === 'rejected' ? 'destructive' : 'outline'}
            disabled={busy}
            onClick={() => void update(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ActionError({
  error,
  children,
}: {
  error: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      {children}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
