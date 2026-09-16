import { describe, expect, it } from 'vitest';
import { parseChatGptConversationId } from './adapter';

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
