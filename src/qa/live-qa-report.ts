import type {
  AdapterHealthState,
  LiveQaArchiveStatus,
  RecorderState
} from '../shared/types';
import { GENERATION_CONTROL_SELECTORS } from '../providers/chatgpt/selectors';

export const LIVE_QA_REPORT_SCHEMA = 'llm-chat-history/live-qa-report';
export const LIVE_QA_REPORT_SCHEMA_VERSION = 1;

export type LiveQaRouteKind = 'home' | 'conversation' | 'other-chatgpt';
export type LiveQaStorageHealth = 'unknown' | 'healthy' | 'error';

export interface LiveQaRouteEvidence {
  kind: LiveQaRouteKind;
  pathSegmentCount: number;
  queryPresent: boolean;
  hashPresent: boolean;
  providerConversationIdPresent: boolean;
  provisional: boolean;
}

export interface LiveQaSelectorCounts {
  sectionUserTurns: number;
  sectionAssistantTurns: number;
  articleTurns: number;
  userRoleNodes: number;
  assistantRoleNodes: number;
  turnIdNodes: number;
  messageIdNodes: number;
  conversationTurnTestIds: number;
  collapsibleUserContent: number;
  markdownWrappers: number;
  proseWrappers: number;
  conversationLinks: number;
}

export interface LiveQaDomEvidence {
  selectors: LiveQaSelectorCounts;
  stopGenerationControlPresent: boolean;
  adapterScrollContainerFound: boolean;
  adapterUsesDocumentScrollingElement: boolean;
  mobileAppShellScrollContainerPresent: boolean;
  historyApiAvailable: boolean;
}

export interface LiveQaRuntimeEvidence {
  adapterState: AdapterHealthState;
  adapterCode: string;
  recordingState: RecorderState;
  storageHealth: LiveQaStorageHealth;
  renderedTurnCount: number;
  lastSaveConfirmed: boolean;
  historicalImportAvailable: boolean;
}

export interface LiveQaReport {
  schema: typeof LIVE_QA_REPORT_SCHEMA;
  schemaVersion: typeof LIVE_QA_REPORT_SCHEMA_VERSION;
  generatedAt: string;
  extensionVersion: string;
  providerId: 'chatgpt';
  route: LiveQaRouteEvidence;
  dom: LiveQaDomEvidence;
  runtime: LiveQaRuntimeEvidence;
  archive: LiveQaArchiveStatus;
  privacy: {
    containsChatText: false;
    containsRawUrl: false;
    containsConversationTitle: false;
    containsProviderConversationId: false;
  };
}

function safeToken(value: unknown, fallback = 'unknown'): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.slice(0, 80) || fallback;
}

function count(root: ParentNode, selector: string): number {
  return root.querySelectorAll(selector).length;
}

export function summarizeChatGptRoute(
  url: URL,
  providerConversationIdPresent: boolean,
  provisional: boolean
): LiveQaRouteEvidence {
  const segments = url.pathname.split('/').filter(Boolean);
  const hasConversationPath = segments.some(
    (segment, index) => segment === 'c' && Boolean(segments[index + 1])
  );

  return {
    kind: segments.length === 0 ? 'home' : hasConversationPath ? 'conversation' : 'other-chatgpt',
    pathSegmentCount: segments.length,
    queryPresent: Boolean(url.search),
    hashPresent: Boolean(url.hash),
    providerConversationIdPresent,
    provisional
  };
}

export function collectChatGptLiveQaDomEvidence(
  root: ParentNode,
  options: {
    adapterScrollContainer: Element | null;
    documentScrollingElement: Element | null;
    historyApiAvailable: boolean;
  }
): LiveQaDomEvidence {
  const selectors: LiveQaSelectorCounts = {
    sectionUserTurns: count(root, 'section[data-turn="user"]'),
    sectionAssistantTurns: count(root, 'section[data-turn="assistant"]'),
    articleTurns: count(root, 'article[data-turn]'),
    userRoleNodes: count(root, '[data-message-author-role="user"]'),
    assistantRoleNodes: count(root, '[data-message-author-role="assistant"]'),
    turnIdNodes: count(root, '[data-turn-id]'),
    messageIdNodes: count(root, '[data-message-id]'),
    conversationTurnTestIds: count(root, '[data-testid^="conversation-turn-"]'),
    collapsibleUserContent: count(root, '[data-testid="collapsible-user-message-content"]'),
    markdownWrappers: count(root, '.markdown'),
    proseWrappers: count(root, '.prose'),
    conversationLinks: count(root, 'a[href*="/c/"]')
  };

  return {
    selectors,
    stopGenerationControlPresent: GENERATION_CONTROL_SELECTORS.some(
      (selector) => root.querySelector(selector) !== null
    ),
    adapterScrollContainerFound: options.adapterScrollContainer !== null,
    adapterUsesDocumentScrollingElement:
      options.adapterScrollContainer !== null &&
      options.adapterScrollContainer === options.documentScrollingElement,
    mobileAppShellScrollContainerPresent:
      root.querySelector('[data-testid="mobile-app-shell-scroll-container"]') !== null,
    historyApiAvailable: options.historyApiAvailable
  };
}

export function buildLiveQaReport(input: {
  generatedAt?: string;
  extensionVersion: string;
  route: LiveQaRouteEvidence;
  dom: LiveQaDomEvidence;
  runtime: LiveQaRuntimeEvidence;
  archive: LiveQaArchiveStatus;
}): LiveQaReport {
  return {
    schema: LIVE_QA_REPORT_SCHEMA,
    schemaVersion: LIVE_QA_REPORT_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    extensionVersion: safeToken(input.extensionVersion),
    providerId: 'chatgpt',
    route: {
      kind: input.route.kind,
      pathSegmentCount: Math.max(0, Math.floor(input.route.pathSegmentCount)),
      queryPresent: Boolean(input.route.queryPresent),
      hashPresent: Boolean(input.route.hashPresent),
      providerConversationIdPresent: Boolean(input.route.providerConversationIdPresent),
      provisional: Boolean(input.route.provisional)
    },
    dom: {
      selectors: {
        sectionUserTurns: input.dom.selectors.sectionUserTurns,
        sectionAssistantTurns: input.dom.selectors.sectionAssistantTurns,
        articleTurns: input.dom.selectors.articleTurns,
        userRoleNodes: input.dom.selectors.userRoleNodes,
        assistantRoleNodes: input.dom.selectors.assistantRoleNodes,
        turnIdNodes: input.dom.selectors.turnIdNodes,
        messageIdNodes: input.dom.selectors.messageIdNodes,
        conversationTurnTestIds: input.dom.selectors.conversationTurnTestIds,
        collapsibleUserContent: input.dom.selectors.collapsibleUserContent,
        markdownWrappers: input.dom.selectors.markdownWrappers,
        proseWrappers: input.dom.selectors.proseWrappers,
        conversationLinks: input.dom.selectors.conversationLinks
      },
      stopGenerationControlPresent: Boolean(input.dom.stopGenerationControlPresent),
      adapterScrollContainerFound: Boolean(input.dom.adapterScrollContainerFound),
      adapterUsesDocumentScrollingElement: Boolean(input.dom.adapterUsesDocumentScrollingElement),
      mobileAppShellScrollContainerPresent: Boolean(input.dom.mobileAppShellScrollContainerPresent),
      historyApiAvailable: Boolean(input.dom.historyApiAvailable)
    },
    runtime: {
      adapterState: input.runtime.adapterState,
      adapterCode: safeToken(input.runtime.adapterCode),
      recordingState: input.runtime.recordingState,
      storageHealth: input.runtime.storageHealth,
      renderedTurnCount: Math.max(0, Math.floor(input.runtime.renderedTurnCount)),
      lastSaveConfirmed: Boolean(input.runtime.lastSaveConfirmed),
      historicalImportAvailable: Boolean(input.runtime.historicalImportAvailable)
    },
    archive: {
      conversationFound: Boolean(input.archive.conversationFound),
      messageCount: Math.max(0, Math.floor(input.archive.messageCount)),
      eventCount: Math.max(0, Math.floor(input.archive.eventCount)),
      visibleActivityCount: Math.max(0, Math.floor(input.archive.visibleActivityCount)),
      recordingState: input.archive.recordingState
    },
    privacy: {
      containsChatText: false,
      containsRawUrl: false,
      containsConversationTitle: false,
      containsProviderConversationId: false
    }
  };
}

export function renderLiveQaReportJson(report: LiveQaReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function liveQaReportFilename(generatedAt: string): string {
  return `llm-chat-history-live-qa__${generatedAt.replace(/[:.]/g, '-')}.json`;
}
