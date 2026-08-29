import { LockKeyhole } from 'lucide-react';
import type { Metadata } from 'next';

import { ResearchIntakeForm } from '@/components/research-intake-form';

export const metadata: Metadata = { title: '私有研究线索' };

export default function ResearchIntakePage() {
  return (
    <main
      id="main-content"
      className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8"
    >
      <header>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          <LockKeyhole className="size-4" />
          Private research intake
        </div>
        <h1 className="mt-3 font-heading text-4xl font-semibold tracking-tight">
          受邀参与者的私有线索
        </h1>
        <p className="mt-4 leading-7 text-muted-foreground">
          这里提交的是供编辑选题的私有线索，不是公开提问。入口只面向已通过线下流程确认成年的受邀参与者；平台不保存证件或出生日期。
        </p>
      </header>
      <div className="mt-6 rounded-xl border border-amber-700/20 bg-amber-500/10 p-4 text-sm font-medium leading-6 text-amber-950">
        请勿填写姓名、学号、电话、邮箱、身份证明或其他可识别个人的信息。材料链接只会保存，不会自动抓取或生成预览。
      </div>
      <div className="mt-8">
        <ResearchIntakeForm />
      </div>
    </main>
  );
}
