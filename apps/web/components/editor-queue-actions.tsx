'use client';

import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';

export function ReportActions({
  code,
  status,
  lockVersion,
}: {
  code: string;
  status: string;
  lockVersion: number;
}) {
  return (
    <QueueActions
      endpoint={`/v1/editor/reports/${code}`}
      lockVersion={lockVersion}
      actions={
        status === 'received'
          ? [
              ['reviewing', '开始复核'],
              ['resolved', '直接标为已处理'],
            ]
          : [['resolved', '标为已处理']]
      }
    />
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
