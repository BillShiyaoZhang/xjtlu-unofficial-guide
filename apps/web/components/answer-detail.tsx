import {
  ArrowLeft,
  ArrowUpRight,
  CalendarCheck,
  CalendarRange,
  ExternalLink,
  FileWarning,
  History,
  MapPin,
  Quote,
  UserRoundCheck,
} from 'lucide-react';
import Link from 'next/link';

import { FeedbackButtons } from '@/components/feedback-buttons';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
  evidenceCoverageLabel,
  formatDate,
  formatDateTime,
  scopeLabel,
} from '@/lib/presentation';
import type { AnswerCardDetail, CitationDetail } from '@/lib/types';
import { cn } from '@/lib/utils';

export function AnswerDetail({
  card,
  historical = false,
}: {
  card: AnswerCardDetail;
  historical?: boolean;
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

  return (
    <main
      id="main-content"
      className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8"
    >
      <div className="mx-auto max-w-5xl">
        <Link
          href={`/topics/${card.topicSlug}`}
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'sm' }),
            '-ml-2 min-h-10',
          )}
        >
          <ArrowLeft aria-hidden="true" />
          {card.topicTitle}
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
                href={`/answers/${card.slug}`}
              >
                返回当前版本
              </Link>
            </div>
          </div>
        ) : null}

        <header className="mt-6 border-b border-border pb-8">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{card.topicTitle}</Badge>
            <Badge variant="outline">版本 {card.versionNumber}</Badge>
            <StatusBadge status={card.status} />
          </div>
          <h1 className="mt-5 max-w-4xl text-balance font-heading text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
            {card.title}
          </h1>
          <p className="mt-5 max-w-3xl text-sm leading-7 text-muted-foreground">
            公开结论只在下方“核验后的简答”中逐句展示，并直接关联来源。
          </p>
        </header>

        <div className="grid gap-10 pt-8 lg:grid-cols-[minmax(0,1fr)_290px] lg:items-start">
          <article>
            <section aria-labelledby="answer-heading">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                Answer
              </p>
              <h2
                id="answer-heading"
                className="mt-2 font-heading text-2xl font-semibold"
              >
                核验后的简答
              </h2>
              <div className="mt-6 space-y-5">
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
                          className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-full bg-primary/10 align-middle text-xs font-bold text-primary outline-none hover:bg-primary/15 focus-visible:ring-3 focus-visible:ring-ring/40"
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

            <section aria-labelledby="sources-heading" className="mt-14">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                Sources
              </p>
              <h2
                id="sources-heading"
                className="mt-2 font-heading text-2xl font-semibold"
              >
                来源与证据
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                来源链接覆盖率与可定位证据覆盖率分开显示；外链不等于平台保存了原文。
              </p>
              <ol className="mt-6 space-y-4">
                {sources.map((source, index) => (
                  <SourceItem
                    key={source.id}
                    source={source}
                    number={index + 1}
                  />
                ))}
              </ol>
            </section>

            <section
              aria-labelledby="history-heading"
              className="mt-14 border-t border-border pt-8"
            >
              <h2
                id="history-heading"
                className="font-heading text-2xl font-semibold"
              >
                修改历史
              </h2>
              <ol className="mt-5 space-y-3">
                {card.history.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-col justify-between gap-2 rounded-lg border border-border/80 bg-card/65 p-4 sm:flex-row sm:items-center"
                  >
                    <div>
                      <p className="font-semibold">
                        v{item.versionNumber} · {item.title}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        信息截至 {formatDate(item.asOf)} · 发布于{' '}
                        {formatDateTime(item.publishedAt)}
                      </p>
                    </div>
                    {item.isCurrent ? (
                      <Badge variant="secondary">当前版本</Badge>
                    ) : (
                      <Link
                        href={`/answers/${card.slug}/versions/${item.versionNumber}`}
                        className={cn(
                          buttonVariants({ variant: 'ghost', size: 'sm' }),
                          'min-h-9',
                        )}
                      >
                        查看历史版本
                      </Link>
                    )}
                  </li>
                ))}
              </ol>
            </section>

            {canCollectFeedback ? (
              <section className="mt-12 rounded-xl border border-primary/15 bg-card p-5 sm:p-6">
                <FeedbackButtons revisionId={card.revisionId} />
                <div className="mt-5 border-t border-border pt-4 text-sm text-muted-foreground">
                  <Link
                    className="font-semibold text-primary underline-offset-4 hover:underline"
                    href={`/report?card=${card.id}`}
                  >
                    报告过期、范围、来源或隐私问题
                  </Link>
                </div>
              </section>
            ) : null}
          </article>

          <aside
            aria-label="答案卡元数据"
            className="rounded-xl border border-border bg-card/85 p-5 shadow-sm lg:sticky lg:top-28"
          >
            <h2 className="font-heading text-lg font-semibold">核验档案</h2>
            <dl className="mt-5 space-y-5 text-sm">
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
                value={`${linkedSentenceCount}/${factualSentences.length} 个事实句`}
              />
              <Meta
                icon={Quote}
                label="可定位证据覆盖"
                value={`${evidenceSentenceCount}/${factualSentences.length} 个事实句`}
              />
            </dl>
            <p className="mt-6 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">
              本指南不提供“可靠度分数”。请结合来源、范围、日期和警示自行判断。
            </p>
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
      className="scroll-mt-28 rounded-xl border border-border bg-card p-5 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          {number}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-heading font-semibold leading-6">
                {source.title}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                发布主体：{source.publisher}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                来源发布时间：
                {source.publishedAt
                  ? formatDate(source.publishedAt)
                  : '来源未标注'}
                {' · '}
                {source.kind === 'evidence' ? '平台收录' : '平台访问'}：
                {formatDateTime(
                  source.kind === 'evidence'
                    ? source.capturedAt
                    : (source.accessedAt ?? source.capturedAt),
                )}
              </p>
            </div>
            <Badge variant={source.kind === 'evidence' ? 'default' : 'outline'}>
              {source.kind === 'evidence' ? '可定位证据' : '外部链接'}
            </Badge>
          </div>
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
              平台未归档原文，未保存正文、截图或内容哈希；请到原站核查。
            </div>
          )}
          <a
            href={source.url}
            target={isExternal ? '_blank' : undefined}
            rel={isExternal ? 'noreferrer' : undefined}
            className="mt-4 inline-flex min-h-11 max-w-full items-center gap-2 break-all rounded-lg px-2 text-sm font-semibold text-primary outline-none hover:bg-primary/8 focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            查看来源{isExternal ? '（新窗口打开）' : ''}
            {isExternal ? (
              <ExternalLink aria-hidden="true" className="size-4 shrink-0" />
            ) : (
              <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" />
            )}
          </a>
          <a
            className="ml-2 text-xs text-muted-foreground underline-offset-4 hover:underline"
            href="#answer-heading"
          >
            返回答案
          </a>
        </div>
      </div>
    </li>
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
