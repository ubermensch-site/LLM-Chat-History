import {
  LIVE_QA_REPORT_SCHEMA,
  LIVE_QA_REPORT_SCHEMA_VERSION,
  type LiveQaReport
} from './live-qa-report';

export type LiveQaEvidenceStatus = 'pass' | 'warn' | 'fail';

export interface LiveQaEvidenceCheck {
  id: string;
  status: LiveQaEvidenceStatus;
  detail: string;
}

export interface LiveQaEvidenceSummary {
  schemaValid: boolean;
  structuralPass: boolean;
  checks: LiveQaEvidenceCheck[];
  summary: {
    generatedAt: string | null;
    extensionVersion: string | null;
    routeKind: string | null;
    adapterState: string | null;
    recordingState: string | null;
    storageHealth: string | null;
    renderedTurnCount: number | null;
    archiveMessageCount: number | null;
    archiveEventCount: number | null;
    archiveVisibleActivityCount: number | null;
  };
}

const TOP_LEVEL_KEYS = [
  'schema', 'schemaVersion', 'generatedAt', 'extensionVersion', 'providerId',
  'route', 'dom', 'runtime', 'archive', 'privacy'
] as const;
const ROUTE_KEYS = [
  'kind', 'pathSegmentCount', 'queryPresent', 'hashPresent',
  'providerConversationIdPresent', 'provisional'
] as const;
const DOM_KEYS = [
  'selectors', 'stopGenerationControlPresent', 'adapterScrollContainerFound',
  'adapterUsesDocumentScrollingElement', 'mobileAppShellScrollContainerPresent',
  'historyApiAvailable'
] as const;
const SELECTOR_KEYS = [
  'sectionUserTurns', 'sectionAssistantTurns', 'articleTurns', 'userRoleNodes',
  'assistantRoleNodes', 'turnIdNodes', 'messageIdNodes', 'conversationTurnTestIds',
  'collapsibleUserContent', 'markdownWrappers', 'proseWrappers', 'conversationLinks'
] as const;
const RUNTIME_KEYS = [
  'adapterState', 'adapterCode', 'recordingState', 'storageHealth',
  'renderedTurnCount', 'lastSaveConfirmed', 'historicalImportAvailable'
] as const;
const ARCHIVE_KEYS = [
  'conversationFound', 'messageCount', 'eventCount', 'visibleActivityCount', 'recordingState'
] as const;
const PRIVACY_KEYS = [
  'containsChatText', 'containsRawUrl', 'containsConversationTitle', 'containsProviderConversationId'
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key)) && keys.every((key) => key in value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function push(checks: LiveQaEvidenceCheck[], id: string, status: LiveQaEvidenceStatus, detail: string): void {
  checks.push({ id, status, detail });
}

function validateShape(value: unknown, checks: LiveQaEvidenceCheck[]): value is LiveQaReport {
  if (!isRecord(value) || !hasOnlyKeys(value, TOP_LEVEL_KEYS)) {
    push(checks, 'schema.shape', 'fail', 'Unexpected or missing top-level report fields.');
    return false;
  }
  if (value.schema !== LIVE_QA_REPORT_SCHEMA || value.schemaVersion !== LIVE_QA_REPORT_SCHEMA_VERSION) {
    push(checks, 'schema.version', 'fail', 'Unsupported live QA report schema/version.');
    return false;
  }
  if (!isString(value.generatedAt) || !isString(value.extensionVersion) || value.providerId !== 'chatgpt') {
    push(checks, 'schema.identity', 'fail', 'Invalid report identity metadata.');
    return false;
  }

  const route = value.route;
  const dom = value.dom;
  const runtime = value.runtime;
  const archive = value.archive;
  const privacy = value.privacy;
  if (!isRecord(route) || !hasOnlyKeys(route, ROUTE_KEYS)) return false;
  if (!isRecord(dom) || !hasOnlyKeys(dom, DOM_KEYS)) return false;
  if (!isRecord(runtime) || !hasOnlyKeys(runtime, RUNTIME_KEYS)) return false;
  if (!isRecord(archive) || !hasOnlyKeys(archive, ARCHIVE_KEYS)) return false;
  if (!isRecord(privacy) || !hasOnlyKeys(privacy, PRIVACY_KEYS)) return false;
  if (!isRecord(dom.selectors) || !hasOnlyKeys(dom.selectors, SELECTOR_KEYS)) return false;

  if (!['home', 'conversation', 'other-chatgpt'].includes(String(route.kind))) return false;
  if (!isNonNegativeInteger(route.pathSegmentCount)) return false;
  if (![route.queryPresent, route.hashPresent, route.providerConversationIdPresent, route.provisional].every(isBoolean)) return false;
  if (!Object.values(dom.selectors).every(isNonNegativeInteger)) return false;
  if (![dom.stopGenerationControlPresent, dom.adapterScrollContainerFound, dom.adapterUsesDocumentScrollingElement, dom.mobileAppShellScrollContainerPresent, dom.historyApiAvailable].every(isBoolean)) return false;
  if (!['healthy', 'degraded', 'error'].includes(String(runtime.adapterState))) return false;
  if (!isString(runtime.adapterCode)) return false;
  if (!['recording', 'paused', 'stopped', 'error'].includes(String(runtime.recordingState))) return false;
  if (!['unknown', 'healthy', 'error'].includes(String(runtime.storageHealth))) return false;
  if (!isNonNegativeInteger(runtime.renderedTurnCount)) return false;
  if (![runtime.lastSaveConfirmed, runtime.historicalImportAvailable].every(isBoolean)) return false;
  if (!isBoolean(archive.conversationFound)) return false;
  if (!isNonNegativeInteger(archive.messageCount)) return false;
  if (!isNonNegativeInteger(archive.eventCount)) return false;
  if (!isNonNegativeInteger(archive.visibleActivityCount)) return false;
  if (archive.recordingState !== null && !['recording', 'paused', 'stopped', 'error'].includes(String(archive.recordingState))) return false;
  if (!Object.values(privacy).every(isBoolean)) return false;

  push(checks, 'schema.shape', 'pass', 'Report schema is exact and contains no extra fields.');
  return true;
}

export function evaluateLiveQaEvidence(
  value: unknown,
  options: { expectedExtensionVersion?: string } = {}
): LiveQaEvidenceSummary {
  const checks: LiveQaEvidenceCheck[] = [];
  const schemaValid = validateShape(value, checks);
  if (!schemaValid) {
    return {
      schemaValid: false,
      structuralPass: false,
      checks,
      summary: {
        generatedAt: null,
        extensionVersion: null,
        routeKind: null,
        adapterState: null,
        recordingState: null,
        storageHealth: null,
        renderedTurnCount: null,
        archiveMessageCount: null,
        archiveEventCount: null,
        archiveVisibleActivityCount: null
      }
    };
  }

  const report = value;
  const expectedVersion = options.expectedExtensionVersion;
  if (expectedVersion && report.extensionVersion !== expectedVersion) {
    push(checks, 'release.version', 'fail', `Expected extension ${expectedVersion}, got ${report.extensionVersion}.`);
  } else {
    push(checks, 'release.version', 'pass', `Extension version ${report.extensionVersion}.`);
  }

  if (Object.values(report.privacy).every((flag) => flag === false)) {
    push(checks, 'privacy.flags', 'pass', 'Report declares all protected content classes absent.');
  } else {
    push(checks, 'privacy.flags', 'fail', 'Report declares protected conversation content present.');
  }

  if (report.runtime.adapterState === 'error') {
    push(checks, 'adapter.health', 'fail', `Adapter is error (${report.runtime.adapterCode}).`);
  } else if (report.runtime.adapterState === 'degraded') {
    push(checks, 'adapter.health', 'warn', `Adapter is degraded (${report.runtime.adapterCode}); manual review required.`);
  } else {
    push(checks, 'adapter.health', 'pass', `Adapter is healthy (${report.runtime.adapterCode}).`);
  }

  if (report.runtime.storageHealth === 'error') {
    push(checks, 'storage.health', 'fail', 'Canonical local persistence reports an error.');
  } else if (report.runtime.storageHealth === 'unknown') {
    push(checks, 'storage.health', 'warn', 'Canonical local persistence has not yet confirmed a save.');
  } else {
    push(checks, 'storage.health', 'pass', 'Canonical local persistence reports healthy.');
  }

  const semanticTurnNodes = report.dom.selectors.sectionUserTurns + report.dom.selectors.sectionAssistantTurns + report.dom.selectors.articleTurns + report.dom.selectors.userRoleNodes + report.dom.selectors.assistantRoleNodes;
  if (report.runtime.renderedTurnCount > 0 && semanticTurnNodes === 0) {
    push(checks, 'dom.turn-selectors', 'fail', 'Recorder reports rendered turns but no supported semantic turn selectors are present.');
  } else if (report.runtime.renderedTurnCount > 0) {
    push(checks, 'dom.turn-selectors', 'pass', 'Rendered turns have semantic DOM selector evidence.');
  } else {
    push(checks, 'dom.turn-selectors', 'warn', 'No rendered turns are present in this snapshot.');
  }

  const stableIdNodes = report.dom.selectors.turnIdNodes + report.dom.selectors.messageIdNodes + report.dom.selectors.conversationTurnTestIds;
  if (report.runtime.renderedTurnCount > 0 && stableIdNodes === 0) {
    push(checks, 'dom.stable-ids', 'warn', 'Rendered turns expose no observed stable-ID selector family; fallback identity needs manual review.');
  } else if (stableIdNodes > 0) {
    push(checks, 'dom.stable-ids', 'pass', 'At least one stable-ID selector family is present.');
  }

  if (report.route.kind === 'conversation') {
    if (!report.route.providerConversationIdPresent || report.route.provisional) {
      push(checks, 'route.identity', 'fail', 'Conversation route is not resolved to a stable provider conversation identity.');
    } else {
      push(checks, 'route.identity', 'pass', 'Conversation route has a stable provider identity.');
    }
    if (!report.archive.conversationFound) {
      push(checks, 'archive.conversation', 'fail', 'Current conversation is not present in the canonical local archive.');
    } else {
      push(checks, 'archive.conversation', 'pass', 'Current conversation exists in the canonical local archive.');
    }
    if (!report.dom.adapterScrollContainerFound) {
      push(checks, 'dom.scroll-container', 'fail', 'Adapter could not resolve a conversation scroll container.');
    } else {
      push(checks, 'dom.scroll-container', 'pass', 'Conversation scroll container resolved.');
    }
  }

  if (!report.dom.historyApiAvailable) {
    push(checks, 'spa.history-api', 'warn', 'History API was unavailable; SPA navigation needs manual review.');
  } else {
    push(checks, 'spa.history-api', 'pass', 'History API is available for SPA navigation observation.');
  }

  if (report.archive.recordingState && report.archive.recordingState !== report.runtime.recordingState) {
    push(checks, 'recorder.state-consistency', 'fail', `UI state ${report.runtime.recordingState} differs from persisted state ${report.archive.recordingState}.`);
  } else if (report.archive.recordingState) {
    push(checks, 'recorder.state-consistency', 'pass', `UI and persisted recorder state agree (${report.runtime.recordingState}).`);
  }

  if (report.archive.messageCount > 0 && !report.runtime.lastSaveConfirmed) {
    push(checks, 'storage.confirmation', 'warn', 'Archive contains messages but this page session has not confirmed a save timestamp.');
  } else if (report.runtime.lastSaveConfirmed) {
    push(checks, 'storage.confirmation', 'pass', 'Current page session has a confirmed persistence ACK.');
  }

  if (report.archive.visibleActivityCount > 0 && report.archive.messageCount === 0) {
    push(checks, 'archive.visible-activity', 'fail', 'Visible activity exists without an archived message.');
  } else {
    push(checks, 'archive.visible-activity', 'pass', `Archived visible-activity count is ${report.archive.visibleActivityCount}; text is excluded from this report.`);
  }

  const structuralPass = !checks.some((check) => check.status === 'fail');
  return {
    schemaValid: true,
    structuralPass,
    checks,
    summary: {
      generatedAt: report.generatedAt,
      extensionVersion: report.extensionVersion,
      routeKind: report.route.kind,
      adapterState: report.runtime.adapterState,
      recordingState: report.runtime.recordingState,
      storageHealth: report.runtime.storageHealth,
      renderedTurnCount: report.runtime.renderedTurnCount,
      archiveMessageCount: report.archive.messageCount,
      archiveEventCount: report.archive.eventCount,
      archiveVisibleActivityCount: report.archive.visibleActivityCount
    }
  };
}

export function renderLiveQaEvidenceMarkdown(result: LiveQaEvidenceSummary): string {
  const lines = [
    `## LLM Chat History live QA evidence`,
    ``,
    `Structural result: **${result.structuralPass ? 'PASS' : 'FAIL'}**`,
    `Schema valid: **${result.schemaValid ? 'yes' : 'no'}**`,
    ``
  ];
  for (const check of result.checks) {
    const marker = check.status === 'pass' ? '✅' : check.status === 'warn' ? '⚠️' : '❌';
    lines.push(`- ${marker} \`${check.id}\` — ${check.detail}`);
  }
  lines.push('', '> This validates one privacy-safe structural snapshot only. It does not by itself satisfy scenario-level streaming, pause/private/resume, navigation, restart, or historical-import acceptance.');
  return `${lines.join('\n')}\n`;
}
