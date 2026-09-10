import { importContent } from '@information-community/runtime';

export function initializeDemo(store, bundle) {
  if (store.read().revision !== 0) return false;
  store.transact(state => { state.modules.content = importContent(state.modules.content, bundle); });
  return true;
}
