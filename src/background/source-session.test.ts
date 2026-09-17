import { describe, expect, it, vi } from 'vitest';
import {
  authoritativeCurrentTabUrl,
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

  it('uses the live tab URL instead of a stale sender document URL', async () => {
    const lookup = vi.fn(async () => ({ url: 'https://chatgpt.com/c/stable-chat' }));
    const currentUrl = await authoritativeCurrentTabUrl(
      77,
      'https://chatgpt.com/',
      lookup
    );

    expect(lookup).toHaveBeenCalledWith(77);
    expect(currentUrl).toBe('https://chatgpt.com/c/stable-chat');
    expect(isStaleProvisionalObservationForCurrentTab(null, currentUrl)).toBe(true);
  });

  it('prefers a pending navigation URL over the committed tab URL', async () => {
    const currentUrl = await authoritativeCurrentTabUrl(
      78,
      'https://chatgpt.com/',
      async () => ({
        url: 'https://chatgpt.com/',
        pendingUrl: 'https://chatgpt.com/c/pending-stable-chat'
      })
    );

    expect(currentUrl).toBe('https://chatgpt.com/c/pending-stable-chat');
    expect(isStaleProvisionalObservationForCurrentTab(null, currentUrl)).toBe(true);
  });

  it('falls back to the sender URL when the live tab lookup fails', async () => {
    const currentUrl = await authoritativeCurrentTabUrl(
      79,
      'https://chatgpt.com/',
      async () => {
        throw new Error('tab disappeared');
      }
    );

    expect(currentUrl).toBe('https://chatgpt.com/');
  });

  it('does not perform a live lookup when there is no browser tab id', async () => {
    const lookup = vi.fn(async () => ({ url: 'https://chatgpt.com/c/should-not-be-read' }));
    const currentUrl = await authoritativeCurrentTabUrl(
      undefined,
      'https://chatgpt.com/',
      lookup
    );

    expect(currentUrl).toBe('https://chatgpt.com/');
    expect(lookup).not.toHaveBeenCalled();
  });
});
