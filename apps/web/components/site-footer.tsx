import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="mt-20 hidden border-t border-border bg-[#ece6d9]/60 md:block">
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 text-sm sm:grid-cols-[1fr_auto] sm:gap-8 sm:px-6 sm:py-10 lg:px-8">
        <div className="max-w-xl">
          <p className="font-heading font-semibold text-foreground">
            西浦非官方指南
          </p>
          <p className="mt-2 leading-6 text-muted-foreground">
            编辑维护、公开只读的校园信息核验指南。我们不提供“真相分”，请结合来源、适用范围、核验日期和争议提示自行判断。
          </p>
        </div>
        <nav
          aria-label="页脚导航"
          className="flex flex-wrap content-start gap-x-5 gap-y-1 text-muted-foreground sm:gap-y-3"
        >
          <Link
            className="inline-flex min-h-11 items-center underline-offset-4 hover:text-foreground hover:underline"
            href="/about"
          >
            方法与边界
          </Link>
          <Link
            className="inline-flex min-h-11 items-center underline-offset-4 hover:text-foreground hover:underline"
            href="/report"
          >
            报告问题
          </Link>
          <Link
            className="inline-flex min-h-11 items-center underline-offset-4 hover:text-foreground hover:underline"
            href="/research-intake"
          >
            私有研究线索
          </Link>
        </nav>
      </div>
    </footer>
  );
}
