import { AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';

import type { RevisionStatus } from '@/lib/domain';
import { cn } from '@/lib/utils';

export function StatusBadge({
  status,
  compact = false,
}: {
  status: RevisionStatus;
  compact?: boolean;
}) {
  const Icon =
    status.tone === 'current'
      ? CheckCircle2
      : status.tone === 'warning'
        ? AlertTriangle
        : ShieldAlert;
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold',
        status.tone === 'current' &&
          'border-emerald-800/15 bg-emerald-900/8 text-emerald-900',
        status.tone === 'warning' &&
          'border-amber-700/20 bg-amber-500/10 text-amber-900',
        status.tone === 'danger' &&
          'border-red-800/20 bg-red-700/8 text-red-900',
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {compact && status.tone === 'current' ? '在复核期内' : status.label}
    </span>
  );
}
