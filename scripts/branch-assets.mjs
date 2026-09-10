import { readFile } from 'node:fs/promises';

// Serve the installed package verbatim; the consumer owns only the domain UI.
export async function coreBrowserAssets() {
  const entry = new URL(import.meta.resolve('@information-community/core'));
  return Object.fromEntries(await Promise.all(['index.js', 'branches.js', 'LICENSE'].map(async name => [
    `core/${name}`, await readFile(new URL(name, entry), 'utf8'),
  ])));
}

export async function branchBrowserAssets() {
  const files = Object.fromEntries(await Promise.all(['branches.js', 'branch-model.js', 'branches.css'].map(async name => [
    name, await readFile(new URL(`../community/ui/${name}`, import.meta.url), 'utf8'),
  ])));
  return { ...files, ...await coreBrowserAssets() };
}
