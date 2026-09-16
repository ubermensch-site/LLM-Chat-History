import type {
  AdapterHealth,
  ProviderAdapter,
  ProviderConversationIdentity,
  ProviderObservation,
  ProviderTurnObservation,
  TurnRole
} from '../../shared/types';
import { renderDomAsMarkdown } from './dom-markdown';
import { ChatGptHealthMonitor } from './health-monitor';
import {
  ASSISTANT_CONTENT_SELECTORS,
  CHATGPT_HOSTS,
  GENERATION_CONTROL_SELECTORS,
  ROLE_FALLBACK_SELECTOR,
  TURN_SHELL_SELECTORS,
  USER_CONTENT_SELECTORS
} from './selectors';

const isoNow = () => new Date().toISOString();

export function parseChatGptConversationId(url: URL): string | null {
  const match = url.pathname.match(/\/c\/([^/?#]+)/);
  return match?.[1] ?? null;
}

function queryFirst(root: ParentNode, selectors: readonly string[]): Element | null {
  for (const selector of selectors) {
    const match = root.querySelector(selector);
    if (match) return match;
  }
  return null;
}

function collectTurnElements(): Element[] {
  const found = new Set<Element>();

  for (const selector of TURN_SHELL_SELECTORS) {
    document.querySelectorAll(selector).forEach((element) => found.add(element));
  }

  if (found.size === 0) {
    document.querySelectorAll(ROLE_FALLBACK_SELECTOR).forEach((element) => found.add(element));
  }

  return [...found].sort((a, b) => {
    if (a === b) return 0;
    const relation = a.compareDocumentPosition(b);
    if (relation & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (relation & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
}

function roleFor(element: Element): TurnRole | null {
  const shellRole = element.getAttribute('data-turn');
  if (shellRole === 'user' || shellRole === 'assistant') return shellRole;

  const roleNode = element.matches('[data-message-author-role]')
    ? element
    : element.querySelector('[data-message-author-role]');
  const messageRole = roleNode?.getAttribute('data-message-author-role');
  return messageRole === 'user' || messageRole === 'assistant' ? messageRole : null;
}

function messageNodeFor(element: Element, role: TurnRole): Element | null {
  if (element.getAttribute('data-message-author-role') === role) return element;
  return element.querySelector(`[data-message-author-role="${role}"]`);
}

function contentNodeFor(element: Element, role: TurnRole): Element | null {
  const roleNode = messageNodeFor(element, role) ?? element;
  const selectors = role === 'assistant' ? ASSISTANT_CONTENT_SELECTORS : USER_CONTENT_SELECTORS;
  return queryFirst(roleNode, selectors) ?? roleNode;
}

function normalizedText(element: Element | null): string {
  return (element?.textContent ?? '').replace(/\u00a0/g, ' ').trim();
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

      const messageNode = messageNodeFor(element, role);
      const providerMessageId = messageNode?.getAttribute('data-message-id') ?? null;
      const providerTurnId =
        element.getAttribute('data-turn-id') ??
        providerMessageId ??
        element.getAttribute('data-testid') ??
        `dom:${role}:${index}`;
      const contentNode = contentNodeFor(element, role);
      const plainText = normalizedText(contentNode);
      const renderedMarkdown = contentNode ? renderDomAsMarkdown(contentNode) : '';

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
        observedAt: isoNow()
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
        const messageNode = messageNodeFor(element, role);
        return !element.getAttribute('data-turn-id') &&
          !messageNode?.getAttribute('data-message-id') &&
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
