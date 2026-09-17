import { describe, expect, it } from 'vitest';
import {
  isStaleProvisionalObservationForCurrentTab,
  stableChatConversationIdFromUrl,
  stableSourceSessionId
} from './source-session';

describe('background source-session helpers', () => {
  it('keeps one source session per browser tab across content-script reloads', () => {
    expect(stableSourceSessionId('before', 77)).toBe('tab:77');
    expect(stableSourceSessionId('after', 77)).toBe('tab:77');
    expect(stableSourceSessionId('fallback', undefined)).toBe('fallback');
  });

  it('extracts only explicit ChatGPT conversation routes', () => {
    expect(stableChatConversationIdFromUrl('https://chatgpt.com/c/abc-123')).toBe('abc-123');
    expect(stableChatConversationIdFromUrl('https://chat.openai.com/c/legacy-123?x=1')).toBe('legacy-123');
    expect(stableChatConversationIdFromUrl('https://chatgpt.com/')).toBeNull();
    expect(stableChatConversationIdFromUrl('https://chatgpt.com/?model=auto')).toBeNull();
    expect(stableChatConversationIdFromUrl('https://example.com/c/not-chatgpt')).toBeNull();
    expect(stableChatConversationIdFromUrl('not a url')).toBeNull();
  });

  it('rejects a provisional observation when the browser tab is already on a stable chat', () => {
    expect(
      isStaleProvisionalObservationForCurrentTab(null, 'https://chatgpt.com/c/stable-chat')
    ).toBe(true);
    expect(
      isStaleProvisionalObservationForCurrentTab('stable-chat', 'https://chatgpt.com/c/stable-chat')
    ).toBe(false);
  });

  it('allows a real new-chat provisional observation while the browser tab is on home', () => {
    expect(isStaleProvisionalObservationForCurrentTab(null, 'https://chatgpt.com/')).toBe(false);
    expect(isStaleProvisionalObservationForCurrentTab(null, undefined)).toBe(false);
  });
});
