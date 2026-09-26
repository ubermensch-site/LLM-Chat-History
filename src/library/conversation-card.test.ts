import { describe, expect, it } from 'vitest';
import type { ArchiveConversation, ArchiveMessage } from '../storage/schema';
import {
  conversationPreview,
  conversationStatusLabel,
  providerDisplayName,
  relativeConversationTime
} from './conversation-card';

function message(overrides: Partial<ArchiveMessage>): ArchiveMessage {
  return {
    id: 'm1',
    conversationId: 'c1',
    providerId: 'chatgpt',
    providerTurnId: 'turn-1',
    providerMessageId: null,
    role: 'user',
    orderHint: 1,
    plainText: 'Hello',
    markdown: null,
    partial: false,
    contentHash: 'hash',
    firstObservedAt: '2026-09-18T00:00:00.000Z',
    lastObservedAt: '2026-09-18T00:00:00.000Z',
    updatedAt: '2026-09-18T00:00:00.000Z',
    ...overrides
  };
}

function conversation(overrides: Partial<ArchiveConversation>): ArchiveConversation {
  return {
    id: 'c1',
    providerId: 'chatgpt',
    providerConversationId: 'provider-c1',
    provisional: false,
    sourceUrl: 'https://chatgpt.com/c/provider-c1',
    title: 'Example',
    createdAt: '2026-09-18T00:00:00.000Z',
    updatedAt: '2026-09-18T00:00:00.000Z',
    lastObservedAt: '2026-09-18T00:00:00.000Z',
    messageCount: 2,
    recordingState: 'stopped',
    recordingStateUpdatedAt: '2026-09-18T00:00:00.000Z',
    ...overrides
  };
}

describe('conversation card presentation', () => {
  it('uses the latest non-empty message and prefers Markdown-aware spacing', () => {
    const preview = conversationPreview([
      message({ plainText: 'First prompt', role: 'user' }),
      message({
        id: 'm2',
        role: 'assistant',
        plainText: 'A usefulanswerwith spacing.',
        markdown: 'A useful\n\n## answer\n\nwith **spacing**.'
      })
    ]);

    expect(preview).toEqual({ role: 'Assistant', text: 'A useful answer with spacing.' });
  });

  it('falls back to plain text when Markdown is present but empty', () => {
    const preview = conversationPreview([
      message({ role: 'assistant', markdown: '', plainText: 'Fallback assistant preview' })
    ]);

    expect(preview).toEqual({
      role: 'Assistant',
      text: 'Fallback assistant preview'
    });
  });

  it('truncates long previews without exposing extra content', () => {
    const preview = conversationPreview([message({ plainText: 'abcdefghijklmnopqrstuvwxyz' })], 10);
    expect(preview).toEqual({ role: 'You', text: 'abcdefghi…' });
  });

  it('returns an explicit empty preview when no captured text exists', () => {
    expect(conversationPreview([message({ plainText: '   ' })])).toEqual({
      role: null,
      text: 'No captured message text yet.'
    });
  });

  it('formats recent timestamps compactly', () => {
    const now = Date.parse('2026-09-18T01:00:00.000Z');
    expect(relativeConversationTime('2026-09-18T00:59:45.000Z', now)).toBe('Now');
    expect(relativeConversationTime('2026-09-18T00:48:00.000Z', now)).toBe('12m ago');
    expect(relativeConversationTime('2026-09-17T22:00:00.000Z', now)).toBe('3h ago');
    expect(relativeConversationTime('2026-09-16T01:00:00.000Z', now)).toBe('2d ago');
  });

  it('only surfaces meaningful recorder status metadata', () => {
    expect(conversationStatusLabel(conversation({ provisional: true, recordingState: 'recording' }))).toBe('Capturing');
    expect(conversationStatusLabel(conversation({ recordingState: 'recording' }))).toBe('Recording');
    expect(conversationStatusLabel(conversation({ recordingState: 'paused' }))).toBe('Paused');
    expect(conversationStatusLabel(conversation({ recordingState: 'error' }))).toBe('Recording issue');
    expect(conversationStatusLabel(conversation({ recordingState: 'stopped' }))).toBeNull();
  });

  it('uses product-facing provider names', () => {
    expect(providerDisplayName('chatgpt')).toBe('ChatGPT');
    expect(providerDisplayName('claude' as ArchiveConversation['providerId'])).toBe('Claude');
    expect(providerDisplayName('gemini' as ArchiveConversation['providerId'])).toBe('Gemini');
    expect(providerDisplayName('grok' as ArchiveConversation['providerId'])).toBe('Grok');
  });
});
