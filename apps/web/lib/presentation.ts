import type { EvidenceCoverage, ScopeMode } from './domain';
import type { Scope } from './types';

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'Asia/Shanghai',
});

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Shanghai',
});

export function formatDate(value: number | string): string {
  const date =
    typeof value === 'number'
      ? new Date(value * 1000)
      : /^\d{4}-\d{2}-\d{2}$/u.test(value)
        ? new Date(`${value}T00:00:00+08:00`)
        : new Date(value);
  return dateFormatter.format(date);
}

export function formatDateTime(value: number): string {
  return dateTimeFormatter.format(new Date(value * 1000));
}

export function scopeLabel(mode: ScopeMode, scopes: Scope[]): string {
  if (mode === 'universal') return '通用';
  if (mode === 'unknown') return '适用范围待确认';
  return scopes.map((scope) => scope.labelZh).join(' · ');
}

export function evidenceCoverageLabel(coverage: EvidenceCoverage): string {
  if (coverage === 'fully_archived') return '全部为可定位证据';
  if (coverage === 'partial_archived') return '可定位证据 + 外部链接';
  return '仅外部来源链接';
}

export function reportTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    stale: '疑似过期',
    scope_error: '适用范围错误',
    source_mismatch: '来源与原文不符',
    privacy: '隐私或敏感信息',
  };
  return labels[type] ?? type;
}

export function reportStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    received: '已收到',
    reviewing: '复核中',
    resolved: '已处理',
    closed: '已关闭',
  };
  return labels[status] ?? status;
}

export function defaultEditorDates() {
  const now = new Date();
  const reviewDue = new Date(now.valueOf() + 45 * 86_400_000);
  return {
    asOf: now.toISOString().slice(0, 10),
    reviewDueOn: reviewDue.toISOString().slice(0, 10),
  };
}
