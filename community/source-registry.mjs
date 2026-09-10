import { readFileSync, readdirSync } from 'node:fs';
import { classifySource, validateSourceCategory } from './source-categories.mjs';

// Keep provenance outside immutable runtime source revisions. Research files are the
// editable source of truth; exact-URL overrides cover accepted community submissions.
const registry = new Map();
const read = url => JSON.parse(readFileSync(url, 'utf8'));
const directory = new URL('./handbook/', import.meta.url);
const parts = readdirSync(directory).filter(name => /^research-[a-z-]+\.json$/u.test(name)).sort()
  .map(name => read(new URL(name, directory)));
parts.push(read(new URL('./source-overrides.json', import.meta.url)));
for (const part of parts) for (const source of part.sources) {
  const category = source.sourceCategory === undefined ? classifySource(source) : validateSourceCategory(source.sourceCategory);
  const url = new URL(source.url).href;
  if (registry.has(url) && registry.get(url) !== category) throw new Error(`Conflicting source categories for ${url}`);
  registry.set(url, category);
}

export function publicSourceMetadata(source) {
  return {
    sourceCategory: classifySource(source, registry),
    ...(source.publisher ? { publisher: source.publisher } : {}),
  };
}
