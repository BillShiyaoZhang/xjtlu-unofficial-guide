import { CalendarClock, ChevronRight, MapPin } from 'lucide-react';
import Link from 'next/link';

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { formatDate, scopeLabel } from '@/lib/presentation';
import { topicVisualFor } from '@/lib/topic-presentation';
import type { AnswerCardSummary } from '@/lib/types';
import { cn } from '@/lib/utils';

import { StatusBadge } from './status-badge';

export function AnswerCardPreview({
  card,
  sourceTab,
  returnTo,
}: {
  card: AnswerCardSummary;
  sourceTab?: 'home' | 'search' | 'topics';
  returnTo?: string;
}) {
  const visual = topicVisualFor(card.topicSlug);
  const Icon = visual.icon;
  const context = new URLSearchParams();
  if (sourceTab) context.set('tab', sourceTab);
  if (returnTo) context.set('from', returnTo);
  const contextQuery = context.toString();
  const href = `/answers/${card.slug}${contextQuery ? `?${contextQuery}` : ''}`;

  return (
    <Card className="group relative gap-0 border-0 bg-card/95 py-0 shadow-[0_8px_28px_rgb(40_47_43/6%)] ring-1 ring-foreground/10 transition-[box-shadow] hover:shadow-[0_12px_35px_rgb(40_47_43/10%)] hover:ring-primary/25">
      <div
        aria-hidden="true"
        className={cn(
          'absolute inset-y-0 left-0 w-1 rounded-l-xl',
          card.status.tone === 'current' && 'bg-primary',
          card.status.tone === 'warning' && 'bg-amber-500',
          card.status.tone === 'danger' && 'bg-red-700',
        )}
      />
      <CardHeader className="gap-0 p-4 pb-3 sm:p-6 sm:pb-3">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'grid size-10 shrink-0 place-items-center rounded-2xl shadow-sm',
              visual.iconClassName,
            )}
          >
            <Icon aria-hidden="true" className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground">
                {card.topicTitle}
              </span>
              <StatusBadge status={card.status} compact />
            </div>
            <CardTitle className="mt-2 font-heading text-lg font-semibold leading-snug tracking-tight sm:text-2xl">
              <Link
                href={href}
                prefetch={false}
                className="rounded-sm outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-3 focus-visible:after:ring-ring/40"
              >
                {card.title}
              </Link>
            </CardTitle>
          </div>
          <ChevronRight
            aria-hidden="true"
            className="mt-2 size-5 shrink-0 text-muted-foreground sm:hidden"
          />
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
        <p className="line-clamp-2 text-sm leading-6 text-foreground/75 sm:text-[15px] sm:leading-7">
          {card.summary}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-xs text-muted-foreground sm:mt-5">
          <div className="flex items-start gap-2">
            <MapPin
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0 text-primary"
            />
            <div>
              <dt className="font-semibold text-foreground/70">适用于</dt>
              <dd className="mt-0.5 leading-5">
                {scopeLabel(card.scopeMode, card.scopes)}
              </dd>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <CalendarClock
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0 text-primary"
            />
            <div>
              <dt className="font-semibold text-foreground/70">信息截至</dt>
              <dd className="mt-0.5 leading-5">{formatDate(card.asOf)}</dd>
            </div>
          </div>
        </dl>
      </CardContent>
      <CardFooter className="hidden justify-between gap-3 rounded-b-xl border-t border-border/80 bg-muted/40 px-4 py-3 sm:flex sm:px-6 sm:py-4">
        <span className="text-xs text-muted-foreground">
          {formatDate(card.verifiedAt)} 核验
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
          打开
          <ChevronRight
            aria-hidden="true"
            className="size-4 transition-transform group-hover:translate-x-0.5"
          />
        </span>
      </CardFooter>
    </Card>
  );
}
