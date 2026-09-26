export const CHATGPT_HOSTS = new Set(['chatgpt.com', 'chat.openai.com']);

export const KEYED_TURN_SELECTOR = '[data-turn-key]';

export const TURN_SHELL_SELECTORS = [
  'section[data-turn="user"], section[data-turn="assistant"]',
  'article[data-turn="user"], article[data-turn="assistant"]',
  '[data-testid^="conversation-turn-"]'
] as const;

export const ROLE_FALLBACK_SELECTORS = [
  '[data-message-author-role="user"], [data-message-author-role="assistant"]',
  '[data-role="user"], [data-role="assistant"]',
  '[data-message-author="user"], [data-message-author="assistant"]',
  '[data-user-message-bubble]',
  '[data-conversation-role="assistant"]',
  '[data-chatgpt-agent-turn-start]'
] as const;

export const TURN_DISCOVERY_STRATEGIES = [
  { id: 'turn-shells', selectors: TURN_SHELL_SELECTORS },
  { id: 'keyed-exchanges', selectors: [KEYED_TURN_SELECTOR] as const },
  { id: 'semantic-roles', selectors: ROLE_FALLBACK_SELECTORS }
] as const;

export const ROLE_FALLBACK_SELECTOR = ROLE_FALLBACK_SELECTORS.join(', ');

export const ASSISTANT_CONTENT_SELECTORS = [
  '[data-markdown-text-style="assistant-message"]',
  '[data-content-search-unit-key$=":assistant"] [data-markdown-text-style="assistant-message"]',
  '.markdown',
  '.prose',
  '[class*="markdown"]'
] as const;

export const USER_CONTENT_SELECTORS = [
  '[data-testid="collapsible-user-message-content"]',
  '[data-user-message-bubble]',
  '[data-content-search-unit-key$=":user"] [data-user-message-bubble]',
  '.whitespace-pre-wrap'
] as const;

export const GENERATION_CONTROL_SELECTORS = [
  'button[data-testid="stop-button"]',
  'button[aria-label*="Stop"]'
] as const;
