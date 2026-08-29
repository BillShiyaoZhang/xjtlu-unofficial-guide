import { Ban, CheckCircle2, ExternalLink, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: '关于本指南' };

export default function AboutPage() {
  return (
    <main
      id="main-content"
      className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8"
    >
      <header className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          About & method
        </p>
        <h1 className="mt-2 text-balance font-heading text-4xl font-semibold tracking-tight sm:text-5xl">
          把“从哪看到的、适用于谁、什么时候核过”放回答案里
        </h1>
        <p className="mt-5 text-lg leading-8 text-muted-foreground">
          这是编辑维护、公开只读的非官方校园信息核验指南。它链接和解释权威来源，不替代
          e-Bridge、学校网站、Learning Mall 或任何官方业务系统。
        </p>
      </header>

      <section
        id="method"
        aria-labelledby="method-heading"
        className="mt-12 scroll-mt-28 rounded-2xl border border-primary/15 bg-card p-6 shadow-sm sm:p-8"
      >
        <div className="flex items-start gap-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheck className="size-5" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-primary">
              Editorial rule
            </p>
            <h2
              id="method-heading"
              className="mt-1 font-heading text-2xl font-semibold"
            >
              阶段 1 的公开规则
            </h2>
            <p className="mt-4 text-[17px] leading-8 text-foreground/80">
              每张公开答案都必须标出适用范围、信息截至日期、人工核验时间、复核期限和来源。待复核内容会显示警示并在检索中降级。
            </p>
          </div>
        </div>
      </section>

      <div className="mt-12 grid gap-6 md:grid-cols-2">
        <section className="rounded-xl border border-border bg-card/75 p-6">
          <h2 className="flex items-center gap-2 font-heading text-2xl font-semibold">
            <CheckCircle2 className="size-5 text-primary" />
            这一版会做
          </h2>
          <ul className="mt-5 space-y-3 text-sm leading-6 text-foreground/75">
            <li>中英文关键词、别名和适用范围检索</li>
            <li>编辑发布的答案卡与逐句来源</li>
            <li>不可变版本历史、复核负责人和到期队列</li>
            <li>匿名无文本反馈、结构化报告和邀请制私有线索</li>
          </ul>
        </section>
        <section className="rounded-xl border border-border bg-card/75 p-6">
          <h2 className="flex items-center gap-2 font-heading text-2xl font-semibold">
            <Ban className="size-5 text-destructive" />
            这一版不会做
          </h2>
          <ul className="mt-5 space-y-3 text-sm leading-6 text-foreground/75">
            <li>公开投稿、评论、匿名树洞或人物评价</li>
            <li>“真相分”、用户信用分或全校意见百分比</li>
            <li>大模型生成公开答案、向量检索或知识图谱</li>
            <li>自动抓取学校网站、保存 link-only 原文或附件</li>
          </ul>
        </section>
      </div>

      <section
        aria-labelledby="labels-heading"
        className="mt-12 border-t border-border pt-10"
      >
        <h2 id="labels-heading" className="font-heading text-3xl font-semibold">
          两种来源标签
        </h2>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-5">
            <p className="font-semibold text-primary">可定位证据</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              平台有权保存一段精确摘录，并记录页码、章节或其他定位信息。高影响结论只能使用这类证据。
            </p>
          </div>
          <div className="rounded-xl border border-amber-700/15 bg-amber-500/8 p-5">
            <p className="font-semibold text-amber-900">平台未归档的外部链接</p>
            <p className="mt-2 text-sm leading-6 text-amber-950/75">
              平台只保存
              URL、标题、发布/访问时间，不保存正文、截图、哈希、embedding，也不会送给模型。
            </p>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="official-heading"
        className="mt-12 border-t border-border pt-10"
      >
        <h2
          id="official-heading"
          className="font-heading text-3xl font-semibold"
        >
          优先核对的官方入口
        </h2>
        <div className="mt-5 flex flex-wrap gap-3">
          {[
            ['在校学生', 'https://www.xjtlu.edu.cn/zh/current-students'],
            [
              'e-Bridge IT 服务说明',
              'https://www.xjtlu.edu.cn/en/it-services/e-bridge-eng',
            ],
            [
              'Learning Mall Knowledge Base',
              'https://knowledgebase.xjtlu.edu.cn/',
            ],
          ].map(([label, href]) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noreferrer"
              className={cn(
                buttonVariants({ variant: 'outline', size: 'lg' }),
                'min-h-11',
              )}
            >
              {label}
              <ExternalLink />
            </a>
          ))}
        </div>
      </section>

      <div className="mt-12 flex flex-wrap gap-3">
        <Link
          href="/search"
          className={cn(buttonVariants({ size: 'lg' }), 'min-h-11')}
        >
          开始查找
        </Link>
        <Link
          href="/report"
          className={cn(
            buttonVariants({ variant: 'outline', size: 'lg' }),
            'min-h-11',
          )}
        >
          报告问题
        </Link>
        <Link
          href="/editor"
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'lg' }),
            'min-h-11 text-muted-foreground',
          )}
        >
          编辑入口
        </Link>
      </div>
    </main>
  );
}
