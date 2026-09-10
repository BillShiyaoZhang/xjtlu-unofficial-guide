// Read public GitHub contributions only. Raw Markdown is data: render it with
// textContent, never innerHTML. Neither issue closure nor a citation is approval.
// API references: https://docs.github.com/en/rest/issues/issues#list-repository-issues
// https://docs.github.com/en/rest/issues/comments#list-issue-comments
export const discussionDisclosure = '原始公开投稿与回复，未经本站核验；关闭 Issue 不代表采纳。';
export const discussionRequestTimeout = 12000;
const PER_PAGE = 100;
const TOPIC_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const repositoryPattern = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9._-]{1,100}$/u;
const quickIdentifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);

/** Present the exact outer envelope produced by buildQuickContributionDraft.
 * The entire middle is kept intact, including optional background, user headings,
 * quoted template examples and routing-marker examples. This is formatting only:
 * metadata is not proof of authorship, topic membership or editorial acceptance.
 * context is plain text, not HTML; raw always preserves the complete input string.
 */
export function discussionPresentation(body) {
  const raw = typeof body === 'string' ? body : '';
  const fallback = { text: raw, context: '', raw, formatted: false };
  const separator = raw.match(/\r?\n\r?\n/u);
  if (!separator) return fallback;
  const lines = raw.slice(0, separator.index).split(/\r?\n/u);
  const marker = lines[0]?.match(/^<!-- xjtlu-topic:([A-Za-z0-9][A-Za-z0-9._:-]{0,127}) -->$/u);
  const title = lines[1]?.match(/^共建话题：(.+)$/u)?.[1];
  if (!marker || !title?.trim()) return fallback;
  let cursor = 2;
  const idField = prefix => {
    const value = lines[cursor]?.startsWith(prefix) ? lines[cursor].slice(prefix.length) : null;
    if (!quickIdentifier(value)) return null;
    cursor++;
    return value;
  };
  idField('知识分类 ID：');
  const context = [`话题：${title}`];
  const articleTitle = lines[cursor]?.match(/^关联文章：(.+)$/u)?.[1];
  if (articleTitle) {
    cursor++;
    const articleId = idField('文章 ID：');
    if (!articleId) return fallback;
    let revisionNumber;
    if (lines[cursor]?.startsWith('阅读版本：')) {
      const revision = lines[cursor].match(/^阅读版本：([A-Za-z0-9][A-Za-z0-9._:-]{0,127})(?:（第 ([1-9]\d*) 版）)?$/u);
      if (!revision || (revision[2] && !positiveInteger(Number(revision[2])))) return fallback;
      revisionNumber = revision[2];
      cursor++;
    }
    if (lines[cursor]?.startsWith('https://')) {
      try {
        const url = new URL(lines[cursor]);
        if (url.protocol !== 'https:' || url.username || url.password || url.hash !== '#/answers/' + encodeURIComponent(articleId)) return fallback;
      } catch { return fallback; }
      cursor++;
    }
    context.push(`${articleTitle === articleId ? '关联了一篇资料' : `关联资料：${articleTitle}`}${revisionNumber ? `（第 ${revisionNumber} 版）` : ''}`);
  }
  let reply = false;
  if (lines[cursor]?.startsWith('回复原讨论：')) {
    const value = lines[cursor].slice('回复原讨论：'.length);
    if (!citationKey(value)) return fallback;
    const url = new URL(value), number = url.pathname.split('/').at(-1);
    context.push(`回复 GitHub 讨论 #${number}${url.hash ? ' 中的一条回复' : ''}`);
    cursor++;
    idField('回复对象 ID：');
    reply = true;
  }
  // Unknown or malformed metadata is never silently removed from the display.
  if (cursor !== lines.length) return fallback;
  const contentOffset = separator.index + separator[0].length;
  const section = raw.slice(contentOffset).match(/^### (我的分享|我的回复)\r?\n\r?\n/u);
  if (!section || (section[1] === '我的回复') !== reply) return fallback;
  const footer = raw.match(/\r?\n\r?\n### 公开提交确认\r?\n\r?\n我知道在 GitHub 确认提交后，我的 GitHub 用户名和这段正文会公开。$/u);
  const start = contentOffset + section[0].length;
  if (!footer || footer.index <= start) return fallback;
  const text = raw.slice(start, footer.index);
  if (!text.trim()) return fallback;
  return { text, context: context.join('\n'), raw, formatted: true };
}

export class DiscussionLoadError extends Error {
  constructor(code, message, { status = null, retryAt = null } = {}) {
    super(message);
    this.name = 'DiscussionLoadError';
    this.code = code;
    this.status = status;
    this.retryAt = retryAt;
  }
}

function validRepository(repository) {
  return typeof repository === 'string' && repositoryPattern.test(repository)
    && !['.', '..'].includes(repository.split('/')[1]);
}

function validateRequest({ repository, page, timeoutMs }) {
  if (!validRepository(repository)) throw new DiscussionLoadError('INVALID_REPOSITORY', '公开讨论仓库未正确配置。');
  if (!positiveInteger(page)) throw new DiscussionLoadError('INVALID_PAGE', '讨论页码必须是正整数。');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000) {
    throw new DiscussionLoadError('INVALID_TIMEOUT', '讨论读取超时设置无效。');
  }
}

/** Accept only an exact issue or comment permalink in the configured repository. */
export function discussionPermalink(value, { repository, number, commentId } = {}) {
  if (!validRepository(repository) || !positiveInteger(number)
    || (commentId !== undefined && !positiveInteger(commentId)) || typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.origin !== 'https://github.com' || url.username || url.password || url.search
      || url.pathname.toLowerCase() !== `/${repository}/issues/${number}`.toLowerCase()
      || url.hash !== (commentId === undefined ? '' : `#issuecomment-${commentId}`)) return null;
    return url.href;
  } catch { return null; }
}

// Ignore quoted examples and fenced code. Metadata must occupy a top-level line;
// arbitrary mentions, titles, URLs and prose do not assign a contribution a topic.
function metadataLines(body) {
  const result = [];
  let fence = null, rawTag = null, htmlComment = false;
  for (const line of body.split(/\r?\n/u)) {
    if (rawTag) {
      if (new RegExp(`</${rawTag}\\s*>`, 'iu').test(line)) rawTag = null;
      result.push(null); continue;
    }
    if (htmlComment) {
      if (line.includes('-->')) htmlComment = false;
      result.push(null); continue;
    }
    const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
    if (fence) {
      if (match && match[1][0] === fence.character && match[1].length >= fence.length && !match[2].trim()) fence = null;
      result.push(null);
    } else if (match) {
      fence = { character: match[1][0], length: match[1].length };
      result.push(null);
    } else {
      const raw = line.match(/^ {0,3}<(pre|code|script|style|textarea)(?:\s|>)/iu);
      if (raw) {
        if (!new RegExp(`</${raw[1]}\\s*>`, 'iu').test(line)) rawTag = raw[1];
        result.push(null);
      } else if (/^ {0,3}<!--/u.test(line) && !/^ {0,3}<!--\s*xjtlu-topic:/u.test(line)) {
        htmlComment = !line.includes('-->');
        result.push(null);
      } else result.push(line);
    }
  }
  return result;
}

/** Match an explicit marker, or the exact article field of an older site draft. */
export function discussionMatchesTopic(body, { topicId, catalogTopicId = topicId, answers = [] } = {}) {
  if (typeof body !== 'string' || !TOPIC_ID.test(topicId ?? '') || !TOPIC_ID.test(catalogTopicId ?? '')) return false;
  const markers = new Set(), articleIds = new Set();
  let articleSection = false, articleSections = 0, malformedMarker = false;
  for (const line of metadataLines(body)) {
    if (line === null) continue;
    const marker = line.match(/^ {0,3}<!-- xjtlu-topic:([A-Za-z0-9][A-Za-z0-9._:-]{0,199}) -->\s*$/u);
    if (marker) markers.add(marker[1]);
    else if (/^ {0,3}<!--\s*xjtlu-topic:/u.test(line)) malformedMarker = true;
    const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*$/u);
    if (heading) {
      articleSection = heading[1] === '###' && heading[2] === '关联文章';
      if (articleSection) articleSections++;
    } else if (articleSection) {
      const article = line.match(/^ {0,3}文章 ID：[ \t]*([^\s]+)[ \t]*$/u);
      if (article) articleIds.add(article[1]);
    }
  }
  if (malformedMarker || markers.size > 1 || articleSections > 1 || articleIds.size > 1) return false;
  if (markers.size && !markers.has(topicId)) return false;
  if (articleIds.size) {
    const [articleId] = articleIds;
    const matched = answers.filter(answer => answer?.id === articleId);
    if (!matched.length || matched.some(answer => answer.topic?.id !== catalogTopicId)) return false;
  }
  return markers.has(topicId) || articleIds.size === 1;
}

function authorName(user) {
  return typeof user?.login === 'string' && user.login ? user.login : '已删除用户';
}
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;

export function parseDiscussionIssue(issue, { repository, topicId, catalogTopicId = topicId, answers = [] } = {}) {
  if (!issue || Object.hasOwn(issue, 'pull_request') || !positiveInteger(issue.number)
    || typeof issue.title !== 'string' || (issue.body !== null && typeof issue.body !== 'string')
    || !['open', 'closed'].includes(issue.state)) return null;
  const url = discussionPermalink(issue.html_url, { repository, number: issue.number });
  if (!url || !discussionMatchesTopic(issue.body ?? '', { topicId, catalogTopicId, answers })) return null;
  return {
    id: `issue-${issue.number}`, number: issue.number, title: issue.title, body: issue.body ?? '',
    author: authorName(issue.user), createdAt: timestamp(issue.created_at), updatedAt: timestamp(issue.updated_at),
    url, commentCount: Number.isSafeInteger(issue.comments) && issue.comments >= 0 ? issue.comments : 0,
    state: issue.state, topicId,
  };
}

export function parseDiscussionReply(comment, { repository, number } = {}) {
  if (!comment || !positiveInteger(comment.id) || (comment.body !== null && typeof comment.body !== 'string')) return null;
  const url = discussionPermalink(comment.html_url, { repository, number, commentId: comment.id });
  if (!url) return null;
  return {
    id: `comment-${comment.id}`, body: comment.body ?? '', author: authorName(comment.user),
    createdAt: timestamp(comment.created_at), updatedAt: timestamp(comment.updated_at), url,
  };
}

/** Read next-page metadata; never follow an address from GitHub or a post body. */
export function parseDiscussionPagination({ link, page = 1, itemCount = 0 } = {}) {
  if (!positiveInteger(page)) throw new DiscussionLoadError('INVALID_PAGE', '讨论页码必须是正整数。');
  if (link) {
    const links = String(link).split(',').map(part => part.match(/^\s*<([^>]+)>\s*;\s*rel\s*=\s*(?:"([^"]+)"|([^;\s]+))(?:\s*;[^,]*)?\s*$/u));
    if (links.some(part => !part)) throw new DiscussionLoadError('INVALID_RESPONSE', 'GitHub 返回的讨论分页信息无效，请重试。');
    const nextLinks = links.filter(part => (part[2] || part[3]).split(/\s+/u).includes('next'));
    if (!nextLinks.length) return { hasMore: false, nextPage: null };
    if (nextLinks.length !== 1) throw new DiscussionLoadError('INVALID_RESPONSE', 'GitHub 返回的讨论分页信息无效，请重试。');
    try {
      const url = new URL(nextLinks[0][1]);
      const next = Number(url.searchParams.get('page'));
      if (url.origin !== 'https://api.github.com' || url.username || url.password || url.hash
        || !positiveInteger(next) || next !== page + 1 || url.searchParams.getAll('page').length !== 1) throw new Error();
      return { hasMore: true, nextPage: next };
    } catch { throw new DiscussionLoadError('INVALID_RESPONSE', 'GitHub 返回的讨论分页信息无效，请重试。'); }
  }
  // A full page without an exposed Link header is inconclusive. Offer another
  // page, including when all 100 records were PRs or belonged to other topics.
  return { hasMore: itemCount >= PER_PAGE, nextPage: itemCount >= PER_PAGE ? page + 1 : null };
}

function citationKey(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value), match = url.pathname.match(/^\/([^/]+\/[^/]+)\/issues\/([1-9]\d*)$/u);
    const comment = url.hash ? url.hash.match(/^#issuecomment-([1-9]\d*)$/u) : null;
    if (!match || (url.hash && !comment)) return null;
    if (!discussionPermalink(value, { repository: match[1], number: Number(match[2]), ...(comment ? { commentId: Number(comment[1]) } : {}) })) return null;
    return `${url.origin}${url.pathname.toLowerCase()}${url.hash}`;
  } catch { return null; }
}

/** A precise provenance link, not evidence that a post was approved or verified. */
export function summariesForDiscussion(answers = [], postOrReply) {
  const key = citationKey(postOrReply?.url);
  if (!key) return [];
  return answers.filter(answer => Array.isArray(answer?.citations)
    && answer.citations.some(citation => citationKey(citation?.url) === key));
}

function responseError(response, data) {
  const status = response.status, header = name => response.headers?.get?.(name);
  const retryAfter = header('retry-after'), remaining = header('x-ratelimit-remaining');
  const limited = status === 429 || (status === 403 && (remaining === '0' || retryAfter
    || /rate.?limit|secondary rate/iu.test(typeof data?.message === 'string' ? data.message : '')));
  if (limited) {
    let retryAt = null;
    if (retryAfter && /^\d+$/u.test(retryAfter)) {
      const retry = new Date(Date.now() + Number(retryAfter) * 1000);
      if (Number.isFinite(retry.getTime())) retryAt = retry.toISOString();
    }
    else if (retryAfter && Number.isFinite(Date.parse(retryAfter))) retryAt = new Date(retryAfter).toISOString();
    else if (remaining === '0' && /^\d+$/u.test(header('x-ratelimit-reset') ?? '')) {
      const reset = Number(header('x-ratelimit-reset')) * 1000;
      if (Number.isFinite(new Date(reset).getTime())) retryAt = new Date(reset).toISOString();
    }
    return new DiscussionLoadError('RATE_LIMITED', 'GitHub 暂时限制了公开讨论读取次数，请稍后再试；这不表示没有投稿。', { status, retryAt });
  }
  const errors = {
    401: ['FORBIDDEN', 'GitHub 暂不允许匿名读取这些公开讨论。'],
    403: ['FORBIDDEN', 'GitHub 拒绝读取这些公开讨论，请到原站查看。'],
    404: ['NOT_FOUND', '未找到公开讨论仓库或这条投稿，可能已删除或不再公开。'],
    410: ['UNAVAILABLE', '这些 GitHub 公开讨论已不可用，可能已关闭投稿功能。'],
    422: ['INVALID_REQUEST', 'GitHub 无法处理这次讨论读取，请稍后重试。'],
  };
  const [code, message] = errors[status] ?? (status >= 500
    ? ['UNAVAILABLE', 'GitHub 公开讨论服务暂时不可用，请稍后重试。']
    : ['HTTP_ERROR', `读取 GitHub 公开讨论失败（HTTP ${status}），请重试。`]);
  return new DiscussionLoadError(code, message, { status });
}

async function requestPage(url, { signal, timeoutMs, fetchImpl, single = false }) {
  if (signal?.aborted) throw new DiscussionLoadError('ABORTED', '已取消读取公开讨论。');
  const controller = new AbortController();
  let timedOut = false;
  const abortRequest = () => controller.abort();
  const aborted = new Promise((_, reject) => controller.signal.addEventListener('abort', () => {
    reject(new DiscussionLoadError(timedOut ? 'TIMEOUT' : 'ABORTED', timedOut
      ? '读取 GitHub 公开讨论超时，请重试或到原站查看。' : '已取消读取公开讨论。'));
  }, { once: true }));
  signal?.addEventListener('abort', abortRequest, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    return await Promise.race([aborted, (async () => {
      const response = await fetchImpl(url.href, {
        method: 'GET', credentials: 'omit', cache: 'no-store', mode: 'cors',
        referrerPolicy: 'no-referrer', redirect: 'manual', signal: controller.signal,
        headers: { Accept: 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2026-03-10' },
      });
      if (response.type === 'opaqueredirect' || response.redirected || (response.status >= 300 && response.status < 400)) {
        throw new DiscussionLoadError('REPOSITORY_MOVED', 'GitHub 讨论地址发生跳转，请维护者核对公开仓库配置。', { status: response.status });
      }
      if (response.url) {
        const actual = new URL(response.url);
        if (actual.origin !== url.origin || actual.pathname.toLowerCase() !== url.pathname.toLowerCase()) {
          throw new DiscussionLoadError('INVALID_RESPONSE', 'GitHub 返回的讨论地址与配置仓库不符。');
        }
      }
      let data;
      try { data = await response.json(); }
      catch {
        if (!response.ok) throw responseError(response, null);
        throw new DiscussionLoadError('INVALID_RESPONSE', 'GitHub 返回的讨论内容无法读取，请重试。');
      }
      if (!response.ok) throw responseError(response, data);
      if (single ? !data || typeof data !== 'object' || Array.isArray(data) : !Array.isArray(data)) {
        throw new DiscussionLoadError('INVALID_RESPONSE', single ? 'GitHub 返回的投稿格式无效，请重试。' : 'GitHub 返回的讨论列表格式无效，请重试。');
      }
      return { data, link: response.headers?.get?.('link'), fetchedAt: new Date().toISOString() };
    })()]);
  } catch (error) {
    if (error instanceof DiscussionLoadError) throw error;
    if (controller.signal.aborted) throw new DiscussionLoadError(timedOut ? 'TIMEOUT' : 'ABORTED', timedOut
      ? '读取 GitHub 公开讨论超时，请重试或到原站查看。' : '已取消读取公开讨论。');
    throw new DiscussionLoadError('NETWORK', '无法连接 GitHub 公开讨论，请检查网络后重试或到原站查看。');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortRequest);
  }
}

/** One repository page, filtered locally. An empty posts array may have more pages.
 * No cache is retained: refresh/reload always performs a new credential-free GET.
 */
export async function loadTopicDiscussions({ repository, topicId, catalogTopicId = topicId, answers = [], signal, page = 1, fetchImpl = fetch, timeoutMs = discussionRequestTimeout } = {}) {
  validateRequest({ repository, page, timeoutMs });
  if (!TOPIC_ID.test(topicId ?? '') || !TOPIC_ID.test(catalogTopicId ?? '')) throw new DiscussionLoadError('INVALID_TOPIC', '讨论话题未正确配置。');
  const url = new URL(`https://api.github.com/repos/${repository}/issues`);
  url.search = new URLSearchParams({ state: 'all', sort: 'updated', direction: 'desc', per_page: String(PER_PAGE), page: String(page) });
  const result = await requestPage(url, { signal, timeoutMs, fetchImpl });
  const seen = new Set();
  const posts = result.data.map(issue => parseDiscussionIssue(issue, { repository, topicId, catalogTopicId, answers }))
    .filter(post => post && !seen.has(post.id) && seen.add(post.id));
  return { posts, ...parseDiscussionPagination({ link: result.link, page, itemCount: result.data.length }), fetchedAt: result.fetchedAt };
}

/** Resolve a deep link with one GET, returning the same post shape as posts[i].
 * PRs, invalid permalinks and contributions outside this topic are not exposed.
 */
export async function loadTopicDiscussion({ repository, number, topicId, catalogTopicId = topicId, answers = [], signal, fetchImpl = fetch, timeoutMs = discussionRequestTimeout } = {}) {
  validateRequest({ repository, page: 1, timeoutMs });
  if (!positiveInteger(number)) throw new DiscussionLoadError('INVALID_ISSUE', '公开投稿编号无效。');
  if (!TOPIC_ID.test(topicId ?? '') || !TOPIC_ID.test(catalogTopicId ?? '')) throw new DiscussionLoadError('INVALID_TOPIC', '讨论话题未正确配置。');
  const url = new URL(`https://api.github.com/repos/${repository}/issues/${number}`);
  const result = await requestPage(url, { signal, timeoutMs, fetchImpl, single: true });
  const post = result.data.number === number
    ? parseDiscussionIssue(result.data, { repository, topicId, catalogTopicId, answers }) : null;
  if (!post) throw new DiscussionLoadError('NOT_FOUND', '这条公开投稿不属于当前话题，或已不再公开。', { status: 404 });
  return post;
}

/** One repository request for the homepage. Exact markers select their own topic;
 * marker-free legacy article drafts use the first matching configured topic.
 * The result is recent activity, not a per-topic count or an adoption decision.
 */
export async function loadCommunityActivity({ repository, topics = [], answers = [], signal, page = 1, fetchImpl = fetch, timeoutMs = discussionRequestTimeout } = {}) {
  validateRequest({ repository, page, timeoutMs });
  if (!Array.isArray(topics) || topics.some(topic => !TOPIC_ID.test(topic?.id ?? '') || !TOPIC_ID.test(topic.catalogTopicId ?? topic.id ?? ''))) {
    throw new DiscussionLoadError('INVALID_TOPIC', '讨论话题未正确配置。');
  }
  const url = new URL(`https://api.github.com/repos/${repository}/issues`);
  url.search = new URLSearchParams({ state: 'all', sort: 'updated', direction: 'desc', per_page: String(PER_PAGE), page: String(page) });
  const result = await requestPage(url, { signal, timeoutMs, fetchImpl });
  const seen = new Set(), posts = [];
  for (const issue of result.data) {
    if (seen.has(issue?.number)) continue;
    for (const topic of topics) {
      const post = parseDiscussionIssue(issue, { repository, topicId: topic.id, catalogTopicId: topic.catalogTopicId ?? topic.id, answers });
      if (!post) continue;
      posts.push(post);
      seen.add(post.number);
      break;
    }
  }
  return { posts, ...parseDiscussionPagination({ link: result.link, page, itemCount: result.data.length }), fetchedAt: result.fetchedAt };
}

/** Replies keep their exact comment URLs, in GitHub's ascending-ID order. */
export async function loadDiscussionReplies({ repository, number, signal, page = 1, fetchImpl = fetch, timeoutMs = discussionRequestTimeout } = {}) {
  validateRequest({ repository, page, timeoutMs });
  if (!positiveInteger(number)) throw new DiscussionLoadError('INVALID_ISSUE', '公开投稿编号无效。');
  const url = new URL(`https://api.github.com/repos/${repository}/issues/${number}/comments`);
  url.search = new URLSearchParams({ per_page: String(PER_PAGE), page: String(page) });
  const result = await requestPage(url, { signal, timeoutMs, fetchImpl });
  const seen = new Set();
  const replies = result.data.map(comment => parseDiscussionReply(comment, { repository, number }))
    .filter(reply => reply && !seen.has(reply.id) && seen.add(reply.id));
  return { replies, ...parseDiscussionPagination({ link: result.link, page, itemCount: result.data.length }), fetchedAt: result.fetchedAt };
}
