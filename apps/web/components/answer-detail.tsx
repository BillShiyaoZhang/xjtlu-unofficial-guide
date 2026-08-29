import {
  ArrowLeft,
  ArrowUpRight,
  CalendarCheck,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FileWarning,
  History,
  Library,
  MapPin,
  Quote,
  UserRoundCheck,
} from 'lucide-react';
import Link from 'next/link';

import { MeasuredFeedback } from '@/components/measured-feedback';
import { ShareAnswerButton } from '@/components/share-answer-button';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
  evidenceCoverageLabel,
  formatDate,
  formatDateTime,
  scopeLabel,
} from '@/lib/presentation';
import type { MobileTabContext } from '@/lib/mobile-navigation';
import type { AnswerCardDetail, CitationDetail } from '@/lib/types';
import { cn } from '@/lib/utils';

export function AnswerDetail({
  card,
  historical = false,
  sourceTab,
  returnTo,
  queryEventId,
}: {
  card: AnswerCardDetail;
  historical?: boolean;
  sourceTab?: MobileTabContext;
  returnTo?: string;
  queryEventId?: string;
}) {
  const sources = uniqueSources(card);
  const sourceNumbers = new Map(
    sources.map((source, index) => [source.id, index + 1]),
  );
  const currentVersion = card.history.find(
    (item) => item.isCurrent,
  )?.versionNumber;
  const canCollectFeedback =
    !historical && currentVersion === card.versionNumber;
  const factualSentences = card.sentences.filter(
    (sentence) => sentence.isFactual,
  );
  const linkedSentenceCount = factualSentences.filter(
    (sentence) => sentence.citations.length > 0,
  ).length;
  const evidenceSentenceCount = factualSentences.filter((sentence) =>
    sentence.citations.some((citation) => citation.kind === 'evidence'),
  ).length;
  const context = new URLSearchParams();
  if (sourceTab) context.set('tab', sourceTab);
  if (returnTo) context.set('from', returnTo);
  const contextQuery = context.toString();
  const contextSuffix = contextQuery ? `?${contextQuery}` : '';
  const backLink =
    sourceTab === 'home'
      ? { href: '/', label: '首页' }
      : sourceTab === 'topics'
        ? { href: `/topics/${card.topicSlug}`, label: card.topicTitle }
        : { href: '/search', label: '查找' };
  if (returnTo) backLink.href = returnTo;

  return (
    <main
      id="main-content"
      className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-14 lg:px-8"
    >
      <div className="mx-auto max-w-5xl">
        <Link
          href={backLink.href}
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'sm' }),
            '-ml-2 min-h-10',
          )}
        >
          <ArrowLeft aria-hidden="true" />
          {backLink.label}
        </Link>

        {historical ? (
          <div className="mt-5 flex gap-3 rounded-xl border border-amber-700/20 bg-amber-500/10 p-4 text-sm leading-6 text-amber-950">
            <History aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="font-semibold">
                你正在查看历史版本 v{card.versionNumber}
              </p>
              <p className="mt-1">历史内容仅用于追溯，不代表当前建议。</p>
              <Link
                className="mt-2 inline-block font-semibold underline underline-offset-4"
                href={`/answers/${card.slug}${contextSuffix}`}
              >
                返回当前版本
              </Link>
            </div>
          </div>
        ) : null}

        <header className="mt-4 border-b border-border pb-6 sm:mt-6 sm:pb-8">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{card.topicTitle}</Badge>
            <Badge variant="outline">版本 {card.versionNumber}</Badge>
            <StatusBadge status={card.status} />
          </div>
          <h1 className="mt-4 max-w-4xl text-balance font-heading text-[2rem] font-semibold leading-[1.18] tracking-tight sm:mt-5 sm:text-5xl">
            {card.title}
          </h1>
          {!historical ? (
            <div className="mt-5">
              <ShareAnswerButton
                slug={card.slug}
                title={card.title}
                revisionId={card.revisionId}
                queryEventId={queryEventId}
              />
            </div>
          ) : null}
          <div className="mt-5 grid grid-cols-2 overflow-hidden rounded-2xl border border-border bg-card/80 lg:hidden">
            <div className="border-r border-border p-3.5">
              <p className="text-[11px] font-semibold text-muted-foreground">
                适用于
              </p>
              <p className="mt-1 text-sm font-semibold leading-5">
                {scopeLabel(card.scopeMode, card.scopes)}
              </p>
            </div>
            <div className="p-3.5">
              <p className="text-[11px] font-semibold text-muted-foreground">
                信息截至
              </p>
              <p className="mt-1 text-sm font-semibold leading-5">
                {formatDate(card.asOf)}
              </p>
            </div>
          </div>
        </header>

        <div className="grid gap-10 pt-6 sm:pt-8 lg:grid-cols-[minmax(0,1fr)_290px] lg:items-start">
          <article>
            <section aria-labelledby="answer-heading">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
                  <CheckCircle2 aria-hidden="true" className="size-5" />
                </span>
                <h2
                  id="answer-heading"
                  className="font-heading text-2xl font-semibold"
                >
                  核验结论
                </h2>
              </div>
              <div className="mt-4 space-y-5 rounded-2xl border border-primary/12 bg-card p-4 shadow-[0_8px_28px_rgb(40_47_43/6%)] sm:mt-6 sm:p-6">
                {card.sentences.map((sentence) => (
                  <p
                    key={sentence.key}
                    id={`sentence-${sentence.key}`}
                    className="text-[17px] leading-8 text-foreground/88"
                  >
                    {sentence.text}{' '}
                    {sentence.citations.map((citation) => {
                      const number = sourceNumbers.get(citation.id);
                      return (
                        <a
                          key={`${sentence.key}-${citation.id}-${citation.ordinal}`}
                          href={`#source-${citation.id}`}
                          className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-full bg-primary/10 align-middle text-xs font-bold text-primary outline-none hover:bg-primary/15 focus-visible:ring-3 focus-visible:ring-ring/40"
                          aria-label={`来源 ${number}：${citation.title}`}
                        >
                          {number}
                        </a>
                      );
                    })}
                  </p>
                ))}
              </div>
              {card.evidenceNote ? (
                <div className="mt-7 rounded-xl border border-border bg-muted/45 p-4 text-sm leading-6 text-muted-foreground">
                  <p className="font-semibold text-foreground">编辑说明</p>
                  <p className="mt-1">{card.evidenceNote}</p>
                </div>
              ) : null}
            </section>

            <section
              aria-labelledby="sources-heading"
              className="mt-11 sm:mt-14"
            >
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-2xl bg-[#dce8f2] text-[#376781]">
                  <Library aria-hidden="true" className="size-5" />
                </span>
                <h2
                  id="sources-heading"
                  className="font-heading text-2xl font-semibold"
                >
                  来源
                </h2>
                <Badge variant="secondary" className="ml-auto">
                  {sources.length} 个
                </Badge>
              </div>
              <ol className="mt-4 space-y-4 sm:mt-6">
                {sources.map((source, index) => (
                  <SourceItem
                    key={source.id}
                    source={source}
                    number={index + 1}
                  />
                ))}
              </ol>
            </section>

            <details className="group mt-8 rounded-2xl border border-border bg-card/75 lg:hidden">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 font-heading font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
                完整核验档案
                <ChevronDown
                  aria-hidden="true"
                  className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
                />
              </summary>
              <div className="border-t border-border p-4">
                <VerificationRecord
                  card={card}
                  linkedSentenceCount={linkedSentenceCount}
                  evidenceSentenceCount={evidenceSentenceCount}
                  factualSentenceCount={factualSentences.length}
                />
              </div>
            </details>

            {canCollectFeedback ? (
              <section className="mt-8 rounded-2xl border border-primary/15 bg-card p-4 sm:mt-12 sm:rounded-xl sm:p-6">
                <MeasuredFeedback
                  revisionId={card.revisionId}
                  queryEventId={queryEventId}
                />
                <div className="mt-5 border-t border-border pt-4 text-sm text-muted-foreground">
                  <Link
                    className="inline-flex min-h-11 items-center font-semibold text-primary underline-offset-4 hover:underline"
                    href={`/report?card=${card.id}`}
                  >
                    报告问题
                  </Link>
                </div>
              </section>
            ) : null}

            <section className="mt-8 border-t border-border pt-6 sm:mt-14 sm:pt-8">
              <details className="group lg:hidden">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 font-heading text-xl font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
                  修改历史
                  <ChevronDown
                    aria-hidden="true"
                    className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
                  />
                </summary>
                <HistoryList
                  card={card}
                  sourceTab={sourceTab}
                  returnTo={returnTo}
                  className="mt-4"
                />
              </details>
              <div className="hidden lg:block">
                <h2 className="font-heading text-2xl font-semibold">
                  修改历史
                </h2>
                <HistoryList
                  card={card}
                  sourceTab={sourceTab}
                  returnTo={returnTo}
                  className="mt-5"
                />
              </div>
            </section>
          </article>

          <aside
            aria-label="答案卡元数据"
            className="hidden rounded-xl border border-border bg-card/85 p-5 shadow-sm lg:sticky lg:top-28 lg:block"
          >
            <h2 className="font-heading text-lg font-semibold">核验档案</h2>
            <VerificationRecord
              card={card}
              linkedSentenceCount={linkedSentenceCount}
              evidenceSentenceCount={evidenceSentenceCount}
              factualSentenceCount={factualSentences.length}
            />
          </aside>
        </div>
      </div>
    </main>
  );
}

function uniqueSources(card: AnswerCardDetail): CitationDetail[] {
  const seen = new Set<string>();
  const sources: CitationDetail[] = [];
  for (const sentence of card.sentences) {
    for (const citation of sentence.citations) {
      if (seen.has(citation.id)) continue;
      seen.add(citation.id);
      sources.push(citation);
    }
  }
  return sources;
}

function SourceItem({
  source,
  number,
}: {
  source: CitationDetail;
  number: number;
}) {
  const isExternal = /^https?:\/\//u.test(source.url);
  return (
    <li
      id={`source-${source.id}`}
      className="scroll-mt-24 rounded-2xl border border-border bg-card p-4 shadow-sm sm:scroll-mt-28 sm:rounded-xl sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          {number}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-heading font-semibold leading-6">
                {source.title}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {source.publisher}
              </p>
            </div>
            <Badge variant={source.kind === 'evidence' ? 'default' : 'outline'}>
              {source.kind === 'evidence' ? '可定位证据' : '外部链接'}
            </Badge>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 rounded-xl bg-muted/45 p-3 text-xs">
            <div>
              <dt className="text-muted-foreground">发布</dt>
              <dd className="mt-1 font-semibold leading-5">
                {source.publishedAt ? formatDate(source.publishedAt) : '未标注'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {source.kind === 'evidence' ? '收录' : '访问'}
              </dt>
              <dd className="mt-1 font-semibold leading-5">
                {formatDateTime(
                  source.kind === 'evidence'
                    ? source.capturedAt
                    : (source.accessedAt ?? source.capturedAt),
                )}
              </dd>
            </div>
          </dl>
          {source.kind === 'evidence' ? (
            <blockquote className="mt-4 border-l-2 border-primary/35 pl-4 text-sm leading-7 text-foreground/75">
              “{source.quote}”
              <footer className="mt-2 text-xs text-muted-foreground">
                定位：{source.locatorValue}
              </footer>
            </blockquote>
          ) : (
            <div className="mt-4 flex gap-2 rounded-lg border border-amber-700/15 bg-amber-500/9 p-3 text-xs leading-5 text-amber-950">
              <FileWarning
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0"
              />
              平台未保存原文，请在原站核对。
            </div>
          )}
          <a
            href={source.url}
            target={isExternal ? '_blank' : undefined}
            rel={isExternal ? 'noreferrer' : undefined}
            aria-label={
              isExternal
                ? `打开来源：${source.title}（新窗口）`
                : `打开来源：${source.title}`
            }
            className="mt-4 inline-flex min-h-11 max-w-full items-center gap-2 break-all rounded-lg px-2 text-sm font-semibold text-primary outline-none hover:bg-primary/8 focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            打开来源
            {isExternal ? (
              <ExternalLink aria-hidden="true" className="size-4 shrink-0" />
            ) : (
              <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" />
            )}
          </a>
        </div>
      </div>
    </li>
  );
}

function VerificationRecord({
  card,
  linkedSentenceCount,
  evidenceSentenceCount,
  factualSentenceCount,
}: {
  card: AnswerCardDetail;
  linkedSentenceCount: number;
  evidenceSentenceCount: number;
  factualSentenceCount: number;
}) {
  return (
    <>
      <dl className="mt-5 space-y-5 text-sm first:mt-0">
        <Meta
          icon={MapPin}
          label="适用于"
          value={scopeLabel(card.scopeMode, card.scopes)}
        />
        <Meta
          icon={CalendarRange}
          label="信息截至"
          value={formatDate(card.asOf)}
        />
        <Meta
          icon={CalendarCheck}
          label="人工核验"
          value={formatDate(card.verifiedAt)}
        />
        <Meta
          icon={CalendarRange}
          label="下次复核"
          value={formatDate(card.reviewDueAt)}
        />
        <Meta
          icon={UserRoundCheck}
          label="复核负责人"
          value={card.reviewOwnerLabel}
        />
        <Meta
          icon={Quote}
          label="证据覆盖"
          value={evidenceCoverageLabel(card.evidenceCoverage)}
        />
        <Meta
          icon={Quote}
          label="来源链接覆盖"
          value={`${linkedSentenceCount}/${factualSentenceCount} 个事实句`}
        />
        <Meta
          icon={Quote}
          label="可定位证据覆盖"
          value={`${evidenceSentenceCount}/${factualSentenceCount} 个事实句`}
        />
      </dl>
      <p className="mt-6 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">
        本指南不提供“可靠度分数”。请结合来源、范围、日期和警示自行判断。
      </p>
    </>
  );
}

function HistoryList({
  card,
  sourceTab,
  returnTo,
  className,
}: {
  card: AnswerCardDetail;
  sourceTab?: MobileTabContext;
  returnTo?: string;
  className?: string;
}) {
  const context = new URLSearchParams();
  if (sourceTab) context.set('tab', sourceTab);
  if (returnTo) context.set('from', returnTo);
  const contextQuery = context.toString();
  const contextSuffix = contextQuery ? `?${contextQuery}` : '';
  return (
    <ol className={cn('space-y-3', className)}>
      {card.history.map((item) => (
        <li
          key={item.id}
          className="flex flex-col justify-between gap-2 rounded-xl border border-border/80 bg-card/65 p-4 sm:flex-row sm:items-center"
        >
          <div>
            <p className="font-semibold">
              v{item.versionNumber} · {item.title}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              信息截至 {formatDate(item.asOf)} · 发布于{' '}
              {formatDateTime(item.publishedAt)}
            </p>
          </div>
          {item.isCurrent ? (
            <Badge variant="secondary">当前版本</Badge>
          ) : (
            <Link
              href={`/answers/${card.slug}/versions/${item.versionNumber}${contextSuffix}`}
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'sm' }),
                'min-h-11 justify-start sm:justify-center',
              )}
            >
              查看历史版本
            </Link>
          )}
        </li>
      ))}
    </ol>
  );
}

function Meta({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof MapPin;
  label: string;
  value: string;
}) {
  return (
    <div className="flex gap-3">
      <Icon
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-primary"
      />
      <div>
        <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
        <dd className="mt-1 leading-6 text-foreground">{value}</dd>
      </div>
    </div>
  );
}
