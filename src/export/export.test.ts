import { describe, expect, it } from 'vitest';
import type { ArchiveConversation, ArchiveEvent, ArchiveMessage } from '../storage/schema';
import { exportFilename, renderJsonExport, renderMarkdownExport } from './export';

const conversation: ArchiveConversation = {
  id: 'conv:chatgpt:internal',
  providerId: 'chatgpt',
  providerConversationId: 'provider-123',
  providerKey: 'chatgpt:provider-123',
  provisional: false,
  sourceUrl: 'https://chatgpt.com/c/provider-123',
  title: 'SabPuja / Shopify: Rebuild?',
  createdAt: '2026-09-16T10:00:00.000Z',
  updatedAt: '2026-09-16T10:10:00.000Z',
  lastObservedAt: '2026-09-16T10:10:00.000Z',
  messageCount: 2,
  recordingState: 'recording',
  recordingStateUpdatedAt: '2026-09-16T10:05:00.000Z'
};

const messages: ArchiveMessage[] = [
  {
    id: 'm1',
    conversationId: conversation.id,
    providerId: 'chatgpt',
    providerTurnId: 'u1',
    providerMessageId: 'u1',
    role: 'user',
    orderHint: 0,
    plainText: 'Hello',
    markdown: 'Hello',
    partial: false,
    contentHash: 'h1',
    firstObservedAt: '2026-09-16T10:01:00.000Z',
    lastObservedAt: '2026-09-16T10:01:00.000Z',
    updatedAt: '2026-09-16T10:01:00.000Z'
  },
  {
    id: 'm2',
    conversationId: conversation.id,
    providerId: 'chatgpt',
    providerTurnId: 'a1',
    providerMessageId: 'a1',
    role: 'assistant',
    orderHint: 1,
    plainText: 'Answer',
    markdown: '**Answer**',
    partial: false,
    modelLabel: 'GPT-5.6 Sol',
    contentHash: 'h2',
    firstObservedAt: '2026-09-16T10:06:00.000Z',
    lastObservedAt: '2026-09-16T10:06:00.000Z',
    updatedAt: '2026-09-16T10:06:00.000Z'
  }
];

const events: ArchiveEvent[] = [
  {
    id: 'e1',
    conversationId: conversation.id,
    type: 'recording-paused',
    createdAt: '2026-09-16T10:03:00.000Z',
    data: { from: 'recording', to: 'paused' }
  },
  {
    id: 'suppressed',
    conversationId: conversation.id,
    type: 'turn-suppressed',
    createdAt: '2026-09-16T10:04:00.000Z',
    data: { providerTurnId: 'private-turn', reason: 'paused' }
  },
  {
    id: 'e2',
    conversationId: conversation.id,
    type: 'recording-resumed',
    createdAt: '2026-09-16T10:05:00.000Z',
    data: { from: 'paused', to: 'recording' }
  }
];

describe('archive export', () => {
  it('renders readable Markdown with state boundaries and visible model labels', () => {
    const markdown = renderMarkdownExport({
      conversation,
      messages,
      events,
      exportedAt: '2026-09-16T11:00:00.000Z'
    });

    expect(markdown).toContain('# SabPuja / Shopify: Rebuild?');
    expect(markdown).toContain('## User');
    expect(markdown).toContain('## Assistant');
    expect(markdown).toContain('**Answer**');
    expect(markdown).toContain('**Model shown by provider:** GPT-5.6 Sol');
    expect(markdown).toContain('Recording paused');
    expect(markdown).toContain('Recording resumed');
    expect(markdown).not.toContain('private-turn');
  });

  it('exports normalized JSON including schema metadata and visible model labels', () => {
    const json = JSON.parse(
      renderJsonExport({
        conversation,
        messages,
        events,
        exportedAt: '2026-09-16T11:00:00.000Z'
      })
    ) as { schema: string; schemaVersion: number; messages: ArchiveMessage[] };

    expect(json.schema).toBe('llm-chat-history/archive-export');
    expect(json.schemaVersion).toBe(1);
    expect(Array.isArray(json.messages)).toBe(true);
    expect(json.messages[1]?.modelLabel).toBe('GPT-5.6 Sol');
  });

  it('builds deterministic filesystem-safe filenames', () => {
    expect(exportFilename(conversation, 'md')).toBe(
      '2026-09-16T10-00-00-000Z__chatgpt__sabpuja-shopify-rebuild.md'
    );
  });
});
