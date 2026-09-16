import { describe, expect, it } from 'vitest';
import {
  isTransientAssistantStatusText,
  parseChatGptConversationId,
  shouldArchiveChatGptTurn
} from './adapter';

describe('parseChatGptConversationId', () => {
  it('reads a standard ChatGPT conversation id', () => {
    expect(parseChatGptConversationId(new URL('https://chatgpt.com/c/abc-123'))).toBe('abc-123');
  });

  it('reads a conversation id from a nested ChatGPT path', () => {
    expect(parseChatGptConversationId(new URL('https://chatgpt.com/g/example/c/abc-123'))).toBe('abc-123');
  });

  it('returns null before a new chat receives a conversation id', () => {
    expect(parseChatGptConversationId(new URL('https://chatgpt.com/'))).toBeNull();
  });
});

describe('transient assistant transport status filtering', () => {
  it('recognizes the exact live ChatGPT connection-interrupted status', () => {
    expect(
      isTransientAssistantStatusText('Connection interrupted. Waiting for the complete answer')
    ).toBe(true);
  });

  it('normalizes whitespace and harmless terminal punctuation', () => {
    expect(
      isTransientAssistantStatusText('  Connection interrupted.\nWaiting for the complete answer.  ')
    ).toBe(true);
  });

  it('does not classify normal assistant prose that merely contains the status words', () => {
    expect(
      isTransientAssistantStatusText(
        'If you see “Connection interrupted. Waiting for the complete answer”, refresh the page.'
      )
    ).toBe(false);
  });

  it('filters the status only when it is an assistant turn', () => {
    const status = 'Connection interrupted. Waiting for the complete answer';
    expect(shouldArchiveChatGptTurn('assistant', status)).toBe(false);
    expect(shouldArchiveChatGptTurn('user', status)).toBe(true);
  });

  it('continues to archive unrelated assistant error-like prose', () => {
    expect(
      shouldArchiveChatGptTurn('assistant', 'The connection interrupted our example, but here is the answer.')
    ).toBe(true);
  });
});
