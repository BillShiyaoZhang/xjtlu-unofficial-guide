'use client';

import { Filter, Search, X } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';

type TopicOption = { slug: string; titleZh: string };
type ScopeOption = { id: string; labelZh: string };

export function SearchControls({
  query,
  topic,
  selectedScopes,
  topics,
  scopes,
}: {
  query: string;
  topic: string;
  selectedScopes: string[];
  topics: TopicOption[];
  scopes: ScopeOption[];
}) {
  const activeTopic = topics.find((item) => item.slug === topic);
  const activeScopes = scopes.filter((item) =>
    selectedScopes.includes(item.id),
  );
  const activeCount = Number(Boolean(activeTopic)) + activeScopes.length;

  return (
    <div className="mt-6 sm:mt-8">
      <form action="/search" className="sm:hidden">
        <div className="grid grid-cols-[minmax(0,1fr)_3.25rem] gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm">
          <label htmlFor="search-page-query-mobile" className="sr-only">
            你想确认什么？
          </label>
          <Input
            id="search-page-query-mobile"
            name="q"
            type="search"
            defaultValue={query}
            maxLength={160}
            enterKeyHint="search"
            className="min-h-13 border-0 bg-transparent px-3 text-base shadow-none focus-visible:ring-0"
            placeholder="输入问题或系统名称"
          />
          {topic ? <input type="hidden" name="topic" value={topic} /> : null}
          {selectedScopes.map((scope) => (
            <input key={scope} type="hidden" name="scope" value={scope} />
          ))}
          <Button
            type="submit"
            size="icon-lg"
            aria-label="查找答案"
            className="size-13 rounded-xl"
          >
            <Search aria-hidden="true" />
          </Button>
        </div>
      </form>

      <form action="/search" className="hidden sm:block">
        <div className="grid gap-3 rounded-xl border border-border bg-card p-3 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <label htmlFor="search-page-query" className="sr-only">
              你想确认什么？
            </label>
            <Input
              id="search-page-query"
              name="q"
              type="search"
              defaultValue={query}
              maxLength={160}
              enterKeyHint="search"
              className="min-h-12 border-0 bg-transparent px-3 text-base shadow-none focus-visible:ring-0 sm:text-base"
              placeholder="输入问题、系统名称或办事项"
            />
          </div>
          <Button type="submit" size="lg" className="min-h-12 px-6">
            <Search aria-hidden="true" />
            查找答案
          </Button>
        </div>
        <DesktopFilterFields
          query={query}
          topic={topic}
          selectedScopes={selectedScopes}
          topics={topics}
          scopes={scopes}
          activeCount={activeCount}
        />
      </form>

      <div className="mt-3 sm:hidden">
        <div className="flex items-center gap-2">
          <Drawer showSwipeHandle>
            <DrawerTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="min-h-11 rounded-full"
                />
              }
            >
              <Filter aria-hidden="true" />
              筛选
              {activeCount ? (
                <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                  {activeCount}
                </span>
              ) : null}
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader className="text-left">
                <DrawerTitle className="font-heading text-xl font-semibold">
                  筛选答案
                </DrawerTitle>
                <DrawerDescription className="text-left leading-6">
                  选择一个话题，并按需限定适用范围。
                </DrawerDescription>
              </DrawerHeader>
              <form action="/search" className="flex min-h-0 flex-1 flex-col">
                {query ? <input type="hidden" name="q" value={query} /> : null}
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
                  <FilterFields
                    topic={topic}
                    selectedScopes={selectedScopes}
                    topics={topics}
                    scopes={scopes}
                  />
                </div>
                <DrawerFooter className="border-t border-border bg-card pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
                  <Button type="submit" size="lg" className="min-h-12">
                    应用筛选
                  </Button>
                  <DrawerClose
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="lg"
                        className="min-h-11"
                      />
                    }
                  >
                    取消
                  </DrawerClose>
                </DrawerFooter>
              </form>
            </DrawerContent>
          </Drawer>
          {activeCount ? (
            <Link
              href={searchHref(query)}
              className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-semibold text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              <X aria-hidden="true" className="size-4" />
              清除
            </Link>
          ) : null}
        </div>
        {activeCount ? (
          <div
            aria-label="已选筛选条件"
            className="mt-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {activeTopic ? (
              <FilterChip
                label={activeTopic.titleZh}
                href={searchHref(query, '', selectedScopes)}
              />
            ) : null}
            {activeScopes.map((scope) => (
              <FilterChip
                key={scope.id}
                label={scope.labelZh}
                href={searchHref(
                  query,
                  topic,
                  selectedScopes.filter((id) => id !== scope.id),
                )}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DesktopFilterFields({
  query,
  topic,
  selectedScopes,
  topics,
  scopes,
  activeCount,
}: {
  query: string;
  topic: string;
  selectedScopes: string[];
  topics: TopicOption[];
  scopes: ScopeOption[];
  activeCount: number;
}) {
  return (
    <details
      className="mt-4 rounded-xl border border-border bg-card/70"
      open={activeCount > 0}
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
        <Filter aria-hidden="true" className="size-4 text-primary" />
        按话题与适用范围筛选
        {activeCount ? (
          <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
            已选 {activeCount}
          </span>
        ) : null}
      </summary>
      <div className="border-t border-border p-4">
        <FilterFields
          topic={topic}
          selectedScopes={selectedScopes}
          topics={topics}
          scopes={scopes}
          desktop
        />
        <div className="mt-6 flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="secondary"
            size="lg"
            className="min-h-11"
          >
            应用筛选
          </Button>
          <Link
            href={searchHref(query)}
            className="inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            清除筛选
          </Link>
        </div>
      </div>
    </details>
  );
}

function FilterFields({
  topic,
  selectedScopes,
  topics,
  scopes,
  desktop = false,
}: {
  topic: string;
  selectedScopes: string[];
  topics: TopicOption[];
  scopes: ScopeOption[];
  desktop?: boolean;
}) {
  return (
    <div className={desktop ? 'grid gap-6 md:grid-cols-2' : 'space-y-7'}>
      <fieldset>
        <legend className="text-sm font-semibold">话题</legend>
        <div className="mt-3 grid gap-1">
          <FilterOption
            type="radio"
            name="topic"
            value=""
            label="全部话题"
            defaultChecked={!topic}
          />
          {topics.map((item) => (
            <FilterOption
              key={item.slug}
              type="radio"
              name="topic"
              value={item.slug}
              label={item.titleZh}
              defaultChecked={topic === item.slug}
            />
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-sm font-semibold">适用范围（同时满足）</legend>
        <div
          className={
            desktop ? 'mt-3 grid gap-1 sm:grid-cols-2' : 'mt-3 grid gap-1'
          }
        >
          {scopes.map((scope) => (
            <FilterOption
              key={scope.id}
              type="checkbox"
              name="scope"
              value={scope.id}
              label={scope.labelZh}
              defaultChecked={selectedScopes.includes(scope.id)}
            />
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function FilterOption({
  type,
  name,
  value,
  label,
  defaultChecked,
}: {
  type: 'radio' | 'checkbox';
  name: string;
  value: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm active:bg-muted sm:min-h-11 sm:hover:bg-muted">
      <input
        type={type}
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="size-4 accent-primary"
      />
      {label}
    </label>
  );
}

function FilterChip({ label, href }: { label: string; href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full bg-primary/10 px-3 text-xs font-semibold text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
    >
      {label}
      <X aria-hidden="true" className="size-3.5" />
    </Link>
  );
}

function searchHref(query: string, topic = '', scopes: string[] = []) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (topic) params.set('topic', topic);
  for (const scope of scopes) params.append('scope', scope);
  const suffix = params.toString();
  return suffix ? `/search?${suffix}` : '/search';
}
