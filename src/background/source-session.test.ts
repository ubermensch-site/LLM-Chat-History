import { describe, expect, it } from 'vitest';
import {
  shouldRejectSupersededProvisional,
  stableSourceSessionId
} from './source-session';

describe('background source-session routing', () => {
  it('keeps browser-tab-scoped source identity stable across document replacement', () => {
    expect(stableSourceSessionId('old-document', 77)).toBe('tab:77');
    expect(stableSourceSessionId('new-document', 77)).toBe('tab:77');
    expect(stableSourceSessionId('content-only', undefined)).toBe('content-only');
  });

  it('rejects a delayed provisional observation once the current tab is stable', () => {
    expect(
      shouldRejectSupersededProvisional(
        null,
        'https://chatgpt.com/',
        'https://chatgpt.com/c/stable-conversation'
      )
    ).toBe(true);
  });

  it('does not reject stable A-to-B observations', () => {
    expect(
      shouldRejectSupersededProvisional(
        'conversation-a',
        'https://chatgpt.com/c/conversation-a',
        'https://chatgpt.com/c/conversation-b'
      )
    ).toBe(false);
  });

  it('does not reject a genuinely later New Chat', () => {
    expect(
      shouldRejectSupersededProvisional(null, 'https://chatgpt.com/', 'https://chatgpt.com/')
    ).toBe(false);
  });

  it('fails open when current tab URL is unavailable or unrelated', () => {
    expect(shouldRejectSupersededProvisional(null, 'https://chatgpt.com/', undefined)).toBe(false);
    expect(
      shouldRejectSupersededProvisional(null, 'https://chatgpt.com/', 'chrome://extensions/')
    ).toBe(false);
  });
});
