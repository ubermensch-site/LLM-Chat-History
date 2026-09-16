import { describe, expect, it } from 'vitest';
import { normalizeVisibleModelLabel, parseChatGptConversationId } from './adapter';

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
