'use client';

import { FilePlus2, Link2, Loader2, Plus, Quote, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { DisputeStatus, ScopeMode } from '@/lib/domain';
import type {
  CitationDraftInput,
  Scope,
  SentenceDraftInput,
  TopicSummary,
} from '@/lib/types';

type EditorSentence = SentenceDraftInput & { clientId: string };

type InitialDraft = {
  title: string;
  summary: string;
  scopeMode: ScopeMode;
  scopeIds: string[];
  asOf: string;
  reviewDueOn: string;
  reviewOwnerLabel: string;
  disputeStatus: DisputeStatus;
  evidenceNote: string;
  sentences: SentenceDraftInput[];
};

type Props = {
  mode: 'new' | 'revision';
  topics: TopicSummary[];
  scopes: Scope[];
  defaultTopicId?: string;
  defaultSlug?: string;
  riskLevel?: 'low' | 'high';
  cardId?: string;
  lockVersion?: number;
  initial: InitialDraft;
};

const blankCitation: CitationDraftInput = {
  kind: 'link',
  sourceTitle: '',
  sourceUrl: '',
  publisherName: '',
  publishedAt: null,
  quote: null,
  locator: null,
  rightsConfirmed: false,
};

export function EditorCardForm(props: Props) {
  const [sentences, setSentences] = useState<EditorSentence[]>(() =>
    props.initial.sentences.length
      ? props.initial.sentences.map((sentence, index) => ({
          ...sentence,
          clientId: `initial-${index}`,
        }))
      : [{ text: '', citation: { ...blankCitation }, clientId: 'initial-0' }],
  );
  const [scopeMode, setScopeMode] = useState<ScopeMode>(
    props.initial.scopeMode,
  );
  const [selectedScopes, setSelectedScopes] = useState<string[]>(
    props.initial.scopeIds,
  );
  const riskLevel = props.riskLevel ?? 'low';
  const [state, setState] = useState<'idle' | 'sending' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const key = useRef(crypto.randomUUID());
  const nextId = useRef(sentences.length);

  function updateSentence(index: number, patch: Partial<EditorSentence>) {
    setSentences((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  }

  function updateCitation(index: number, patch: Partial<CitationDraftInput>) {
    setSentences((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? { ...item, citation: { ...item.citation, ...patch } }
          : item,
      ),
    );
  }

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setState('sending');
    setMessage('');
    const form = new FormData(event.currentTarget);
    const payload = {
      title: form.get('title'),
      summary: form.get('summary'),
      scopeMode,
      scopeIds: scopeMode === 'constrained' ? selectedScopes : [],
      asOf: form.get('asOf'),
      reviewDueOn: form.get('reviewDueOn'),
      reviewOwnerLabel: form.get('reviewOwnerLabel'),
      disputeStatus: form.get('disputeStatus'),
      evidenceNote: form.get('evidenceNote'),
      generationType: 'human',
      sentences: sentences.map(({ text, citation }) => ({ text, citation })),
      ...(props.mode === 'new'
        ? {
            slug: form.get('slug'),
            topicId: form.get('topicId'),
            riskLevel,
          }
        : {}),
    };
    const endpoint =
      props.mode === 'new'
        ? '/v1/editor/answer-cards'
        : `/v1/editor/answer-cards/${props.cardId}/revisions`;
    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'idempotency-key': key.current,
      };
      if (props.mode === 'revision')
        headers['if-match'] = `"${props.lockVersion ?? 0}"`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as {
        data?: { cardId: string };
        error?: { message: string };
      };
      if (!response.ok || !result.data)
        throw new Error(result.error?.message ?? '保存失败');
      window.location.href = `/editor/cards/${result.data.cardId}`;
    } catch (error) {
      key.current = crypto.randomUUID();
      setMessage(error instanceof Error ? error.message : '保存失败');
      setState('error');
      document.getElementById('editor-form-error')?.focus();
    }
  }

  return (
    <form onSubmit={submit} className="space-y-8">
      {state === 'error' ? (
        <div
          id="editor-form-error"
          role="alert"
          tabIndex={-1}
          className="rounded-lg border border-destructive/20 bg-destructive/8 p-4 text-sm text-destructive outline-none"
        >
          {message}
        </div>
      ) : null}

      {props.mode === 'new' ? (
        <Section
          number="01"
          title="答案卡身份"
          description="稳定身份与风险级别不放进可变正文。"
        >
          <div className="grid gap-5 md:grid-cols-2">
            <Field
              label="链接标识"
              htmlFor="card-slug"
              hint="小写字母、数字和连字符"
            >
              <Input
                id="card-slug"
                name="slug"
                defaultValue={props.defaultSlug}
                required
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                maxLength={100}
                className="min-h-11"
              />
            </Field>
            <Field label="所属话题" htmlFor="card-topic">
              <select
                id="card-topic"
                name="topicId"
                defaultValue={props.defaultTopicId}
                required
                className="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="">请选择</option>
                {props.topics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.titleZh}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <fieldset className="mt-5">
            <legend className="text-sm font-semibold">风险级别</legend>
            <p className="mt-2 rounded-lg border border-border bg-muted/45 p-3 text-sm leading-6 text-muted-foreground">
              当前阶段只允许一般信息。高影响内容会在领域审核角色与来源权威范围校验上线后再开放。
            </p>
          </fieldset>
        </Section>
      ) : null}

      <Section
        number={props.mode === 'new' ? '02' : '01'}
        title="结论与范围"
        description="正文将创建为一个新的不可变修订。"
      >
        <div className="grid gap-5">
          <Field label="问题标题" htmlFor="revision-title">
            <Input
              id="revision-title"
              name="title"
              defaultValue={props.initial.title}
              required
              minLength={6}
              maxLength={120}
              className="min-h-11"
            />
          </Field>
          <Field
            label="检索摘要（不单独作为公开结论）"
            htmlFor="revision-summary"
            hint="12–360 字；公开页面会以第一条带引用事实句作为摘要，避免无引用结论。"
          >
            <Textarea
              id="revision-summary"
              name="summary"
              defaultValue={props.initial.summary}
              required
              minLength={12}
              maxLength={360}
              rows={3}
            />
          </Field>
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="范围模式" htmlFor="scope-mode">
              <select
                id="scope-mode"
                value={scopeMode}
                onChange={(event) => {
                  const value = event.target.value as ScopeMode;
                  setScopeMode(value);
                  if (value !== 'constrained') setSelectedScopes([]);
                }}
                className="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="universal">通用</option>
                <option value="constrained">受限范围</option>
                <option value="unknown">范围待确认</option>
              </select>
            </Field>
            <Field label="争议状态" htmlFor="dispute-status">
              <select
                id="dispute-status"
                name="disputeStatus"
                defaultValue={props.initial.disputeStatus}
                className="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="none">无</option>
                <option value="reported">已报告</option>
                <option value="confirmed">已确认争议</option>
              </select>
            </Field>
          </div>
          {scopeMode === 'constrained' ? (
            <fieldset>
              <legend className="text-sm font-semibold">具体适用范围</legend>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {props.scopes.map((scope) => (
                  <label
                    key={scope.id}
                    className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3"
                  >
                    <input
                      type="checkbox"
                      checked={selectedScopes.includes(scope.id)}
                      onChange={(event) =>
                        setSelectedScopes((current) =>
                          event.target.checked
                            ? [...current, scope.id]
                            : current.filter((id) => id !== scope.id),
                        )
                      }
                      className="size-4 accent-primary"
                    />
                    {scope.labelZh}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
        </div>
      </Section>

      <Section
        number={props.mode === 'new' ? '03' : '02'}
        title="逐句证据"
        description="每个事实句都必须绑定且仅绑定一种来源；可添加多个事实句。"
      >
        <div className="space-y-5">
          {sentences.map((sentence, index) => (
            <div
              key={sentence.clientId}
              className="rounded-xl border border-border bg-muted/25 p-4 sm:p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-heading text-lg font-semibold">
                  事实句 {index + 1}
                </h3>
                {sentences.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setSentences((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                  >
                    <Trash2 />
                    移除
                  </Button>
                ) : null}
              </div>
              <Field label="事实句正文" htmlFor={`sentence-${index}`}>
                <Textarea
                  id={`sentence-${index}`}
                  value={sentence.text}
                  onChange={(event) =>
                    updateSentence(index, { text: event.target.value })
                  }
                  required
                  minLength={8}
                  maxLength={500}
                  rows={3}
                />
              </Field>
              <fieldset className="mt-5">
                <legend className="text-sm font-semibold">引用类型</legend>
                <div className="mt-2 flex flex-wrap gap-3">
                  <Radio
                    label="平台未归档外链"
                    name={`citation-kind-${index}`}
                    icon={Link2}
                    checked={sentence.citation.kind === 'link'}
                    onChange={() =>
                      updateCitation(index, {
                        kind: 'link',
                        quote: null,
                        locator: null,
                        rightsConfirmed: false,
                      })
                    }
                  />
                  <Radio
                    label="可定位证据片段"
                    name={`citation-kind-${index}`}
                    icon={Quote}
                    checked={sentence.citation.kind === 'evidence'}
                    onChange={() => updateCitation(index, { kind: 'evidence' })}
                  />
                </div>
              </fieldset>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <Field label="来源标题" htmlFor={`source-title-${index}`}>
                  <Input
                    id={`source-title-${index}`}
                    value={sentence.citation.sourceTitle}
                    onChange={(event) =>
                      updateCitation(index, { sourceTitle: event.target.value })
                    }
                    required
                    maxLength={200}
                    className="min-h-11"
                  />
                </Field>
                <Field label="发布主体" htmlFor={`publisher-${index}`}>
                  <Input
                    id={`publisher-${index}`}
                    value={sentence.citation.publisherName}
                    onChange={(event) =>
                      updateCitation(index, {
                        publisherName: event.target.value,
                      })
                    }
                    required
                    maxLength={160}
                    className="min-h-11"
                  />
                </Field>
                <Field label="公开来源 URL" htmlFor={`source-url-${index}`}>
                  <Input
                    id={`source-url-${index}`}
                    type="url"
                    value={sentence.citation.sourceUrl}
                    onChange={(event) =>
                      updateCitation(index, { sourceUrl: event.target.value })
                    }
                    required
                    className="min-h-11"
                  />
                </Field>
                <Field
                  label="来源发布日期（可选）"
                  htmlFor={`source-date-${index}`}
                >
                  <Input
                    id={`source-date-${index}`}
                    type="date"
                    value={sentence.citation.publishedAt ?? ''}
                    onChange={(event) =>
                      updateCitation(index, {
                        publishedAt: event.target.value || null,
                      })
                    }
                    className="min-h-11"
                  />
                </Field>
              </div>
              {sentence.citation.kind === 'evidence' ? (
                <div className="mt-5 space-y-4 rounded-lg border border-primary/15 bg-primary/5 p-4">
                  <Field label="精确摘录" htmlFor={`quote-${index}`}>
                    <Textarea
                      id={`quote-${index}`}
                      value={sentence.citation.quote ?? ''}
                      onChange={(event) =>
                        updateCitation(index, { quote: event.target.value })
                      }
                      required
                      minLength={8}
                      maxLength={1000}
                      rows={4}
                    />
                  </Field>
                  <Field
                    label="定位说明"
                    htmlFor={`locator-${index}`}
                    hint="例如：页面“Login”小节、PDF 第 3 页"
                  >
                    <Input
                      id={`locator-${index}`}
                      value={sentence.citation.locator ?? ''}
                      onChange={(event) =>
                        updateCitation(index, { locator: event.target.value })
                      }
                      required
                      maxLength={200}
                      className="min-h-11"
                    />
                  </Field>
                  <label className="flex items-start gap-3 text-sm leading-6">
                    <input
                      type="checkbox"
                      checked={Boolean(sentence.citation.rightsConfirmed)}
                      onChange={(event) =>
                        updateCitation(index, {
                          rightsConfirmed: event.target.checked,
                        })
                      }
                      required
                      className="mt-1 size-4 accent-primary"
                    />
                    我已确认平台有权保存并公开这段精确摘录；受限材料不能在此使用。
                  </label>
                </div>
              ) : (
                <p className="mt-4 rounded-lg bg-amber-500/9 p-3 text-xs leading-5 text-amber-950">
                  外链模式只保存
                  URL、标题和时间，不会保存正文、截图、哈希或向量。
                </p>
              )}
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={sentences.length >= 8}
            onClick={() => {
              nextId.current += 1;
              setSentences((current) => [
                ...current,
                {
                  clientId: `new-${nextId.current}`,
                  text: '',
                  citation: { ...blankCitation },
                },
              ]);
            }}
          >
            <Plus />
            添加事实句
          </Button>
        </div>
      </Section>

      <Section
        number={props.mode === 'new' ? '04' : '03'}
        title="核验与复核"
        description="每张当前答案都必须有负责人和未来的复核期限。"
      >
        <div className="grid gap-5 md:grid-cols-3">
          <Field label="信息截至" htmlFor="as-of">
            <Input
              id="as-of"
              name="asOf"
              type="date"
              defaultValue={props.initial.asOf}
              required
              className="min-h-11"
            />
          </Field>
          <Field label="下次复核" htmlFor="review-due">
            <Input
              id="review-due"
              name="reviewDueOn"
              type="date"
              defaultValue={props.initial.reviewDueOn}
              required
              className="min-h-11"
            />
          </Field>
          <Field label="公开负责人角色" htmlFor="review-owner">
            <Input
              id="review-owner"
              name="reviewOwnerLabel"
              defaultValue={props.initial.reviewOwnerLabel}
              required
              maxLength={80}
              className="min-h-11"
            />
          </Field>
        </div>
        <Field label="编辑说明（可选）" htmlFor="evidence-note">
          <Textarea
            id="evidence-note"
            name="evidenceNote"
            defaultValue={props.initial.evidenceNote}
            maxLength={500}
            rows={3}
          />
        </Field>
      </Section>

      <div className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/95 p-4 shadow-[0_12px_40px_rgb(30_38_34/16%)] backdrop-blur">
        <p className="text-xs leading-5 text-muted-foreground">
          保存只创建不可变草稿；仍需在审核区单独发布。
        </p>
        <Button
          type="submit"
          size="lg"
          className="min-h-12"
          disabled={state === 'sending'}
        >
          {state === 'sending' ? (
            <Loader2 className="animate-spin" />
          ) : (
            <FilePlus2 />
          )}
          {props.mode === 'new' ? '创建答案卡草稿' : '创建新修订草稿'}
        </Button>
      </div>
    </form>
  );
}

function Section({
  number,
  title,
  description,
  children,
}: {
  number: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-7">
      <div className="mb-6 flex gap-4 border-b border-border pb-5">
        <span className="font-mono text-xs font-semibold text-primary">
          {number}
        </span>
        <div>
          <h2 className="font-heading text-2xl font-semibold">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      {children}
    </section>
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
    <div className="mt-4 first:mt-0">
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

function Radio({
  label,
  checked,
  onChange,
  name,
  icon: Icon,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  name: string;
  icon?: typeof Link2;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 has-[:checked]:border-primary/40 has-[:checked]:bg-primary/6">
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="size-4 accent-primary"
      />
      {Icon ? <Icon className="size-4 text-primary" /> : null}
      {label}
    </label>
  );
}
