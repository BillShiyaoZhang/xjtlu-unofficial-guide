'use client';

import { Check, Copy, Link2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

export function ReportReferenceActions({ code }: { code: string }) {
  const [copied, setCopied] = useState<'code' | 'link' | 'error' | null>(null);

  async function copy(value: string, kind: 'code' | 'link') {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
    } catch {
      setCopied('error');
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void copy(code, 'code')}
        >
          {copied === 'code' ? <Check /> : <Copy />}
          {copied === 'code' ? '编号已复制' : '复制编号'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void copy(window.location.href, 'link')}
        >
          {copied === 'link' ? <Check /> : <Link2 />}
          {copied === 'link' ? '链接已复制' : '复制状态链接'}
        </Button>
      </div>
      <p aria-live="polite" className="mt-2 text-xs text-muted-foreground">
        {copied === 'error' ? '无法自动复制，请从地址栏手动复制。' : null}
      </p>
    </div>
  );
}
