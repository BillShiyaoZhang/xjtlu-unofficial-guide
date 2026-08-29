'use client';

import { Loader2, MessageSquarePlus } from 'lucide-react';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export function ReportCaseActions({
  id,
  code,
  status,
  lockVersion,
}: {
  id: string;
  code: string;
  status: string;
  lockVersion: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const key = useRef(crypto.randomUUID());

  async function startReview() {
    await update({ status: 'reviewing', publicResponse: null });
  }

  async function resolve(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await update({
      status: form.get('status'),
      publicResponse: form.get('publicResponse'),
      decisionCode: form.get('decisionCode'),
      resolutionCardId: form.get('resolutionCardId'),
      resolutionRevisionId: form.get('resolutionRevisionId'),
    });
  }

  async function update(payload: Record<string, unknown>) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/v1/editor/reports/${code}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'if-match': `"${lockVersion}"`,
          'idempotency-key': key.current,
        },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(result.error?.message ?? '处理失败。');
      router.refresh();
    } catch (error) {
      key.current = crypto.randomUUID();
      setMessage(error instanceof Error ? error.message : '处理失败。');
    } finally {
      setBusy(false);
    }
  }

  if (status === 'received') {
    return (
      <div>
        <Button type="button" onClick={startReview} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          认领并开始复核
        </Button>
        <Message text={message} />
        <CaseNoteForm targetType="report" targetId={id} />
      </div>
    );
  }
  if (status !== 'reviewing') {
    return <CaseNoteForm targetType="report" targetId={id} />;
  }
  return (
    <div className="space-y-6">
      <form
        onSubmit={resolve}
        className="space-y-4 rounded-xl border border-border bg-card p-5"
      >
        <h2 className="font-heading text-xl font-semibold">发布处理结论</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold">
            结论
            <select
              name="decisionCode"
              required
              className="mt-2 min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
            >
              <option value="">请选择</option>
              <option value="corrected">已更正</option>
              <option value="hidden">已隐藏</option>
              <option value="no_change">核查后无需变更</option>
              <option value="duplicate">重复报告</option>
              <option value="invalid">无法成立</option>
            </select>
          </label>
          <label className="text-sm font-semibold">
            最终状态
            <select
              name="status"
              defaultValue="resolved"
              className="mt-2 min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
            >
              <option value="resolved">已解决</option>
              <option value="closed">已关闭</option>
            </select>
          </label>
          <label className="text-sm font-semibold">
            关联答案卡 ID（隐藏时必填）
            <Input name="resolutionCardId" className="mt-2 min-h-11" />
          </label>
          <label className="text-sm font-semibold">
            关联修订 ID（更正时必填）
            <Input name="resolutionRevisionId" className="mt-2 min-h-11" />
          </label>
        </div>
        <label className="block text-sm font-semibold">
          给报告人的公开说明
          <Textarea
            name="publicResponse"
            required
            minLength={10}
            maxLength={500}
            rows={4}
            className="mt-2"
          />
        </label>
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          发布最终结果
        </Button>
        <Message text={message} />
      </form>
      <CaseNoteForm targetType="report" targetId={id} />
    </div>
  );
}

export function IntakeCaseActions({
  id,
  status,
  lockVersion,
}: {
  id: string;
  status: string;
  lockVersion: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const key = useRef(crypto.randomUUID());

  async function submit(payload: Record<string, unknown>) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/v1/editor/research-intakes/${id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'if-match': `"${lockVersion}"`,
          'idempotency-key': key.current,
        },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(result.error?.message ?? '处理失败。');
      router.refresh();
    } catch (error) {
      key.current = crypto.randomUUID();
      setMessage(error instanceof Error ? error.message : '处理失败。');
    } finally {
      setBusy(false);
    }
  }

  if (status === 'submitted') {
    return (
      <div>
        <Button
          type="button"
          onClick={() => submit({ status: 'screening' })}
          disabled={busy}
        >
          {busy ? <Loader2 className="animate-spin" /> : null}
          认领并进入筛查
        </Button>
        <Message text={message} />
        <CaseNoteForm targetType="research_intake" targetId={id} />
      </div>
    );
  }
  if (status !== 'screening') {
    return <CaseNoteForm targetType="research_intake" targetId={id} />;
  }
  return (
    <div className="space-y-6">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void submit({
            status: form.get('status'),
            decisionCode: form.get('decisionCode'),
            outcomeReason: form.get('outcomeReason'),
            linkedCardId: form.get('linkedCardId'),
            linkedRevisionId: form.get('linkedRevisionId'),
          });
        }}
        className="space-y-4 rounded-xl border border-border bg-card p-5"
      >
        <h2 className="font-heading text-xl font-semibold">完成线索筛查</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold">
            结果
            <select
              name="status"
              required
              className="mt-2 min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
            >
              <option value="actioned">已转化为内容</option>
              <option value="rejected">不采用</option>
            </select>
          </label>
          <label className="text-sm font-semibold">
            结论代码
            <select
              name="decisionCode"
              required
              className="mt-2 min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
            >
              <option value="draft_created">已创建草稿</option>
              <option value="linked_existing">已关联既有内容</option>
              <option value="rejected_out_of_scope">超出范围</option>
              <option value="rejected_insufficient">材料不足</option>
              <option value="duplicate">重复线索</option>
            </select>
          </label>
          <label className="text-sm font-semibold">
            关联答案卡 ID
            <Input name="linkedCardId" className="mt-2 min-h-11" />
          </label>
          <label className="text-sm font-semibold">
            关联修订 ID
            <Input name="linkedRevisionId" className="mt-2 min-h-11" />
          </label>
        </div>
        <label className="block text-sm font-semibold">
          内部结论说明
          <Textarea
            name="outcomeReason"
            required
            minLength={8}
            maxLength={500}
            rows={4}
            className="mt-2"
          />
        </label>
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          保存筛查结果
        </Button>
        <Message text={message} />
      </form>
      <CaseNoteForm targetType="research_intake" targetId={id} />
    </div>
  );
}

function CaseNoteForm({
  targetType,
  targetId,
}: {
  targetType: 'report' | 'research_intake';
  targetId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage('');
        const form = new FormData(event.currentTarget);
        try {
          const response = await fetch('/v1/editor/case-notes', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              targetType,
              targetId,
              body: form.get('body'),
            }),
          });
          const payload = (await response.json()) as {
            error?: { message?: string };
          };
          if (!response.ok)
            throw new Error(payload.error?.message ?? '记录失败。');
          event.currentTarget.reset();
          router.refresh();
        } catch (error) {
          setMessage(error instanceof Error ? error.message : '记录失败。');
        } finally {
          setBusy(false);
        }
      }}
      className="mt-6 rounded-xl border border-border bg-muted/30 p-4"
    >
      <label className="text-sm font-semibold">
        内部处置记录
        <Textarea
          name="body"
          required
          minLength={4}
          maxLength={1000}
          rows={3}
          className="mt-2 bg-background"
        />
      </label>
      <Button
        type="submit"
        size="sm"
        variant="outline"
        className="mt-3"
        disabled={busy}
      >
        {busy ? <Loader2 className="animate-spin" /> : <MessageSquarePlus />}
        添加记录
      </Button>
      <Message text={message} />
    </form>
  );
}

function Message({ text }: { text: string }) {
  return text ? (
    <p role="status" className="mt-3 text-xs text-muted-foreground">
      {text}
    </p>
  ) : null;
}
