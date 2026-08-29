import type { ScopeMode } from './domain';
import type { Scope } from './types';

export function matchesScopeSelection(
  scopeMode: ScopeMode,
  cardScopes: Scope[],
  selectedByDimension: ReadonlyMap<string, ReadonlySet<string>>,
) {
  if (selectedByDimension.size === 0 || scopeMode === 'universal') return true;
  if (scopeMode === 'unknown') return false;

  const present = new Set(cardScopes.map((scope) => scope.id));
  for (const selectedIds of selectedByDimension.values()) {
    if (![...selectedIds].some((scopeId) => present.has(scopeId))) return false;
  }
  return true;
}
