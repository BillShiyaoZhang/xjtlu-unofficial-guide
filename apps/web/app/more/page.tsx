import {
  BookOpenCheck,
  ChevronRight,
  FlaskConical,
  LockKeyhole,
  MessageSquareWarning,
  ShieldCheck,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { InstallAppPanel } from '@/components/install-app-panel';

export const metadata: Metadata = { title: '更多' };

const entries = [
  {
    href: '/pilot',
    title: '研究试点',
    detail: '兑换邀请、查看会话或撤回同意',
    icon: FlaskConical,
    iconClassName: 'bg-[#dcebe5] text-[#0f594d]',
  },
  {
    href: '/about',
    title: '方法与边界',
    detail: '来源、核验和适用范围',
    icon: ShieldCheck,
    iconClassName: 'bg-[#dcebe5] text-[#0f594d]',
  },
  {
    href: '/report',
    title: '报告问题',
    detail: '指出错误、过期或不清楚之处',
    icon: MessageSquareWarning,
    iconClassName: 'bg-[#f3dfb4] text-[#8a4a10]',
  },
  {
    href: '/research-intake',
    title: '私有研究线索',
    detail: '受邀参与者的非公开入口',
    icon: LockKeyhole,
    iconClassName: 'bg-[#eedbd3] text-[#8f4334]',
  },
] as const;

export default function MorePage() {
  return (
    <main
      id="main-content"
      className="mx-auto max-w-3xl px-4 pb-8 pt-6 sm:px-6 sm:py-12 lg:px-8"
    >
      <header className="flex items-center gap-3">
        <span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
          <BookOpenCheck aria-hidden="true" className="size-6" />
        </span>
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-4xl">
            更多
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">指南设置与帮助</p>
        </div>
      </header>

      <nav
        aria-label="更多功能"
        className="mt-7 overflow-hidden rounded-2xl bg-card shadow-[0_8px_28px_rgb(40_47_43/6%)] ring-1 ring-foreground/10"
      >
        {entries.map((entry) => {
          const Icon = entry.icon;
          return (
            <Link
              key={entry.href}
              href={entry.href}
              className="group flex min-h-20 items-center gap-3 border-b border-border px-4 py-3 outline-none last:border-b-0 active:bg-muted focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/40 sm:px-5"
            >
              <span
                className={`grid size-11 shrink-0 place-items-center rounded-2xl ${entry.iconClassName}`}
              >
                <Icon aria-hidden="true" className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-heading text-base font-semibold">
                  {entry.title}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground sm:text-sm">
                  {entry.detail}
                </span>
              </span>
              <ChevronRight
                aria-hidden="true"
                className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          );
        })}
      </nav>

      <section aria-label="应用状态" className="mt-6 grid grid-cols-2 gap-3">
        <InstallAppPanel />
        <div className="rounded-2xl bg-[#e9e3d5] p-4">
          <BookOpenCheck aria-hidden="true" className="size-6 text-[#725c30]" />
          <p className="mt-4 font-heading font-semibold">离线有备用页</p>
          <p className="mt-1 text-xs leading-5 text-foreground/65">
            答案仍以在线版本为准
          </p>
        </div>
      </section>

      <p className="mt-7 text-center text-xs leading-5 text-muted-foreground">
        非官方整理 · 与西交利物浦大学无隶属或背书关系
      </p>
    </main>
  );
}
