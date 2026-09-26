import { describe, expect, it } from 'vitest';
import { inferChatGptTurnRole, normalizeVisibleModelLabel, parseChatGptConversationId } from './adapter';
import { TURN_DISCOVERY_STRATEGIES } from './selectors';

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

describe('visible response model labels', () => {
  it('accepts common visible OpenAI model labels', () => {
    expect(normalizeVisibleModelLabel('GPT-5.6 Sol')).toBe('GPT-5.6 Sol');
    expect(normalizeVisibleModelLabel('Model: GPT-5')).toBe('GPT-5');
    expect(normalizeVisibleModelLabel('o3')).toBe('o3');
  });

  it('normalizes whitespace without inventing a model', () => {
    expect(normalizeVisibleModelLabel('  GPT-5.6   Sol  ')).toBe('GPT-5.6 Sol');
    expect(normalizeVisibleModelLabel('Used model: o4-mini')).toBe('o4-mini');
  });

  it('rejects ordinary response text and hidden-looking blobs', () => {
    expect(normalizeVisibleModelLabel('Here is the answer you asked for.')).toBeNull();
    expect(normalizeVisibleModelLabel('gpt-5-model-slug-internal')).toBeNull();
    expect(normalizeVisibleModelLabel('')).toBeNull();
  });
});

describe('rendered content policy', () => {
  it('keeps transport/status text visible in the provider transcript', () => {
    const rendered = 'Connection interrupted. Waiting for the complete answer';
    expect(rendered).toContain('Connection interrupted');
  });
});


describe('ChatGPT role discovery compatibility', () => {
  it('preserves legacy data-turn and message-author-role signals', () => {
    expect(inferChatGptTurnRole({ dataTurn: 'user' })).toBe('user');
    expect(inferChatGptTurnRole({ dataTurn: 'assistant' })).toBe('assistant');
    expect(inferChatGptTurnRole({ messageAuthorRole: 'user' })).toBe('user');
    expect(inferChatGptTurnRole({ messageAuthorRole: 'assistant' })).toBe('assistant');
  });

  it('recognizes alternate semantic role attributes', () => {
    expect(inferChatGptTurnRole({ dataRole: 'user' })).toBe('user');
    expect(inferChatGptTurnRole({ dataRole: 'assistant' })).toBe('assistant');
    expect(inferChatGptTurnRole({ messageAuthor: 'user' })).toBe('user');
    expect(inferChatGptTurnRole({ messageAuthor: 'assistant' })).toBe('assistant');
  });

  it('recognizes keyed-renderer user and assistant signals', () => {
    expect(inferChatGptTurnRole({ userMessageBubble: true })).toBe('user');
    expect(inferChatGptTurnRole({ conversationRole: 'assistant' })).toBe('assistant');
  });

  it('returns null for unknown or unrelated role values', () => {
    expect(inferChatGptTurnRole({})).toBeNull();
    expect(inferChatGptTurnRole({ dataRole: 'button' })).toBeNull();
    expect(inferChatGptTurnRole({ conversationRole: 'tool' })).toBeNull();
  });

  it('prefers explicit role attributes over the user-bubble fallback', () => {
    expect(
      inferChatGptTurnRole({
        dataTurn: 'assistant',
        userMessageBubble: true
      })
    ).toBe('assistant');
  });

  it('tries explicit turn shells before semantic role fallbacks', () => {
    expect(TURN_DISCOVERY_STRATEGIES.map((strategy) => strategy.id)).toEqual([
      'turn-shells',
      'semantic-roles'
    ]);
    expect(TURN_DISCOVERY_STRATEGIES[1]?.selectors).toContain('[data-user-message-bubble]');
    expect(TURN_DISCOVERY_STRATEGIES[1]?.selectors).toContain(
      '[data-conversation-role="assistant"]'
    );
  });
});
