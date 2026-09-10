import { RuntimeError } from '@information-community/runtime';
import { connectedSupplements, supplementMetadata } from '../community/supplements.mjs';

export function supplementDescriptors(content, nodes) {
  const revisions = new Map(content.revisions.map(revision => [revision.id, revision]));
  const entities = new Map(content.entities.map(entity => [entity.id, entity]));
  return nodes.map(node => {
    const data = revisions.get(node.revisionId).data, entity = entities.get(node.id);
    const topicId = data.topicId ?? entity.topicId ?? entity.extensions?.topicId;
    return { id: node.id, topic: topicId ? { id: topicId } : null, ...supplementMetadata(data) };
  });
}

/** Run after the whole approval batch, so child/parent submission order is immaterial. */
export function assertPublishedSupplements(content, entityIds) {
  const latest = new Map();
  for (const revision of content.revisions) {
    if (!latest.has(revision.entityId) || latest.get(revision.entityId).number < revision.number) latest.set(revision.entityId, revision);
  }
  const types = new Set(content.profile.entityTypes.filter(type => type.role === 'content').map(type => type.id));
  // Validate structure separately from reader visibility. A Pages-collected parent
  // can remain unverified while its supplement is independently reviewed.
  const nodes = content.entities.filter(entity => types.has(entity.type) && latest.has(entity.id))
    .map(entity => ({ id: entity.id, revisionId: entity.publicRevisionId ?? latest.get(entity.id).id }));
  const descriptors = supplementDescriptors(content, nodes);
  const visible = new Set(connectedSupplements(descriptors).map(answer => answer.id));
  const checked = new Set(entityIds);
  if (descriptors.some(answer => checked.has(answer.id) && !visible.has(answer.id))) {
    throw new RuntimeError('GUIDE_SUPPLEMENT', '补充信息必须关联同话题的有效陈述，且不能形成循环；本次未保存。', 422);
  }
}
