import { describe, expect, it } from 'vitest';
import {
  chatGptProviderTurnId,
  inferChatGptContainerRole,
  inferChatGptKeyedRoles,
  inferChatGptTurnRole,
  normalizeVisibleModelLabel,
  parseChatGptConversationId
} from './adapter';
import {
  ASSISTANT_CONTENT_SELECTORS,
  KEYED_TURN_SELECTOR,
  TURN_DISCOVERY_STRATEGIES
} from './selectors';

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


describe('ChatGPT keyed-renderer extraction guards', () => {
  it('uses keyed turns as the semantic discovery container', () => {
    expect(KEYED_TURN_SELECTOR).toBe('[data-turn-key]');
  });

  it('does not treat the assistant role marker as answer content', () => {
    expect(ASSISTANT_CONTENT_SELECTORS).not.toContain(
      '[data-conversation-role="assistant"]'
    );
  });
});


describe('ChatGPT keyed turn role precedence', () => {
  it('prefers a real user bubble over assistant semantic markers in the same keyed container', () => {
    expect(
      inferChatGptContainerRole({
        userMessageBubblePresent: true,
        explicitAssistantPresent: true
      })
    ).toBe('user');
  });

  it('prefers explicit user evidence over assistant evidence', () => {
    expect(
      inferChatGptContainerRole({
        explicitUserPresent: true,
        explicitAssistantPresent: true
      })
    ).toBe('user');
  });

  it('uses assistant only when no user signal is present', () => {
    expect(
      inferChatGptContainerRole({
        explicitAssistantPresent: true
      })
    ).toBe('assistant');
  });

  it('keeps a direct shell role authoritative', () => {
    expect(
      inferChatGptContainerRole({
        directRole: 'assistant',
        userMessageBubblePresent: true
      })
    ).toBe('assistant');
  });

  it('returns null when the keyed container has no recognized role signal', () => {
    expect(inferChatGptContainerRole({})).toBeNull();
  });
});


describe('ChatGPT grouped keyed exchange contract', () => {
  it('emits both logical roles when one keyed exchange contains user and assistant signals', () => {
    expect(
      inferChatGptKeyedRoles({
        userMessageBubblePresent: true,
        assistantRolePresent: true,
        assistantStartPresent: true,
        assistantContentUnitPresent: true,
        assistantMessageBodyPresent: true
      })
    ).toEqual(['user', 'assistant']);
  });

  it('emits only user when the assistant half is not mounted yet', () => {
    expect(
      inferChatGptKeyedRoles({
        userMessageBubblePresent: true
      })
    ).toEqual(['user']);
  });

  it('emits assistant when only the assistant half is mounted', () => {
    expect(
      inferChatGptKeyedRoles({
        assistantMessageBodyPresent: true
      })
    ).toEqual(['assistant']);
  });

  it('assigns different stable IDs to user and assistant halves of one keyed exchange', () => {
    const key = 'exchange-123';
    expect(
      chatGptProviderTurnId({
        role: 'user',
        turnKey: key,
        index: 0
      })
    ).toBe('group:user:exchange-123');
    expect(
      chatGptProviderTurnId({
        role: 'assistant',
        turnKey: key,
        index: 1
      })
    ).toBe('group:assistant:exchange-123');
  });

  it('falls back through legacy stable IDs before DOM order', () => {
    expect(
      chatGptProviderTurnId({
        role: 'assistant',
        turnId: 'legacy-turn',
        providerMessageId: 'message-id',
        testId: 'conversation-turn-1',
        index: 4
      })
    ).toBe('legacy-turn');

    expect(
      chatGptProviderTurnId({
        role: 'assistant',
        providerMessageId: 'message-id',
        testId: 'conversation-turn-1',
        index: 4
      })
    ).toBe('message-id');
  });
});
