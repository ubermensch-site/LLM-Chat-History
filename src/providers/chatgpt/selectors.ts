export const CHATGPT_HOSTS = new Set(['chatgpt.com', 'chat.openai.com']);

export const TURN_SHELL_SELECTORS = [
  'section[data-turn="user"], section[data-turn="assistant"]',
  'article[data-turn="user"], article[data-turn="assistant"]',
  '[data-testid^="conversation-turn-"][data-turn]'
] as const;

export const ROLE_FALLBACK_SELECTOR =
  '[data-message-author-role="user"], [data-message-author-role="assistant"]';

export const ASSISTANT_CONTENT_SELECTORS = [
  '.markdown',
  '.prose',
  '[class*="markdown"]'
] as const;

export const USER_CONTENT_SELECTORS = [
  '[data-testid="collapsible-user-message-content"]',
  '.whitespace-pre-wrap'
] as const;

export const GENERATION_CONTROL_SELECTORS = [
  'button[data-testid="stop-button"]',
  'button[aria-label*="Stop"]'
] as const;
