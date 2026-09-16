import { describe, expect, it } from 'vitest';
import {
  exportFilename,
  renderJsonExport,
  renderMarkdownExport,
  type ArchiveExportBundle
} from '../export/export';
import { parseJsonArchiveExport } from '../import/json-import';
import { conversationDisplayTitle } from '../storage/conversation';
import { messageId } from '../storage/ids';
import type { ArchiveConversation, ArchiveMessage } from '../storage/schema';
import { matchesLibraryQuery } from './search';

function managedBundle(): ArchiveExportBundle {
  const conversation: ArchiveConversation = {
    id: 'conv:chatgpt:managed',
    providerId: 'chatgpt',
    providerConversationId: 'provider-managed',
    providerKey: 'chatgpt:provider-managed',
    provisional: false,
    sourceUrl: 'https://chatgpt.com/c/provider-managed',
    title: 'Provider title',
    customTitle: 'My research notes',
    archivedAt: '2026-09-16T17:05:00.000Z',
    createdAt: '2026-09-16T17:00:00.000Z',
    updatedAt: '2026-09-16T17:05:00.000Z',
    lastObservedAt: '2026-09-16T17:04:00.000Z',
    messageCount: 1,
    recordingState: 'recording',
    recordingStateUpdatedAt: '2026-09-16T17:00:00.000Z'
  };
  const message: ArchiveMessage = {
    id: messageId(conversation.id, 'user-1'),
    conversationId: conversation.id,
    providerId: 'chatgpt',
    providerTurnId: 'user-1',
    providerMessageId: 'user-1',
    role: 'user',
    orderHint: 0,
    plainText: 'A captured question',
    markdown: 'A captured question',
    partial: false,
    contentHash: 'hash',
    firstObservedAt: '2026-09-16T17:01:00.000Z',
    lastObservedAt: '2026-09-16T17:01:00.000Z',
    updatedAt: '2026-09-16T17:01:00.000Z'
  };
  return {
    conversation,
    messages: [message],
    events: [],
    exportedAt: '2026-09-16T18:00:00.000Z'
  };
}

describe('Library management metadata', () => {
  it('uses the custom title for display, search and human-readable export names', () => {
    const bundle = managedBundle();
    expect(conversationDisplayTitle(bundle.conversation)).toBe('My research notes');
    expect(matchesLibraryQuery({ conversation: bundle.conversation, messages: bundle.messages }, 'research notes')).toBe(true);
    expect(renderMarkdownExport(bundle)).toContain('# My research notes');
    expect(exportFilename(bundle.conversation, 'md')).toContain('my-research-notes.md');
  });

  it('round-trips custom title and archive state through JSON backup restore', () => {
    const bundle = managedBundle();
    const restored = parseJsonArchiveExport(renderJsonExport(bundle));
    expect(restored.conversation.customTitle).toBe('My research notes');
    expect(restored.conversation.archivedAt).toBe('2026-09-16T17:05:00.000Z');
    expect(restored).toEqual(bundle);
  });
});
