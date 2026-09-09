const actions = ['content.publish', 'content.hide', 'content.source'];
const fields = ['id', 'actorId', 'action', 'entityId', 'revisionId', 'version', 'createdAt', 'payload'];
const id = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/u.test(value);
const fail = () => { throw Object.assign(new Error('Invalid guide editorial review record'), { code: 'GUIDE_REVIEW_STATE' }); };

// Business-owned review evidence; persistence, encryption and rollback belong to the runtime.
export default {
  name: 'guide-reviews', contractVersion: 1, schemaVersion: 1,
  initialState: () => ({ records: [] }),
  validate(value, previous) {
    if (!value || Object.keys(value).join() !== 'records' || !Array.isArray(value.records)) fail();
    const seen = new Set();
    for (const row of value.records) {
      if (!row || Object.keys(row).some(key => !fields.includes(key)) || fields.some(key => !Object.hasOwn(row, key)) ||
          !id(row.id) || seen.has(row.id) || !id(row.actorId) || !id(row.entityId) ||
          !(row.revisionId === null || id(row.revisionId)) || !actions.includes(row.action) ||
          !Number.isSafeInteger(row.version) || row.version < 0 || !Number.isSafeInteger(row.createdAt) || row.createdAt < 0) fail();
      const payload = row.payload;
      if (!payload || payload.contextId !== row.id || payload.version !== 1 ||
          Object.keys(payload).some(key => !['version', 'keyVersion', 'contextId', 'aad', 'iv', 'ciphertext', 'tag'].includes(key)) ||
          !['keyVersion', 'aad', 'iv', 'ciphertext', 'tag'].every(key => typeof payload[key] === 'string' && payload[key].length > 0)) fail();
      seen.add(row.id);
    }
    if (previous && (value.records.length < previous.records.length || previous.records.some((row, index) => JSON.stringify(row) !== JSON.stringify(value.records[index])))) fail();
  },
  validateState(state) {
    for (const row of state.modules['guide-reviews'].records) {
      const content = state.modules.content;
      if (!content.entities.some(entity => entity.id === row.entityId) ||
          (row.revisionId !== null && !content.revisions.some(revision => revision.id === row.revisionId && revision.entityId === row.entityId))) fail();
    }
  },
};
