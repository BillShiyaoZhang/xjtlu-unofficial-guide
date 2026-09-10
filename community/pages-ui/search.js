// Search intent expands vocabulary; it never changes an article's applicability.
const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().trim();
const vocabulary = [
  ['申请研究生', '申请硕士', '研究生申请', '升学申请'],
  ['找导师', '研究方向', '潜在导师'],
  ['暑研', '暑期科研', 'surf'],
  ['宿舍报修', '公寓报修', '宿舍水电'],
  ['选课', '课程大纲', 'module catalogue'],
  ['园区', '苏州'],
];
function groups(query, aliases = {}) {
  const dictionaries = [...vocabulary, ...Object.entries(aliases).map(([word, values]) => [word, ...(Array.isArray(values) ? values : [])])].map(group => group.map(normalize));
  const full = normalize(query);
  const exact = dictionaries.find(group => group.includes(full));
  if (exact) return [[...new Set([full, ...exact])]];
  return full.split(/\s+/u).filter(Boolean).map(word => [...new Set([word, ...dictionaries.filter(group => group.includes(word)).flat()])]);
}
export function scopeText(answer, catalog) {
  return Object.entries(answer.scope ?? {}).flatMap(([dimension, values]) => values.map(value => catalog.scopes?.find(scope => scope.dimension === dimension && (scope.id === value || scope.code === value))?.labelZh ?? value)).join(' · ');
}
export function searchAnswers(snapshot, query = '', topicId = '') {
  const terms = groups(query, snapshot.search?.aliases);
  const campusFor = alternatives => alternatives.includes('太仓') ? 'taicang' : alternatives.some(term => ['苏州', '园区'].includes(term)) ? 'suzhou' : null;
  return snapshot.answers.map((answer, index) => {
    if (topicId && answer.topic?.id !== topicId) return { answer, score: -1, index };
    const campuses = (answer.scope?.campus ?? []).map(value => snapshot.catalog.scopes?.find(scope => scope.dimension === 'campus' && (scope.id === value || scope.code === value))?.code ?? value);
    const fields = [
      [answer.title, 12], [answer.summary, 6], [answer.topic?.title, 4],
      [scopeText(answer, snapshot.catalog), 3],
      [(answer.sentences ?? []).map(row => row.text).join(' '), 2],
      [(answer.citations ?? []).map(row => row.title).join(' '), 1],
    ].map(([text, weight]) => [normalize(text), weight]);
    let score = 0;
    for (const alternatives of terms) {
      const campus = campusFor(alternatives);
      if (campus && !campuses.includes(campus) && !campuses.includes('universal')) return { answer, score: -1, index };
      const match = Math.max(campus ? 3 : 0, ...fields.flatMap(([text, weight]) => alternatives.map(term => text.includes(term) ? weight : 0)));
      if (!match) return { answer, score: -1, index };
      score += match;
    }
    if (terms.length && normalize(answer.title).includes(normalize(query))) score += 5;
    return { answer, score, index };
  }).filter(row => row.score >= 0).sort((a, b) => Number(a.answer.demo) - Number(b.answer.demo) || b.score - a.score || a.index - b.index).map(row => row.answer);
}
