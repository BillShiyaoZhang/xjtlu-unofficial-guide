'use client';

import { Loader2, Send } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export function ResearchIntakeForm({
  defaultKind = '',
  defaultBody = '',
  defaultContextScope = '',
  originQueryEventId,
}: {
  defaultKind?: 'question' | 'material' | '';
  defaultBody?: string;
  defaultContextScope?: string;
  originQueryEventId?: string;
}) {
  const [state, setState] = useState<'idle' | 'sending' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [kind, setKind] = useState<'question' | 'material' | ''>(defaultKind);
  const [result, setResult] = useState<{
    reference: string;
    expiresAt: string;
  } | null>(null);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setState('sending');
    setMessage('');
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    const requestPayload = {
      originQueryEventId: originQueryEventId ?? null,
      kind: body.kind,
      contextScope: body.contextScope,
      body: body.body || null,
      sourceUrl: body.sourceUrl || null,
      provenanceRole: body.provenanceRole || null,
    };
    const fingerprint = JSON.stringify(requestPayload);
    if (!attempt.current || attempt.current.fingerprint !== fingerprint) {
      attempt.current = { fingerprint, key: crypto.randomUUID() };
    }
    try {
      const response = await fetch('/v1/research-intakes', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': attempt.current.key,
        },
        body: JSON.stringify(requestPayload),
      });
      const payload = (await response.json()) as {
        data?: { reference: string; expiresAt: string };
        error?: { message: string };
      };
      if (!response.ok || !payload.data)
        throw new Error(payload.error?.message ?? 'submit_failed');
      setResult(payload.data);
      setState('idle');
    } catch (error) {
      setMessage(
        error instanceof Error && error.message !== 'submit_failed'
          ? error.message
          : '暂时无法提交，请稍后重试。',
      );
      setState('error');
    }
  }

  if (result) {
    return (
      <output className="block rounded-xl border border-emerald-800/15 bg-emerald-900/7 p-6">
        <h2 className="font-heading text-2xl font-semibold">
          私有线索已进入编辑队列
        </h2>
        <p className="mt-3 leading-7 text-foreground/75">
          参考编号：<strong>{result.reference}</strong>。原始载荷保留至{' '}
          {new Date(result.expiresAt).toLocaleDateString('zh-CN')}{' '}
          ，到期后由清理任务去标识化，不会直接成为公开帖子。
        </p>
      </output>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-6 rounded-xl border border-border bg-card p-5 shadow-sm sm:p-7"
    >
      <div className="rounded-lg border border-emerald-800/15 bg-emerald-900/7 p-4 text-sm font-medium text-emerald-950">
        当前成年试点会话有效。研究编号与邀请代码不会进入这份线索。
      </div>
      <fieldset>
        <legend className="text-sm font-semibold">线索类型</legend>
        <div className="mt-3 flex flex-wrap gap-3">
          <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3">
            <input
              type="radio"
              name="kind"
              value="question"
              required
              checked={kind === 'question'}
              onChange={() => setKind('question')}
              className="size-4 accent-primary"
            />
            问题线索
          </label>
          <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3">
            <input
              type="radio"
              name="kind"
              value="material"
              required
              checked={kind === 'material'}
              onChange={() => setKind('material')}
              className="size-4 accent-primary"
            />
            材料线索
          </label>
        </div>
      </fieldset>
      <Field
        label="必要的适用背景"
        htmlFor="context-scope"
        hint="例如：苏州校区、2026 入学届、新生"
      >
        <Input
          id="context-scope"
          name="contextScope"
          required
          maxLength={160}
          className="min-h-11"
          defaultValue={defaultContextScope}
        />
      </Field>
      <Field
        label="问题或材料说明"
        htmlFor="intake-body"
        hint="请勿填写姓名、学号、电话、邮箱或其他可识别个人的信息。"
      >
        <Textarea
          id="intake-body"
          name="body"
          maxLength={1500}
          rows={6}
          defaultValue={defaultBody}
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="公开材料链接（可选）" htmlFor="source-url">
          <Input
            id="source-url"
            name="sourceUrl"
            type="url"
            placeholder="https://"
            className="min-h-11"
          />
        </Field>
        <Field
          label={
            kind === 'material' ? '你与材料的关系' : '你与材料的关系（可选）'
          }
          htmlFor="provenance-role"
        >
          <select
            id="provenance-role"
            name="provenanceRole"
            required={kind === 'material'}
            className="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
          >
            <option value="">请选择</option>
            <option value="original_author">原作者</option>
            <option value="reteller">转述者</option>
            <option value="lead_only">仅提供线索</option>
          </select>
        </Field>
      </div>
      <Button
        type="submit"
        size="lg"
        className="min-h-12"
        disabled={state === 'sending'}
      >
        {state === 'sending' ? <Loader2 className="animate-spin" /> : <Send />}
        提交私有线索
      </Button>
      {state === 'error' ? (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      ) : null}
    </form>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-sm font-semibold">
        {label}
      </label>
      {hint ? (
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{hint}</p>
      ) : null}
      <div className="mt-2">{children}</div>
    </div>
  );
}
