const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/u.test(value);

/** Optional business metadata on an independently evidenced content revision. */
export function supplementMetadata(data) {
  return Object.hasOwn(data, 'supplementTo') ? { supplementTo: data.supplementTo } : {};
}

/** Keep only complete public parent chains. Never promote an orphan to a root. */
export function connectedSupplements(answers) {
  const byId = new Map(answers.map(answer => [answer.id, answer]));
  const valid = new Map();
  for (const answer of answers) {
    if (valid.has(answer.id)) continue;
    const trail = [], seen = new Set();
    let current = answer, allowed = false;
    while (current) {
      if (valid.has(current.id)) { allowed = valid.get(current.id); break; }
      if (seen.has(current.id)) break;
      trail.push(current.id); seen.add(current.id);
      if (!Object.hasOwn(current, 'supplementTo')) { allowed = true; break; }
      if (!identifier(current.supplementTo)) break;
      const parent = byId.get(current.supplementTo);
      if (!parent || (parent.topic?.id ?? null) !== (current.topic?.id ?? null)) break;
      current = parent;
    }
    for (const id of trail) valid.set(id, allowed);
  }
  return answers.filter(answer => valid.get(answer.id));
}

/** Additional public ancestors for filtered results, without counting them as matches. */
export function supplementContext(allAnswers, answers) {
  const byId = new Map(allAnswers.map(answer => [answer.id, answer]));
  const included = new Set(answers.map(answer => answer.id)), context = new Set();
  for (const answer of answers) {
    let current = answer;
    while (current?.supplementTo && byId.has(current.supplementTo)) {
      current = byId.get(current.supplementTo);
      if (included.has(current.id)) break;
      included.add(current.id); context.add(current.id);
    }
  }
  return allAnswers.filter(answer => context.has(answer.id));
}
