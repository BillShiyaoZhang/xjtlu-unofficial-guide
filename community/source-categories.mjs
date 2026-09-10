/** Provenance describes the original material, independently of authorship or review. */
export const SOURCE_CATEGORIES = Object.freeze(['university_official', 'user_provided', 'web']);
export const SOURCE_CATEGORY_LABELS = Object.freeze({
  university_official: '学校官方', user_provided: '用户提供', web: '网络资料',
});

export function validateSourceCategory(value) {
  if (!SOURCE_CATEGORIES.includes(value)) throw new Error(`Invalid source category: ${String(value)}`);
  return value;
}

/** Only XJTLU's domain identifies the university by itself. WeChat requires a curated entry. */
export function classifySource(source, registry = new Map()) {
  const url = new URL(source.url);
  const registered = registry.get(url.href);
  if (source.sourceCategory !== undefined) {
    validateSourceCategory(source.sourceCategory);
    if (registered && registered !== source.sourceCategory) throw new Error(`Conflicting source category: ${url.href}`);
    return source.sourceCategory;
  }
  if (registered) return validateSourceCategory(registered);
  return url.hostname === 'xjtlu.edu.cn' || url.hostname.endsWith('.xjtlu.edu.cn') ? 'university_official' : 'web';
}

export function sourceCategories(citations) {
  return SOURCE_CATEGORIES.filter(category => citations.some(citation => citation.sourceCategory === category));
}
