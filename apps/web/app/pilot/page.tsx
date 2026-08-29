import { FlaskConical } from 'lucide-react';
import type { Metadata } from 'next';

import { PilotAccessPanel } from '@/components/pilot-access-panel';
import { parsePilotReturnTo } from '@/lib/mobile-navigation';
import { getPilotSessionForPage } from '@/lib/pilot-server';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '研究试点' };

export default async function PilotPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const session = await getPilotSessionForPage();
  const returnTo = parsePilotReturnTo(
    typeof params.returnTo === 'string' ? params.returnTo : undefined,
  );
  return (
    <main
      id="main-content"
      className="mx-auto max-w-3xl px-4 py-7 sm:px-6 sm:py-12 lg:px-8"
    >
      <header className="flex items-center gap-3">
        <span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
          <FlaskConical aria-hidden="true" className="size-6" />
        </span>
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-4xl">
            研究试点
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            成年参与者的邀请、同意与会话
          </p>
        </div>
      </header>
      <div className="mt-7">
        <PilotAccessPanel
          active={Boolean(session)}
          expiresAt={session?.expiresAt}
          testSession={session?.isTest}
          returnTo={returnTo}
        />
      </div>
    </main>
  );
}
