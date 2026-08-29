export const SCOPE_MODES = ['universal', 'constrained', 'unknown'] as const;
export const DISPUTE_STATUSES = ['none', 'reported', 'confirmed'] as const;
export const REPORT_TYPES = [
  'stale',
  'scope_error',
  'source_mismatch',
  'privacy',
] as const;
export const FEEDBACK_OUTCOMES = ['resolved', 'unclear'] as const;
export const REPORT_AFFECTED_AREAS = [
  'home',
  'search',
  'topics',
  'pilot',
  'intake',
  'reporting',
  'other',
] as const;

export type ScopeMode = (typeof SCOPE_MODES)[number];
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];
export type ReportType = (typeof REPORT_TYPES)[number];
export type ReportAffectedArea = (typeof REPORT_AFFECTED_AREAS)[number];
export type FeedbackOutcome = (typeof FEEDBACK_OUTCOMES)[number];
export type EvidenceCoverage =
  | 'linked_only'
  | 'partial_archived'
  | 'fully_archived';

export type SearchCandidate = {
  id: string;
  title: string;
  summary: string;
  searchText: string;
  topicTitle: string;
  topicAliases?: string;
};

export type RevisionStatus = {
  isOverdue: boolean;
  isDisputed: boolean;
  tone: 'current' | 'warning' | 'danger';
  label: string;
};

const aliasExpansions: Record<string, string[]> = {
  ebridge: ['e-bridge', '教务系统', '学生系统'],
  'e-bridge': ['ebridge', '教务系统', '学生系统'],
  lm: ['learning mall', '教学平台'],
  'learning mall': ['lm', '教学平台'],
  kb: ['knowledge base', '知识库'],
  新生: ['new student', '到校', '入学'],
  办事: ['学生服务', 'service'],
};

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function searchTokens(query: string): string[] {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];

  const values = new Set<string>([normalized]);
  for (const token of normalized.split(' ')) {
    if (token) values.add(token);
    for (const expanded of aliasExpansions[token] ?? []) {
      values.add(normalizeSearchText(expanded));
    }
    if (/^[\u3400-\u9fff]{3,}$/u.test(token)) {
      for (let index = 0; index < token.length - 1; index += 1) {
        values.add(token.slice(index, index + 2));
      }
    }
  }
  return [...values].filter(Boolean).slice(0, 24);
}

export function rankSearchCandidate(
  candidate: SearchCandidate,
  query: string,
): number {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return 1;

  const title = normalizeSearchText(candidate.title);
  const summary = normalizeSearchText(candidate.summary);
  const searchable = normalizeSearchText(
    `${candidate.searchText} ${candidate.topicTitle} ${candidate.topicAliases ?? ''}`,
  );
  const tokens = searchTokens(query);
  let score = 0;

  if (title === normalizedQuery) score += 160;
  if (title.includes(normalizedQuery)) score += 90;
  if (summary.includes(normalizedQuery)) score += 55;
  if (searchable.includes(normalizedQuery)) score += 40;

  for (const token of tokens) {
    if (token.length === 1) continue;
    if (title.includes(token)) score += token === normalizedQuery ? 24 : 10;
    else if (summary.includes(token)) score += 6;
    else if (searchable.includes(token)) score += 3;
  }

  return score;
}

export function deriveRevisionStatus(
  reviewDueAtSeconds: number,
  disputeStatus: DisputeStatus,
  nowSeconds = Math.floor(Date.now() / 1000),
): RevisionStatus {
  const isOverdue = reviewDueAtSeconds <= nowSeconds;
  const isDisputed = disputeStatus !== 'none';

  if (isDisputed) {
    return {
      isOverdue,
      isDisputed,
      tone: 'danger',
      label: '存在待处理问题，请核对说明与来源',
    };
  }
  if (isOverdue) {
    return {
      isOverdue,
      isDisputed,
      tone: 'warning',
      label: '待复核：已超过维护周期，请先核对原站',
    };
  }
  return {
    isOverdue,
    isDisputed,
    tone: 'current',
    label: '在复核周期内',
  };
}

export function computeEvidenceCoverage(
  kinds: Array<'link' | 'evidence'>,
): EvidenceCoverage {
  const hasLink = kinds.includes('link');
  const hasEvidence = kinds.includes('evidence');
  if (hasLink && hasEvidence) return 'partial_archived';
  if (hasEvidence) return 'fully_archived';
  return 'linked_only';
}

export function isSafePublicUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  if (url.username || url.password) return false;

  const host = url.hostname
    .toLocaleLowerCase()
    .replace(/^\[/u, '')
    .replace(/\]$/u, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    isNonPublicIpv4(host) ||
    isNonPublicIpv6(host)
  ) {
    return false;
  }
  return true;
}

function isNonPublicIpv4(host: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host)) return false;
  const octets = host.split('.').map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return true;
  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

function isNonPublicIpv6(host: string): boolean {
  if (!host.includes(':')) return false;
  if (host === '::' || host === '::1') return true;

  const firstHextet = Number.parseInt(host.split(':', 1)[0] || '0', 16);
  if (
    (firstHextet & 0xfe00) === 0xfc00 ||
    (firstHextet & 0xffc0) === 0xfe80 ||
    (firstHextet & 0xff00) === 0xff00
  ) {
    return true;
  }

  const mapped = host.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u);
  if (!mapped) return false;
  const high = Number.parseInt(mapped[1], 16);
  const low = Number.parseInt(mapped[2], 16);
  return isNonPublicIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
}

export function containsLikelyPersonalData(value: string): boolean {
  const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
  const phone = /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/u;
  const studentNumber = /(?<!\d)\d{8,12}(?!\d)/u;
  const identityNumber = /(?<!\d)\d{17}[\dXx](?!\d)/u;
  return (
    email.test(value) ||
    phone.test(value) ||
    studentNumber.test(value) ||
    identityNumber.test(value)
  );
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value)
  );
}

export function dateToEpochEndOfDay(value: string): number {
  return Math.floor(Date.parse(`${value}T23:59:59Z`) / 1000);
}

export function epochToIso(seconds: number | null): string | null {
  if (seconds === null) return null;
  return new Date(seconds * 1000).toISOString();
}

export function isOneOf<T extends readonly string[]>(
  value: unknown,
  allowed: T,
): value is T[number] {
  return typeof value === 'string' && allowed.includes(value as T[number]);
}

export async function sha256(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function cleanPlainText(value: string, maxLength: number): string {
  return [...value]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return (
        code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)
      );
    })
    .join('')
    .trim()
    .slice(0, maxLength);
}
