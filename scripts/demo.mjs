import { importContent, publishContent } from '@information-community/runtime';

export function initializeDemo(store, bundle) {
  if (store.read().revision !== 0) return false;
  const targets = bundle.entities.filter(item => item.type === 'answer').map(entity => {
    const revisions = bundle.revisions.filter(item => item.entityId === entity.id);
    if (revisions.length !== 1 || revisions[0].data.demo !== true) throw new Error('Demo initialization only publishes explicitly marked demo revisions.');
    return { entityId: entity.id, revisionId: revisions[0].id };
  });
  store.transact(state => { state.modules.content = importContent(state.modules.content, bundle); });
  store.transact(state => {
    for (const target of targets) {
      const entity = state.modules.content.entities.find(item => item.id === target.entityId);
      state.modules.content = publishContent(state.modules.content, { ...target, expectedVersion: entity.version });
      state.audit.push({ action: 'demo.publish', actorId: 'local-demo', targetId: entity.id, at: Date.now() });
    }
  });
  return true;
}
