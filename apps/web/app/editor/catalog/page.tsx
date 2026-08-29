import { FolderTree } from 'lucide-react';
import type { Metadata } from 'next';

import { EditorAccessDenied } from '@/components/editor-access-denied';
import { EditorCatalogManager } from '@/components/editor-catalog-manager';
import { EditorNav } from '@/components/editor-nav';
import { requireEditorPage } from '@/lib/authz';
import { getEditorCatalog } from '@/lib/editor-catalog';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '分类与来源' };

export default async function EditorCatalogPage() {
  const { user, allowed } = await requireEditorPage(
    '/editor/catalog',
    'content:edit',
  );
  if (!allowed) return <EditorAccessDenied email={user.email} />;
  const catalog = await getEditorCatalog();
  return (
    <main
      id="main-content"
      className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8"
    >
      <EditorNav
        displayName={user.displayName}
        permissions={user.permissions}
      />
      <header className="mb-8 flex items-center gap-4">
        <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
          <FolderTree className="size-6" />
        </span>
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            分类与来源
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            从空数据库建立可编辑内容，并安全处置失效来源
          </p>
        </div>
      </header>
      <EditorCatalogManager initial={catalog} />
    </main>
  );
}
