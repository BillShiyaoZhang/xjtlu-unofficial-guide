import { LockKeyhole } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { ResearchIntakeForm } from '@/components/research-intake-form';
import { isOwnedPilotQuery } from '@/lib/measurement';
import { getPilotSessionForPage } from '@/lib/pilot-server';
import { openSearchView } from '@/lib/pilot-crypto';
import { listScopes } from '@/lib/repository';

export const metadata: Metadata = { title: '私有研究线索' };
export const dynamic = 'force-dynamic';

export default async function ResearchIntakePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const pilotSession = await getPilotSessionForPage();
  const sealedView = typeof params.v === 'string' ? params.v : '';
  const view =
    pilotSession && sealedView
      ? await openSearchView(sealedView, pilotSession.id)
      : null;
  const ownsQuery = Boolean(
    pilotSession &&
    view &&
    (await isOwnedPilotQuery(view.queryEventId, pilotSession)),
  );
  const defaultKind =
    params.kind === 'question' || params.kind === 'material' ? params.kind : '';
  const defaultBody = ownsQuery && view ? view.query : '';
  const scopes = ownsQuery && view ? await listScopes() : [];
  const defaultContextScope =
    ownsQuery && view
      ? scopes
          .filter((scope) => view.scopeIds.includes(scope.id))
          .map((scope) => scope.labelZh)
          .join('、')
      : '';
  const currentPath = sealedView
    ? `/research-intake?kind=${defaultKind || 'question'}&v=${encodeURIComponent(sealedView)}`
    : '/research-intake';
  return (
    <main
      id="main-content"
      className="mx-auto max-w-3xl px-4 py-7 sm:px-6 sm:py-12 lg:px-8"
    >
      <header>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          <LockKeyhole className="size-4" />
          Private research intake
        </div>
        <h1 className="mt-3 font-heading text-[2rem] font-semibold tracking-tight sm:text-4xl">
          受邀参与者的私有线索
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground sm:mt-4 sm:text-base sm:leading-7">
          这里提交的是供编辑选题的私有线索，不是公开提问。入口只面向已通过线下流程确认成年的受邀参与者；平台不保存证件或出生日期。
        </p>
      </header>
      <div className="mt-6 rounded-xl border border-amber-700/20 bg-amber-500/10 p-4 text-sm font-medium leading-6 text-amber-950">
        请勿填写姓名、学号、电话、邮箱、身份证明或其他可识别个人的信息。材料链接只会保存，不会自动抓取或生成预览。
      </div>
      <div className="mt-8">
        {pilotSession ? (
          <ResearchIntakeForm
            defaultKind={defaultKind}
            defaultBody={defaultBody}
            defaultContextScope={defaultContextScope}
            originQueryEventId={ownsQuery ? view?.queryEventId : undefined}
          />
        ) : (
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <h2 className="font-heading text-xl font-semibold">
              先加入成年研究试点
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              邀请代码只在加入页面兑换一次；之后由短期、安全的浏览器会话确认资格。
            </p>
            <Link
              href={`/pilot?returnTo=${encodeURIComponent(currentPath)}`}
              className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
            >
              使用邀请代码加入
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
