import { Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function SearchBox({ defaultValue = '', compact = false }) {
  return (
    <form
      action="/search"
      className={
        compact
          ? 'grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]'
          : 'grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-2xl border border-primary/15 bg-card p-2 shadow-[0_16px_50px_rgb(41_53_46/10%)] sm:gap-3 sm:p-3'
      }
    >
      <div>
        <label
          htmlFor={compact ? 'search-query-compact' : 'search-query'}
          className="sr-only"
        >
          你想确认什么？
        </label>
        <Input
          id={compact ? 'search-query-compact' : 'search-query'}
          name="q"
          type="search"
          defaultValue={defaultValue}
          maxLength={160}
          className="min-h-13 border-0 bg-transparent px-3 text-base shadow-none focus-visible:ring-0 sm:min-h-12 sm:text-base"
          placeholder="例如：在哪里查 Learning Mall 的操作帮助？"
          autoComplete="off"
          enterKeyHint="search"
        />
      </div>
      <Button
        type="submit"
        size="lg"
        aria-label="查找答案"
        className="min-h-13 min-w-13 rounded-xl px-4 text-base sm:min-h-12 sm:px-5"
      >
        <Search aria-hidden="true" />
        <span className="hidden min-[430px]:inline">查找答案</span>
      </Button>
    </form>
  );
}
