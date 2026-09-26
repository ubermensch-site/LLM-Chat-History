import type {
  AdapterHealth,
  ProviderAdapter,
  ProviderConversationIdentity,
  ProviderObservation,
  ProviderTurnObservation,
  ProviderVisibleActivityObservation,
  TurnRole
} from '../../shared/types';
import { renderDomAsMarkdown } from './dom-markdown';
import { ChatGptHealthMonitor } from './health-monitor';
import {
  ASSISTANT_CONTENT_SELECTORS,
  CHATGPT_HOSTS,
  GENERATION_CONTROL_SELECTORS,
  KEYED_TURN_SELECTOR,
  ROLE_FALLBACK_SELECTOR,
  TURN_DISCOVERY_STRATEGIES,
  USER_CONTENT_SELECTORS
} from './selectors';
import {
  classifyVisibleActivity,
  hasExplicitVisibleActivitySignal,
  looksLikeVisibleActivityText,
  normalizeVisibleActivityText,
  visibleActivityId
} from './visible-activity';

const isoNow = () => new Date().toISOString();
const VISIBLE_GPT_MODEL = /^GPT[-\s]?\d[A-Za-z0-9.]*(?:\s+[A-Za-z0-9.+-]+){0,3}$/i;
const VISIBLE_O_MODEL = /^(?:OpenAI\s+)?o\d[A-Za-z0-9.]*(?:-[A-Za-z0-9.]+)?(?:\s+[A-Za-z0-9.+-]+){0,2}$/i;

export function parseChatGptConversationId(url: URL): string | null {
  const match = url.pathname.match(/\/c\/([^/?#]+)/);
  return match?.[1] ?? null;
}

export function normalizeVisibleModelLabel(value: string): string | null {
  const normalized = value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:model|used model)\s*[:\-]\s*/i, '')
    .trim();

  if (!normalized || normalized.length > 80) return null;
  return VISIBLE_GPT_MODEL.test(normalized) || VISIBLE_O_MODEL.test(normalized)
    ? normalized
    : null;
}

export interface ChatGptRoleSignals {
  dataTurn?: string | null;
  messageAuthorRole?: string | null;
  dataRole?: string | null;
  messageAuthor?: string | null;
  userMessageBubble?: boolean;
  conversationRole?: string | null;
}

export function inferChatGptTurnRole(signals: ChatGptRoleSignals): TurnRole | null {
  const explicitRoles = [
    signals.dataTurn,
    signals.messageAuthorRole,
    signals.dataRole,
    signals.messageAuthor,
    signals.conversationRole
  ];

  for (const value of explicitRoles) {
    if (value === 'user' || value === 'assistant') return value;
  }

  return signals.userMessageBubble ? 'user' : null;
}

function roleSignalsFor(element: Element): ChatGptRoleSignals {
  return {
    dataTurn: element.getAttribute('data-turn'),
    messageAuthorRole: element.getAttribute('data-message-author-role'),
    dataRole: element.getAttribute('data-role'),
    messageAuthor: element.getAttribute('data-message-author'),
    userMessageBubble: element.hasAttribute('data-user-message-bubble'),
    conversationRole: element.getAttribute('data-conversation-role')
  };
}

function directRoleFor(element: Element): TurnRole | null {
  return inferChatGptTurnRole(roleSignalsFor(element));
}

function queryFirst(root: ParentNode, selectors: readonly string[]): Element | null {
  for (const selector of selectors) {
    const match = root.querySelector(selector);
    if (match) return match;
  }
  return null;
}

function sortInDocumentOrder(elements: Element[]): Element[] {
  return elements.sort((a, b) => {
    if (a === b) return 0;
    const relation = a.compareDocumentPosition(b);
    if (relation & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (relation & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
}

export interface ChatGptContainerRoleSignals {
  directRole?: TurnRole | null;
  userMessageBubblePresent?: boolean;
  explicitUserPresent?: boolean;
  explicitAssistantPresent?: boolean;
}

export function inferChatGptContainerRole(
  signals: ChatGptContainerRoleSignals
): TurnRole | null {
  if (signals.directRole) return signals.directRole;
  if (signals.userMessageBubblePresent) return 'user';
  if (signals.explicitUserPresent) return 'user';
  if (signals.explicitAssistantPresent) return 'assistant';
  return null;
}

function roleFor(element: Element): TurnRole | null {
  return inferChatGptContainerRole({
    directRole: directRoleFor(element),
    userMessageBubblePresent: Boolean(element.querySelector('[data-user-message-bubble]')),
    explicitUserPresent: Boolean(
      element.querySelector(
        '[data-message-author-role="user"], [data-role="user"], [data-message-author="user"]'
      )
    ),
    explicitAssistantPresent: Boolean(
      element.querySelector(
        '[data-message-author-role="assistant"], [data-role="assistant"], [data-message-author="assistant"], [data-conversation-role="assistant"]'
      )
    )
  });
}

function preferredTurnContainer(element: Element): Element {
  return element.closest(KEYED_TURN_SELECTOR) ?? element;
}

function dedupeNestedTurnElements(elements: Element[]): Element[] {
  return elements.filter((candidate, index, all) => {
    const role = roleFor(candidate);
    if (!role) return false;

    return !all.some((other, otherIndex) =>
      otherIndex !== index &&
      other.contains(candidate) &&
      roleFor(other) === role
    );
  });
}

function collectTurnElements(): Element[] {
  for (const strategy of TURN_DISCOVERY_STRATEGIES) {
    const found = new Set<Element>();

    for (const selector of strategy.selectors) {
      document.querySelectorAll(selector).forEach((element) => found.add(element));
    }

    const candidates =
      strategy.id === 'semantic-roles'
        ? [...found].map(preferredTurnContainer)
        : [...found];

    const recognized = sortInDocumentOrder(
      [...new Set(candidates)].filter((element) => roleFor(element) !== null)
    );

    if (recognized.length > 0) return dedupeNestedTurnElements(recognized);
  }

  return [];
}

function messageNodeFor(element: Element, role: TurnRole): Element | null {
  if (element.matches(ROLE_FALLBACK_SELECTOR) && directRoleFor(element) === role) {
    return element;
  }

  if (role === 'user') {
    return (
      element.querySelector('[data-user-message-bubble]') ??
      element.querySelector('[data-message-author-role="user"]') ??
      element.querySelector('[data-role="user"]') ??
      element.querySelector('[data-message-author="user"]') ??
      (directRoleFor(element) === 'user' ? element : null)
    );
  }

  return (
    element.querySelector('[data-message-author-role="assistant"]') ??
    element.querySelector('[data-role="assistant"]') ??
    element.querySelector('[data-message-author="assistant"]') ??
    element.querySelector('[data-conversation-role="assistant"]') ??
    (directRoleFor(element) === 'assistant' ? element : null)
  );
}

function closestAttribute(element: Element, attribute: string): string | null {
  const direct = element.getAttribute(attribute);
  if (direct) return direct;

  const owner = element.closest(`[${attribute}]`);
  return owner?.getAttribute(attribute) ?? null;
}

function providerMessageIdFor(element: Element, role: TurnRole): string | null {
  const messageNode = messageNodeFor(element, role);
  if (!messageNode) return null;

  return (
    messageNode.getAttribute('data-message-id') ??
    messageNode.querySelector('[data-message-id]')?.getAttribute('data-message-id') ??
    null
  );
}

function assistantAnswerNodeFor(element: Element): Element | null {
  // Newer ChatGPT renderers may expose a small semantic accessibility marker
  // (for example, "ChatGPT said:") separately from the rendered answer body.
  // Search the full turn container first so that marker text is never mistaken
  // for the actual assistant response.
  const fromTurn = queryFirst(element, ASSISTANT_CONTENT_SELECTORS);
  if (fromTurn) return fromTurn;

  const roleNode = messageNodeFor(element, 'assistant');
  return roleNode ? queryFirst(roleNode, ASSISTANT_CONTENT_SELECTORS) : null;
}

function contentNodeFor(element: Element, role: TurnRole): Element | null {
  const roleNode = messageNodeFor(element, role) ?? element;
  if (role === 'assistant') {
    // Never fall back to the assistant role/accessibility marker itself:
    // that is how the live build captured "ChatGPT said:" as message content.
    return assistantAnswerNodeFor(element);
  }
  return queryFirst(roleNode, USER_CONTENT_SELECTORS) ?? roleNode;
}

function normalizedText(element: Element | null): string {
  return (element?.textContent ?? '').replace(/\u00a0/g, ' ').trim();
}

function visibleModelLabelFor(turn: Element, answerNode: Element | null): string | null {
  const candidates = turn.querySelectorAll(
    'button, [role="button"], [data-testid*="model" i], [aria-label*="model" i]'
  );

  for (const candidate of candidates) {
    if (candidate.getAttribute('aria-hidden') === 'true') continue;
    if (answerNode && (candidate === answerNode || answerNode.contains(candidate))) continue;

    const fromText = normalizeVisibleModelLabel(candidate.textContent ?? '');
    if (fromText) return fromText;

    const fromAria = normalizeVisibleModelLabel(candidate.getAttribute('aria-label') ?? '');
    if (fromAria) return fromAria;
  }

  return null;
}

function candidateSignal(element: Element): string {
  return [
    element.tagName,
    element.getAttribute('role') ?? '',
    element.getAttribute('data-testid') ?? '',
    element.getAttribute('aria-label') ?? '',
    element.getAttribute('aria-live') ?? ''
  ].join(' ');
}

function candidateDomKey(element: Element, fallbackIndex: number): string {
  const attributes = ['data-testid', 'id', 'aria-controls', 'aria-label'] as const;
  for (const attribute of attributes) {
    const value = element.getAttribute(attribute);
    if (value) return `${attribute}:${value}`;
  }
  return `${element.tagName.toLocaleLowerCase()}:${fallbackIndex}`;
}

function visibleActivitiesFor(
  turn: Element,
  answerNode: Element | null,
  providerTurnId: string,
  observedAt: string
): ProviderVisibleActivityObservation[] {
  const candidates = turn.querySelectorAll(
    'button, [role="button"], summary, [role="status"], [aria-live], [data-testid], [aria-label], div, span'
  );
  const seenText = new Set<string>();
  const activities: ProviderVisibleActivityObservation[] = [];

  candidates.forEach((candidate, candidateIndex) => {
    if (candidate.getAttribute('aria-hidden') === 'true') return;
    if (answerNode && (candidate === answerNode || answerNode.contains(candidate))) return;

    const text = normalizeVisibleActivityText(candidate.textContent ?? '');
    if (!text || normalizeVisibleModelLabel(text)) return;

    const signal = candidateSignal(candidate);
    if (!hasExplicitVisibleActivitySignal(signal) && !looksLikeVisibleActivityText(text)) return;

    const normalizedKey = text.toLocaleLowerCase();
    if (seenText.has(normalizedKey)) return;
    seenText.add(normalizedKey);

    const orderHint = activities.length;
    activities.push({
      providerActivityId: visibleActivityId(
        providerTurnId,
        candidateDomKey(candidate, candidateIndex),
        orderHint
      ),
      kind: classifyVisibleActivity(text, signal),
      text,
      orderHint,
      observedAt
    });
  });

  return activities;
}

function hasGenerationControl(): boolean {
  return GENERATION_CONTROL_SELECTORS.some((selector) => document.querySelector(selector));
}

function isVerticallyScrollable(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  return (
    /^(auto|scroll|overlay)$/.test(style.overflowY) &&
    element.scrollHeight > element.clientHeight + 4
  );
}

function nearestScrollableAncestor(element: Element): HTMLElement | null {
  let current = element.parentElement;
  while (current) {
    if (isVerticallyScrollable(current)) return current;
    current = current.parentElement;
  }
  return null;
}

export class ChatGptAdapter implements ProviderAdapter {
  readonly providerId = 'chatgpt' as const;
  private readonly healthMonitor = new ChatGptHealthMonitor();

  matchesLocation(url: URL): boolean {
    return url.protocol === 'https:' && CHATGPT_HOSTS.has(url.hostname);
  }

  getConversationIdentity(): ProviderConversationIdentity | null {
    const url = new URL(location.href);
    if (!this.matchesLocation(url)) return null;

    const providerConversationId = parseChatGptConversationId(url);
    return {
      providerId: this.providerId,
      providerConversationId,
      sourceUrl: url.href,
      provisional: providerConversationId === null
    };
  }

  getConversationTitle(): string | null {
    const title = document.title
      .replace(/\s*[|·-]\s*ChatGPT\s*$/i, '')
      .replace(/^ChatGPT\s*[|·-]\s*/i, '')
      .trim();
    return title && title.toLowerCase() !== 'chatgpt' ? title : null;
  }

  getConversationScrollContainer(): HTMLElement | null {
    const turns = collectTurnElements();
    for (const turn of turns) {
      const scrollable = nearestScrollableAncestor(turn);
      if (scrollable) return scrollable;
    }

    const fallback = document.scrollingElement;
    return fallback instanceof HTMLElement ? fallback : document.documentElement;
  }

  scanRenderedTurns(): ProviderTurnObservation[] {
    const identity = this.getConversationIdentity();
    if (!identity) return [];

    const elements = collectTurnElements();
    const generating = hasGenerationControl();
    let lastAssistantIndex = -1;

    elements.forEach((element, index) => {
      if (roleFor(element) === 'assistant') lastAssistantIndex = index;
    });

    const turns: ProviderTurnObservation[] = [];

    elements.forEach((element, index) => {
      const role = roleFor(element);
      if (!role) return;

      const providerMessageId = providerMessageIdFor(element, role);
      const providerTurnId =
        closestAttribute(element, 'data-turn-id') ??
        closestAttribute(element, 'data-turn-key') ??
        providerMessageId ??
        element.getAttribute('data-testid') ??
        `dom:${role}:${index}`;
      const observedAt = isoNow();
      const contentNode = contentNodeFor(element, role);
      const answerNode = role === 'assistant' ? assistantAnswerNodeFor(element) : null;
      const plainText = normalizedText(contentNode);
      const renderedMarkdown = contentNode ? renderDomAsMarkdown(contentNode) : '';

      // A semantic role marker without rendered message content is not a
      // conversation turn. Skipping it is safer than persisting accessibility
      // labels as transcript text.
      if (!contentNode || (!plainText && !renderedMarkdown)) return;

      const visibleActivities =
        role === 'assistant'
          ? visibleActivitiesFor(element, answerNode, providerTurnId, observedAt)
          : [];

      turns.push({
        providerId: this.providerId,
        providerConversationId: identity.providerConversationId,
        providerTurnId,
        providerMessageId,
        role,
        orderHint: index,
        plainText,
        markdown: renderedMarkdown || plainText || null,
        partial: role === 'assistant' && generating && index === lastAssistantIndex,
        modelLabel: role === 'assistant' ? visibleModelLabelFor(element, answerNode) : null,
        ...(visibleActivities.length ? { visibleActivities } : {}),
        observedAt
      });
    });

    return turns;
  }

  getHealth(): AdapterHealth {
    const identity = this.getConversationIdentity();
    if (!identity) {
      this.healthMonitor.reset();
      return { state: 'error', code: 'unsupported-location', observedAt: isoNow() };
    }

    const turns = collectTurnElements();
    let base: AdapterHealth;
    if (identity.providerConversationId && turns.length === 0) {
      base = {
        state: 'degraded',
        code: 'conversation-has-no-rendered-turns',
        detail: 'Conversation route detected but no semantic turn elements are currently rendered.',
        observedAt: isoNow()
      };
    } else {
      const missingStableIds = turns.some((element, index) => {
        const role = roleFor(element);
        if (!role) return false;
        const providerMessageId = providerMessageIdFor(element, role);
        return !closestAttribute(element, 'data-turn-id') &&
          !closestAttribute(element, 'data-turn-key') &&
          !providerMessageId &&
          !element.getAttribute('data-testid') &&
          index >= 0;
      });

      base = missingStableIds
        ? {
            state: 'degraded',
            code: 'turn-ids-missing',
            detail: 'One or more rendered turns require temporary DOM-order identity.',
            observedAt: isoNow()
          }
        : { state: 'healthy', code: 'adapter-ready', observedAt: isoNow() };
    }

    return this.healthMonitor.assess(
      base,
      identity.providerConversationId ?? 'provisional-chat'
    );
  }

  observe(callback: (event: ProviderObservation) => void): () => void {
    let stopped = false;
    let scheduled: number | null = null;
    let lastUrl = location.href;

    const emitSnapshot = () => {
      if (stopped) return;
      const identity = this.getConversationIdentity();
      const observedAt = isoNow();
      if (identity) {
        callback({
          type: 'conversation',
          identity,
          title: this.getConversationTitle(),
          observedAt
        });
      }
      callback({
        type: 'turn-snapshot',
        turns: this.scanRenderedTurns(),
        observedAt
      });
      callback({ type: 'health', health: this.getHealth() });
    };

    const scheduleSnapshot = () => {
      if (scheduled !== null) window.clearTimeout(scheduled);
      scheduled = window.setTimeout(() => {
        scheduled = null;
        emitSnapshot();
      }, 150);
    };

    const observer = new MutationObserver(scheduleSnapshot);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    const routeTimer = window.setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        scheduleSnapshot();
      }
    }, 500);

    window.addEventListener('popstate', scheduleSnapshot);
    emitSnapshot();

    return () => {
      stopped = true;
      observer.disconnect();
      window.clearInterval(routeTimer);
      if (scheduled !== null) window.clearTimeout(scheduled);
      window.removeEventListener('popstate', scheduleSnapshot);
    };
  }
}
