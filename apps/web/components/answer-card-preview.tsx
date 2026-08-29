import { ArrowUpRight, CalendarClock, MapPin } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { formatDate, scopeLabel } from '@/lib/presentation';
import type { AnswerCardSummary } from '@/lib/types';
import { cn } from '@/lib/utils';

import { StatusBadge } from './status-badge';

export function AnswerCardPreview({ card }: { card: AnswerCardSummary }) {
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
      <CardHeader className="gap-3 p-5 pb-3 sm:p-6 sm:pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{card.topicTitle}</Badge>
          <StatusBadge status={card.status} compact />
        </div>
        <CardTitle className="font-heading text-xl font-semibold leading-snug tracking-tight sm:text-2xl">
          <Link
            href={`/answers/${card.slug}`}
            className="rounded-sm outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-3 focus-visible:after:ring-ring/40"
          >
            {card.title}
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-5 pt-0 sm:p-6 sm:pt-0">
        <p className="text-[15px] leading-7 text-foreground/80">
          {card.summary}
        </p>
        <dl className="mt-5 grid grid-cols-2 gap-3 text-xs text-muted-foreground">
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
      <CardFooter className="justify-between gap-3 rounded-b-xl border-t border-border/80 bg-muted/40 p-4 pl-5 sm:pl-6">
        <span className="text-xs text-muted-foreground">
          人工核验：{formatDate(card.verifiedAt)}
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
          查看答案与来源
          <ArrowUpRight
            aria-hidden="true"
            className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
          />
        </span>
      </CardFooter>
    </Card>
  );
}
