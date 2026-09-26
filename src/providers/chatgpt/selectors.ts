export const CHATGPT_HOSTS = new Set(['chatgpt.com', 'chat.openai.com']);

/**
 * Ordered from the most explicit legacy/current turn shells to semantic nodes in
 * ChatGPT's keyed renderer. Keep these selectors centralized: provider DOM is an
 * external contract and is expected to drift.
 */
export const TURN_SHELL_SELECTORS = [
  'section[data-turn="user"], section[data-turn="assistant"]',
  'article[data-turn="user"], article[data-turn="assistant"]',
  '[data-testid^="conversation-turn-"][data-turn]',
  '[data-testid^="conversation-turn-"][data-message-author-role]',
  '[data-testid^="conversation-turn-"]:has([data-message-author-role])',
  '[data-turn-key] [data-user-message-bubble]',
  '[data-turn-key] [data-conversation-role="assistant"]'
] as const;

export const ROLE_FALLBACK_SELECTORS = [
  '[data-message-author-role="user"], [data-message-author-role="assistant"]',
  '[data-role="user"], [data-role="assistant"]',
  '[data-message-author="user"], [data-message-author="assistant"]',
  '[data-user-message-bubble]',
  '[data-conversation-role="assistant"]'
] as const;

// Compatibility export for the current adapter while role discovery is migrated
// to the multi-strategy contract above.
export const ROLE_FALLBACK_SELECTOR = ROLE_FALLBACK_SELECTORS.join(', ');

export const ASSISTANT_CONTENT_SELECTORS = [
  '.markdown',
  '.prose',
  '[class*="markdown"]',
  '[data-conversation-role="assistant"]'
] as const;

export const USER_CONTENT_SELECTORS = [
  '[data-testid="collapsible-user-message-content"]',
  '[data-user-message-bubble]',
  '.whitespace-pre-wrap'
] as const;

export const GENERATION_CONTROL_SELECTORS = [
  'button[data-testid="stop-button"]',
  'button[aria-label*="Stop"]'
] as const;
