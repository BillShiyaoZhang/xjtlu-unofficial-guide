import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentModule, importContent } from '@information-community/runtime';
import { classifySource, SOURCE_CATEGORY_LABELS, sourceCategories } from '../community/source-categories.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const prefix = 'handbook-';
const inputs = ['research-arrival.json', 'research-study.json', 'research-life.json', 'research-navigation.json', 'research-supplement.json'];
const json = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 16);
const fail = message => { throw new Error(`Handbook: ${message}`); };
const titles = {
  method: ['使用指南与信息核对', 'Using this guide'],
  arrival: ['到校准备', 'Arrival'], systems: ['账号与系统', 'Accounts & systems'],
  services: ['校园办事', 'Student services'], campus: ['校区与地图', 'Campuses & maps'],
  transport: ['交通与出行', 'Transport'], housing: ['住宿与报修', 'Accommodation'],
  life: ['饮食与城市生活', 'Daily life'], study: ['学习与教务', 'Study & registry'],
  library: ['图书馆与信息素养', 'Library'], language: ['语言与学术写作', 'Academic literacies'],
  wellbeing: ['身心健康与求助', 'Wellbeing'], international: ['国际学生支持', 'International support'],
  finance: ['费用与资助入口', 'Fees & support'], clubs: ['社团与活动', 'Clubs & activities'],
  sport: ['体育与运动', 'Sport'], exchange: ['海外交流', 'Global opportunities'],
  careers: ['实习就业与升学', 'Careers'], research: ['科研与创新', 'Research'],
  community: ['学生社区与非官方资源', 'Student resources'],
};
const topicIds = { method: 'topic-method', arrival: 'topic-arrival', systems: 'topic-systems', services: 'topic-services' };
const labels = { universal: '通用入口（具体服务资格需核对）', suzhou: '苏州工业园区校园', taicang: '太仓校园', undergraduate: '本科生', postgraduate: '研究生', 'new-student': '新生' };
const keyPattern = /^[a-z0-9][a-z0-9-]{0,65}$/u;
const markdown = value => String(value).replace(/[\\`*_{}[\]<>]/gu, '\\$&');
const link = source => `[${markdown(source.title)}](${source.url.replaceAll('(', '%28').replaceAll(')', '%29')})`;

export async function compileHandbook() {
  const [parts, original, catalog, profile] = await Promise.all([
    Promise.all(inputs.map(name => json(`community/handbook/${name}`))),
    json('community/content.json'), json('community/catalog.json'), json('community/content-profile.json'),
  ]);
  const date = parts[0].researchedAt;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || parts.some(part => part.researchedAt !== date)) fail('research dates must match');
  const timestamp = `${date}T00:00:00Z`;
  const sources = new Map(), byKey = new Map(), cards = [];
  for (const part of parts) {
    for (const source of part.sources) {
      const key = `${part.section}:${source.key}`;
      if (byKey.has(key)) fail(`duplicate source key ${key}`);
      const url = new URL(source.url);
      const sourceCategory = classifySource(source);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || ['localhost', '127.0.0.1'].includes(url.hostname)) fail(`invalid source URL ${key}`);
      if (!source.title || !source.publisher || !source.note || source.accessedAt !== date || !['opened', 'search-result-only'].includes(source.verification)) fail(`incomplete source metadata ${key}`);
      if (source.publishedAt !== null && (!/^\d{4}-\d{2}-\d{2}$/u.test(source.publishedAt) || source.publishedAt > date)) fail(`invalid publication date ${key}`);
      // URL identity deduplicates shared official pages; all individual research notes are retained in the source index.
      const identity = url.href;
      const retained = sources.get(identity) ?? { ...source, sourceCategory, url: identity, id: `${prefix}source-${hash(identity)}`, observations: [] };
      if (retained.sourceCategory !== sourceCategory) fail(`conflicting source categories for ${identity}`);
      retained.observations.push({ section: part.section, key: source.key, note: source.note, verification: source.verification });
      sources.set(identity, retained);
      byKey.set(key, { ...source, sourceCategory, id: retained.id, url: identity });
    }
    cards.push(...part.cards.map(card => ({ ...card, section: part.section })));
  }
  const seen = new Set();
  for (const card of cards) {
    if (!keyPattern.test(card.key) || seen.has(card.key)) fail(`invalid or duplicate card key ${card.key}`);
    seen.add(card.key);
    if (!titles[card.topic] || !card.title || !card.summary || card.sentences.length < 3 || !card.sentences.some(sentence => sentence.kind === 'fact')) fail(`incomplete card ${card.key}`);
    for (const [field, allowed] of [['campuses', ['universal', 'suzhou', 'taicang']], ['audiences', ['universal', 'new-student', 'undergraduate', 'postgraduate']]]) {
      if (!Array.isArray(card[field]) || !card[field].length || card[field].some(value => !allowed.includes(value)) || (card[field].includes('universal') && card[field].length !== 1)) fail(`invalid ${field} in ${card.key}`);
    }
    if (!Number.isInteger(card.reviewAfterDays) || card.reviewAfterDays < 1 || card.reviewAfterDays > 180) fail(`invalid review interval in ${card.key}`);
    for (const sentence of card.sentences) {
      if (!['fact', 'advice'].includes(sentence.kind) || !sentence.text?.trim() || !Array.isArray(sentence.sourceKeys)) fail(`invalid sentence in ${card.key}`);
      if (sentence.kind === 'fact' && !sentence.sourceKeys.length) fail(`uncited fact in ${card.key}`);
      for (const key of sentence.sourceKeys) {
        const source = byKey.get(`${card.section}:${key}`);
        if (!source) fail(`unknown source ${key} in ${card.key}`);
        if (sentence.kind === 'fact' && source.verification !== 'opened') fail(`fact relies on unopened source in ${card.key}`);
      }
    }
  }
  const usedTopics = new Set(cards.map(card => card.topic));
  for (const [code, [titleZh, titleEn]] of Object.entries(titles)) {
    if (!usedTopics.has(code)) continue;
    const id = topicIds[code] ?? `topic-${code}`;
    if (!catalog.topics.some(topic => topic.id === id)) catalog.topics.push({ id, slug: code, titleZh, titleEn, description: `${titleZh}的来源、办事步骤和需核对事项。`, status: 'active', aliases: [...new Set(cards.filter(card => card.topic === code).flatMap(card => card.keywords))] });
  }
  for (const [dimension, code, labelEn] of [['campus', 'taicang', 'Taicang campus'], ['audience', 'undergraduate', 'Undergraduates'], ['audience', 'postgraduate', 'Postgraduates']]) {
    if (!catalog.scopes.some(scope => scope.dimension === dimension && scope.code === code)) catalog.scopes.push({ id: `scope-${dimension}-${code}`, dimension, code, labelZh: labels[code], labelEn, sortOrder: 20 + catalog.scopes.length, status: 'active' });
  }
  const bundle = { schemaVersion: 1, entities: [], revisions: [], citations: [], links: [] };
  const usedSources = new Set(cards.flatMap(card => card.sentences.flatMap(sentence => sentence.sourceKeys.map(key => byKey.get(`${card.section}:${key}`).id))));
  for (const source of sources.values()) {
    if (!usedSources.has(source.id)) continue;
    // The runtime's link-only allowlist excludes custom metadata. Keep provenance
    // in the research registry and public DTO, without rewriting immutable v1 data.
    bundle.entities.push({ id: source.id, type: 'artifact', externalId: source.id });
    bundle.revisions.push({ id: `${source.id}-v1`, entityId: source.id, number: 1, parentRevisionId: null, createdAt: timestamp,
      data: { title: source.title, url: source.url, mode: 'link-only', publisher: source.publisher, accessedAt: timestamp, ...(source.publishedAt ? { issuedAt: `${source.publishedAt}T00:00:00Z` } : {}) } });
  }
  const rows = [];
  for (const card of cards) {
    const id = `${prefix}${card.key}`, revisionId = `${id}-v1`;
    const scope = { campus: card.campuses, audience: card.audiences, academic_year: ['universal'] };
    const reviewDueAt = new Date(Date.parse(timestamp) + card.reviewAfterDays * 86400000).toISOString();
    const sentences = card.sentences.map((sentence, index) => ({ id: `s${index + 1}`, kind: sentence.kind, text: sentence.text }));
    // Cautions are editorial advice, preserved in the platform card as well as the readable handbook.
    sentences.push(...card.cautions.map((text, index) => ({ id: `c${index + 1}`, kind: 'advice', text: `注意：${text}` })));
    bundle.entities.push({ id, type: 'answer', externalId: id, extensions: { slug: id, topicId: topicIds[card.topic] ?? `topic-${card.topic}`, riskLevel: 'low' } });
    bundle.revisions.push({ id: revisionId, entityId: id, number: 1, parentRevisionId: null, createdAt: timestamp, data: {
      title: card.title, summary: card.summary, sentences, scope,
      scopeIds: catalog.scopes.filter(item => scope[item.dimension]?.includes(item.code)).map(item => item.id),
      scopeMode: Object.values(scope).every(values => values.includes('universal')) ? 'universal' : 'constrained',
      impact: 'low', origin: 'ai_draft', locale: 'zh-CN', demo: false,
      asOf: date, verifiedAt: '', researchedAt: date, reviewDueAt,
      reviewOwnerLabel: '待指派人工编辑', evidenceCoverage: 'linked_only', disputeStatus: 'none',
      evidenceNote: `初版资料整理；${date}读取公开来源，尚未人工审核。事实句附原站链接，行动建议单列；未保存原文快照。`,
      searchText: [card.title, card.summary, ...card.keywords, ...sentences.map(sentence => sentence.text)].join(' ').normalize('NFKC').toLowerCase(),
      handbookBatch: `initial-${date}`, reviewStatus: 'pending-human-review',
    } });
    card.sentences.forEach((sentence, index) => {
      const refs = [...new Set(sentence.sourceKeys.map(key => byKey.get(`${card.section}:${key}`).id))];
      refs.forEach((sourceEntityId, order) => bundle.citations.push({ id: `${id}-s${index + 1}-${order}`, revisionId, sentenceId: `s${index + 1}`, sourceEntityId, sourceRevisionId: `${sourceEntityId}-v1`, position: { kind: 'link' }, order }));
    });
    rows.push({ ...card, id, revisionId, reviewDueAt });
  }
  const combined = { schemaVersion: 1 };
  for (const collection of ['entities', 'revisions', 'citations', 'links']) combined[collection] = [...original[collection].filter(record => !record.id.startsWith(prefix)), ...bundle[collection]];
  importContent(contentModule.initialState({ profile }), combined);
  const ordered = Object.keys(titles).filter(topic => usedTopics.has(topic));
  const factCount = cards.reduce((total, card) => total + card.sentences.filter(sentence => sentence.kind === 'fact').length, 0);
  const lines = ['# 西浦非官方手册 · 初版', '', `资料整理日期：${date}。本版共 ${cards.length} 篇，覆盖 ${ordered.length} 个主题，参考 ${sources.size} 个公开来源。`, '',
    '本手册面向西交利物浦大学学生，覆盖入学、在校学习、校园生活与发展机会。请先看每篇的校区和人群；“通用入口”表示可从这里查询，不代表所有服务向所有人开放。', '',
    '这是根据公开网页整理的 AI 初稿，尚未经过人工逐条审核。标为“来源事实”的内容附原站链接；“行动建议”是本手册的整理建议。资料读取日期不等于学校政策发布日期，也不代表已经办理验证。费用、资格、截止日期、课务与健康等事项，请回到对应官方通知核对。', '',
    '快速使用：刚到校先看“到校准备—账号与系统—住宿与报修”；遇到具体问题查“校园办事—身心健康与求助”；准备学习与申请则看“学习与教务—图书馆—海外交流—实习就业与升学”。', '',
    '## 目录', '', ...ordered.map(topic => `- [${titles[topic][0]}](#section-${topic})（${cards.filter(card => card.topic === topic).length} 篇）`), '',
    '来源的发布日期、读取状态与定位说明见文末 [来源索引](#sources)。后续需补材料见 [内容缺口与维护说明](handbook-maintenance.md)。', ''];
  for (const topic of ordered) {
    lines.push(`<a id="section-${topic}"></a>`, '', `## ${titles[topic][0]}`, '');
    for (const card of rows.filter(row => row.topic === topic)) {
      lines.push(`<a id="${card.id}"></a>`, '', `### ${card.title}`, '', card.summary, '',
        `校区：${card.campuses.map(value => value === 'universal' ? '两校区通用入口' : labels[value]).join('、')}；人群：${card.audiences.map(value => value === 'universal' ? '学生通用入口' : labels[value]).join('、')}。资料整理：${date}；建议复核：${card.reviewDueAt.slice(0, 10)}。`,
        `材料来源：${sourceCategories(card.sentences.flatMap(sentence => sentence.sourceKeys.map(key => byKey.get(`${card.section}:${key}`)))).map(category => SOURCE_CATEGORY_LABELS[category]).join('、')}。来源类别不代表本手册已经完成核验。`, '');
      for (const sentence of card.sentences) {
        const refs = [...new Map(sentence.sourceKeys.map(key => { const source = byKey.get(`${card.section}:${key}`); return [source.id, source]; })).values()];
        lines.push(`- **${sentence.kind === 'fact' ? '来源事实' : '行动建议'}**：${sentence.text}${refs.length ? ` ${refs.map(link).join('；')}` : ''}`);
      }
      if (card.cautions.length) lines.push('', ...card.cautions.map(caution => `> 注意：${caution}`));
      lines.push('');
    }
  }
  lines.push('<a id="sources"></a>', '', '## 来源索引', '', '以下仅保留链接和整理者的定位说明；未保存网页全文。页面未注明发布日期时明确记为“未注明”。检索摘要线索不作为事实句的证据。', '');
  for (const source of sources.values()) {
    lines.push(`### ${source.title}`, '', `${link(source)} · 来源类别：${SOURCE_CATEGORY_LABELS[source.sourceCategory]} · 发布方：${source.publisher} · 页面日期：${source.publishedAt ?? '未注明'} · 读取日期：${source.accessedAt}`, '',
      ...source.observations.map(observation => `- ${observation.verification === 'opened' ? '已读取正文' : '仅检索线索'}：${observation.note}`), '');
  }
  return { combined, bundle, catalog, markdown: lines.join('\n') + '\n', report: {
    researchedAt: date, status: 'pending-human-review', cardCount: cards.length, topicCount: ordered.length,
    sourceCount: sources.size, citedSourceCount: usedSources.size, factCount,
    sourceCategories: Object.fromEntries(Object.keys(SOURCE_CATEGORY_LABELS).map(category => [category, [...sources.values()].filter(source => source.sourceCategory === category).length])),
    citationCount: bundle.citations.length, humanVerifiedCount: 0,
    topics: ordered.map(topic => ({ topic, title: titles[topic][0], count: cards.filter(card => card.topic === topic).length })),
    cards: rows.map(card => ({ id: card.id, revisionId: card.revisionId, title: card.title, topic: card.topic, reviewDueAt: card.reviewDueAt })),
  } };
}

export async function buildHandbook({ check = false } = {}) {
  const result = await compileHandbook();
  const files = {
    'community/content.json': JSON.stringify(result.combined, null, 2) + '\n',
    'community/catalog.json': JSON.stringify(result.catalog, null, 2) + '\n',
    'community/handbook/runtime-import.json': JSON.stringify(result.bundle, null, 2) + '\n',
    'community/handbook/coverage.json': JSON.stringify(result.report, null, 2) + '\n',
    'docs/handbook.md': result.markdown,
  };
  for (const [path, text] of Object.entries(files)) {
    if (check) {
      if (await readFile(resolve(root, path), 'utf8') !== text) fail(`${path} is stale; run npm run handbook:build`);
    } else await writeFile(resolve(root, path), text);
  }
  return result.report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildHandbook({ check: process.argv.includes('--check') });
  console.log(`Handbook: ${result.cardCount} cards, ${result.topicCount} topics, ${result.sourceCount} sources, ${result.factCount} cited facts; pending human review.`);
}
