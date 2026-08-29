import type {
  DisputeStatus,
  EvidenceCoverage,
  RevisionStatus,
  ScopeMode,
} from './domain';

export type Scope = {
  id: string;
  dimension: string;
  code: string;
  labelZh: string;
  labelEn: string | null;
};

export type TopicSummary = {
  id: string;
  slug: string;
  titleZh: string;
  titleEn: string | null;
  description: string;
  cardCount: number;
};

export type AnswerCardSummary = {
  id: string;
  slug: string;
  topicSlug: string;
  topicTitle: string;
  title: string;
  summary: string;
  revisionId: string;
  versionNumber: number;
  lockVersion: number;
  scopeMode: ScopeMode;
  scopes: Scope[];
  asOf: string;
  verifiedAt: number;
  reviewDueAt: number;
  reviewOwnerLabel: string;
  evidenceCoverage: EvidenceCoverage;
  disputeStatus: DisputeStatus;
  evidenceNote: string | null;
  riskLevel: 'low' | 'high';
  status: RevisionStatus;
  searchScore: number;
};

export type CitationDetail = {
  id: string;
  ordinal: number;
  kind: 'evidence' | 'link';
  title: string;
  url: string;
  publisher: string;
  publishedAt: number | null;
  capturedAt: number;
  accessedAt: number | null;
  locatorKind: string | null;
  locatorValue: string | null;
  quote: string | null;
  isArchived: boolean;
};

export type AnswerSentence = {
  key: string;
  ordinal: number;
  text: string;
  isFactual: boolean;
  citations: CitationDetail[];
};

export type RevisionHistoryItem = {
  id: string;
  versionNumber: number;
  title: string;
  summary: string;
  asOf: string;
  publishedAt: number;
  isCurrent: boolean;
};

export type AnswerCardDetail = AnswerCardSummary & {
  sentences: AnswerSentence[];
  history: RevisionHistoryItem[];
  feedback: { resolved: number; unclear: number };
};

export type CitationDraftInput = {
  kind: 'link' | 'evidence';
  sourceTitle: string;
  sourceUrl: string;
  publisherName: string;
  publishedAt?: string | null;
  quote?: string | null;
  locator?: string | null;
  rightsConfirmed?: boolean;
};

export type SentenceDraftInput = {
  text: string;
  citation: CitationDraftInput;
};

export type RevisionDraftInput = {
  title: string;
  summary: string;
  scopeMode: ScopeMode;
  scopeIds: string[];
  asOf: string;
  reviewDueOn: string;
  reviewOwnerLabel: string;
  disputeStatus: DisputeStatus;
  evidenceNote?: string | null;
  generationType?: 'human' | 'ai_draft';
  sentences: SentenceDraftInput[];
};

export type NewCardInput = RevisionDraftInput & {
  slug: string;
  topicId: string;
  riskLevel: 'low' | 'high';
};

export type EditorCardListItem = {
  id: string;
  slug: string;
  topicTitle: string;
  publicationStatus: string;
  riskLevel: string;
  lockVersion: number;
  currentRevisionId: string | null;
  currentTitle: string | null;
  currentReviewDueAt: number | null;
  latestRevisionId: string | null;
  latestVersionNumber: number | null;
  latestTitle: string | null;
  hasUnpublishedDraft: boolean;
  isOverdue: boolean;
};

export type EditorDashboard = {
  cards: EditorCardListItem[];
  reports: Array<{
    publicCode: string;
    type: string;
    status: string;
    lockVersion: number;
    cardTitle: string | null;
    createdAt: number;
  }>;
  intakes: Array<{
    id: string;
    kind: string;
    contextScope: string;
    body: string | null;
    sourceUrl: string | null;
    provenanceRole: string | null;
    status: string;
    lockVersion: number;
    submittedAt: number;
    expiresAt: number;
  }>;
  auditEvents: Array<{
    id: string;
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    reason: string;
    createdAt: number;
  }>;
};
