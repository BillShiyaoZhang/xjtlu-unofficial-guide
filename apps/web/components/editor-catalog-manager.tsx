'use client';

import { AlertTriangle, FolderTree, Loader2, Plus } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type {
  CatalogArtifact,
  CatalogPublisher,
  CatalogScope,
  CatalogTopic,
} from '@/lib/editor-catalog';

type Catalog = {
  topics: CatalogTopic[];
  scopes: CatalogScope[];
  publishers: CatalogPublisher[];
  artifacts: CatalogArtifact[];
};

export function EditorCatalogManager({ initial }: { initial: Catalog }) {
  const [catalog, setCatalog] = useState(initial);
  const [tab, setTab] = useState<
    'topics' | 'scopes' | 'publishers' | 'sources'
  >('topics');

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted/55 p-1 sm:grid-cols-4">
        {(
          [
            ['topics', '话题', catalog.topics.length],
            ['scopes', '适用范围', catalog.scopes.length],
            ['publishers', '发布主体', catalog.publishers.length],
            ['sources', '来源处置', catalog.artifacts.length],
          ] as const
        ).map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`min-h-11 rounded-lg px-3 text-sm font-semibold transition ${
              tab === value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground'
            }`}
          >
            {label} <span className="ml-1 text-xs">{count}</span>
          </button>
        ))}
      </div>

      {tab === 'topics' ? (
        <CatalogSection
          title="话题与检索别名"
          create={
            <TopicForm
              onSaved={(item) =>
                setCatalog((current) => ({
                  ...current,
                  topics: [item, ...current.topics],
                }))
              }
            />
          }
        >
          {catalog.topics.map((topic) => (
            <TopicForm
              key={topic.id}
              initial={topic}
              onSaved={(item) =>
                setCatalog((current) => ({
                  ...current,
                  topics: current.topics.map((value) =>
                    value.id === item.id ? item : value,
                  ),
                }))
              }
            />
          ))}
        </CatalogSection>
      ) : null}

      {tab === 'scopes' ? (
        <CatalogSection
          title="适用范围"
          create={
            <ScopeForm
              onSaved={(item) =>
                setCatalog((current) => ({
                  ...current,
                  scopes: [item, ...current.scopes],
                }))
              }
            />
          }
        >
          {catalog.scopes.map((scope) => (
            <ScopeForm
              key={scope.id}
              initial={scope}
              onSaved={(item) =>
                setCatalog((current) => ({
                  ...current,
                  scopes: current.scopes.map((value) =>
                    value.id === item.id ? item : value,
                  ),
                }))
              }
            />
          ))}
        </CatalogSection>
      ) : null}

      {tab === 'publishers' ? (
        <CatalogSection
          title="发布主体"
          create={
            <PublisherForm
              onSaved={(item) =>
                setCatalog((current) => ({
                  ...current,
                  publishers: [item, ...current.publishers],
                }))
              }
            />
          }
        >
          {catalog.publishers.map((publisher) => (
            <PublisherForm
              key={publisher.id}
              initial={publisher}
              onSaved={(item) =>
                setCatalog((current) => ({
                  ...current,
                  publishers: current.publishers.map((value) =>
                    value.id === item.id ? item : value,
                  ),
                }))
              }
            />
          ))}
        </CatalogSection>
      ) : null}

      {tab === 'sources' ? (
        <CatalogSection title="来源处置">
          {catalog.artifacts.length ? (
            catalog.artifacts.map((artifact) => (
              <ArtifactForm
                key={artifact.id}
                artifact={artifact}
                onSaved={(item) =>
                  setCatalog((current) => ({
                    ...current,
                    artifacts: current.artifacts.map((value) =>
                      value.id === item.id ? item : value,
                    ),
                  }))
                }
              />
            ))
          ) : (
            <Empty text="创建答案卡修订并引用来源后，来源会自动进入这里。" />
          )}
        </CatalogSection>
      ) : null}
    </div>
  );
}

function CatalogSection({
  title,
  create,
  children,
}: {
  title: string;
  create?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <FolderTree className="size-5 text-primary" />
        <h2 className="font-heading text-2xl font-semibold">{title}</h2>
      </div>
      {create ? <div className="mt-5">{create}</div> : null}
      <div className="mt-5 grid gap-4 lg:grid-cols-2">{children}</div>
    </section>
  );
}

function TopicForm({
  initial,
  onSaved,
}: {
  initial?: CatalogTopic;
  onSaved: (item: CatalogTopic) => void;
}) {
  return (
    <EntityForm<CatalogTopic>
      title={initial ? initial.titleZh : '新建话题'}
      endpoint={
        initial
          ? `/v1/editor/catalog/topics/${initial.id}`
          : '/v1/editor/catalog/topics'
      }
      method={initial ? 'PATCH' : 'POST'}
      initial={initial}
      build={(form) => ({
        slug: form.get('slug'),
        titleZh: form.get('titleZh'),
        titleEn: form.get('titleEn'),
        description: form.get('description'),
        status: form.get('status'),
        aliases: String(form.get('aliases') ?? '').split(/[，,\n]/u),
      })}
      map={(id, form) => ({
        id,
        slug: String(form.get('slug')),
        titleZh: String(form.get('titleZh')),
        titleEn: String(form.get('titleEn') || '') || null,
        description: String(form.get('description')),
        status: form.get('status') === 'hidden' ? 'hidden' : 'active',
        aliases: String(form.get('aliases') || '')
          .split(/[，,\n]/u)
          .map((value) => value.trim())
          .filter(Boolean),
        cardCount: initial?.cardCount ?? 0,
      })}
      onSaved={onSaved}
    >
      <InputField
        name="slug"
        label="链接标识"
        defaultValue={initial?.slug}
        required
      />
      <InputField
        name="titleZh"
        label="中文名称"
        defaultValue={initial?.titleZh}
        required
      />
      <InputField
        name="titleEn"
        label="英文名称"
        defaultValue={initial?.titleEn ?? ''}
      />
      <InputField
        name="aliases"
        label="检索别名（逗号分隔）"
        defaultValue={initial?.aliases.join(', ')}
      />
      <label className="sm:col-span-2 text-sm font-semibold">
        简介
        <Textarea
          name="description"
          required
          defaultValue={initial?.description}
          className="mt-2"
        />
      </label>
      <StatusSelect defaultValue={initial?.status} />
    </EntityForm>
  );
}

function ScopeForm({
  initial,
  onSaved,
}: {
  initial?: CatalogScope;
  onSaved: (item: CatalogScope) => void;
}) {
  return (
    <EntityForm<CatalogScope>
      title={
        initial ? `${initial.dimension} · ${initial.labelZh}` : '新建适用范围'
      }
      endpoint={
        initial
          ? `/v1/editor/catalog/scopes/${initial.id}`
          : '/v1/editor/catalog/scopes'
      }
      method={initial ? 'PATCH' : 'POST'}
      initial={initial}
      build={(form) => ({
        dimension: form.get('dimension'),
        code: form.get('code'),
        labelZh: form.get('labelZh'),
        labelEn: form.get('labelEn'),
        sortOrder: Number(form.get('sortOrder')),
        status: form.get('status'),
      })}
      map={(id, form) => ({
        id,
        dimension: String(form.get('dimension')),
        code: String(form.get('code')),
        labelZh: String(form.get('labelZh')),
        labelEn: String(form.get('labelEn') || '') || null,
        sortOrder: Number(form.get('sortOrder')),
        status: form.get('status') === 'hidden' ? 'hidden' : 'active',
        revisionCount: initial?.revisionCount ?? 0,
      })}
      onSaved={onSaved}
    >
      <InputField
        name="dimension"
        label="维度代码"
        defaultValue={initial?.dimension}
        required
      />
      <InputField
        name="code"
        label="选项代码"
        defaultValue={initial?.code}
        required
      />
      <InputField
        name="labelZh"
        label="中文名称"
        defaultValue={initial?.labelZh}
        required
      />
      <InputField
        name="labelEn"
        label="英文名称"
        defaultValue={initial?.labelEn ?? ''}
      />
      <InputField
        name="sortOrder"
        label="排序"
        type="number"
        defaultValue={String(initial?.sortOrder ?? 0)}
        required
      />
      <StatusSelect defaultValue={initial?.status} />
    </EntityForm>
  );
}

function PublisherForm({
  initial,
  onSaved,
}: {
  initial?: CatalogPublisher;
  onSaved: (item: CatalogPublisher) => void;
}) {
  return (
    <EntityForm<CatalogPublisher>
      title={initial ? initial.nameZh : '新建发布主体'}
      endpoint={
        initial
          ? `/v1/editor/catalog/publishers/${initial.id}`
          : '/v1/editor/catalog/publishers'
      }
      method={initial ? 'PATCH' : 'POST'}
      initial={initial}
      build={(form) => ({
        type: form.get('type'),
        nameZh: form.get('nameZh'),
        nameEn: form.get('nameEn'),
        canonicalUrl: form.get('canonicalUrl'),
        verificationStatus: form.get('verificationStatus'),
      })}
      map={(id, form) => ({
        id,
        type: String(form.get('type')),
        nameZh: String(form.get('nameZh')),
        nameEn: String(form.get('nameEn') || '') || null,
        canonicalUrl: String(form.get('canonicalUrl') || '') || null,
        verificationStatus: String(
          form.get('verificationStatus'),
        ) as CatalogPublisher['verificationStatus'],
        artifactCount: initial?.artifactCount ?? 0,
      })}
      onSaved={onSaved}
    >
      <InputField
        name="type"
        label="主体类型"
        defaultValue={initial?.type ?? 'official'}
        required
      />
      <InputField
        name="nameZh"
        label="中文名称"
        defaultValue={initial?.nameZh}
        required
      />
      <InputField
        name="nameEn"
        label="英文名称"
        defaultValue={initial?.nameEn ?? ''}
      />
      <InputField
        name="canonicalUrl"
        label="官方网站"
        type="url"
        defaultValue={initial?.canonicalUrl ?? ''}
      />
      <label className="text-sm font-semibold">
        验证状态
        <select
          name="verificationStatus"
          defaultValue={initial?.verificationStatus ?? 'unverified'}
          className="mt-2 min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
        >
          <option value="unverified">未验证</option>
          <option value="source_verified">来源已验证</option>
          <option value="platform_owned">平台自有</option>
        </select>
      </label>
    </EntityForm>
  );
}

function EntityForm<T>({
  title,
  endpoint,
  method,
  initial,
  build,
  map,
  onSaved,
  children,
}: {
  title: string;
  endpoint: string;
  method: 'POST' | 'PATCH';
  initial?: unknown;
  build: (form: FormData) => unknown;
  map: (id: string, form: FormData) => T;
  onSaved: (item: T) => void;
  children: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(endpoint, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(build(form)),
      });
      const payload = (await response.json()) as {
        data?: { id?: string };
        error?: { message?: string };
      };
      if (!response.ok || !payload.data?.id)
        throw new Error(payload.error?.message ?? '保存失败。');
      onSaved(map(payload.data.id, form));
      setMessage('已保存');
      if (!initial) event.currentTarget.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      open={!initial}
      className="rounded-xl border border-border bg-card p-4"
    >
      <summary className="cursor-pointer font-semibold">{title}</summary>
      <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-2">
        {children}
        <div className="sm:col-span-2 flex items-center gap-3">
          <Button
            type="submit"
            variant={initial ? 'outline' : 'default'}
            disabled={busy}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Plus />}
            {initial ? '保存修改' : '创建'}
          </Button>
          {message ? (
            <span role="status" className="text-xs text-muted-foreground">
              {message}
            </span>
          ) : null}
        </div>
      </form>
    </details>
  );
}

function ArtifactForm({
  artifact,
  onSaved,
}: {
  artifact: CatalogArtifact;
  onSaved: (item: CatalogArtifact) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const form = new FormData(event.currentTarget);
    const status = String(form.get('status')) as CatalogArtifact['status'];
    try {
      const response = await fetch(
        `/v1/editor/artifacts/${artifact.id}/disposition`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status, reason: form.get('reason') }),
        },
      );
      const payload = (await response.json()) as {
        data?: { hiddenCards: number };
        error?: { message?: string };
      };
      if (!response.ok || !payload.data)
        throw new Error(payload.error?.message ?? '处置失败。');
      onSaved({
        ...artifact,
        status,
        affectedPublishedCards:
          status === 'approved' ? artifact.affectedPublishedCards : 0,
      });
      setMessage(
        `已保存；自动隐藏 ${payload.data.hiddenCards} 张受影响答案卡。`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '处置失败。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={submit}
      className="rounded-xl border border-border bg-card p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">{artifact.publisherName}</h3>
          <a
            href={artifact.canonicalUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 block truncate text-xs text-primary underline"
          >
            {artifact.canonicalUrl}
          </a>
        </div>
        <Badge
          variant={artifact.status === 'approved' ? 'secondary' : 'destructive'}
        >
          {artifact.status}
        </Badge>
      </div>
      {artifact.affectedPublishedCards ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-amber-800">
          <AlertTriangle className="size-4" />
          当前影响 {artifact.affectedPublishedCards} 张公开答案卡
        </p>
      ) : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-[10rem_1fr]">
        <select
          name="status"
          defaultValue={artifact.status}
          className="min-h-11 rounded-lg border border-input bg-background px-3 text-sm"
        >
          <option value="approved">批准使用</option>
          <option value="under_review">复核中</option>
          <option value="withdrawn">已撤回</option>
          <option value="unavailable">不可访问</option>
        </select>
        <Input
          name="reason"
          required
          minLength={8}
          maxLength={400}
          placeholder="处置理由（至少 8 个字符）"
          className="min-h-11"
        />
      </div>
      <Button type="submit" variant="outline" className="mt-4" disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : null}
        保存来源状态
      </Button>
      {message ? (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          {message}
        </p>
      ) : null}
    </form>
  );
}

function InputField({
  label,
  ...props
}: React.ComponentProps<typeof Input> & { label: string }) {
  return (
    <label className="text-sm font-semibold">
      {label}
      <Input {...props} className="mt-2 min-h-11" />
    </label>
  );
}

function StatusSelect({
  defaultValue = 'active',
}: {
  defaultValue?: 'active' | 'hidden';
}) {
  return (
    <label className="text-sm font-semibold">
      状态
      <select
        name="status"
        defaultValue={defaultValue}
        className="mt-2 min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
      >
        <option value="active">启用</option>
        <option value="hidden">隐藏</option>
      </select>
    </label>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground lg:col-span-2">
      {text}
    </p>
  );
}
