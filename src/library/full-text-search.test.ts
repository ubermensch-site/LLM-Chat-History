import { describe, expect, it } from 'vitest';
import type {
  ArchiveConversation,
  ArchiveMessage,
  ArchiveProject
} from '../storage/schema';
import type { LibraryRecord } from './search';
import { searchLibraryRecords } from './full-text-search';

const project: ArchiveProject = {
  id: 'project:research',
  name: 'Research Project',
  folders: [{ id: 'folder:sources', name: 'Primary Sources' }],
  createdAt: '2026-09-16T10:00:00.000Z',
  updatedAt: '2026-09-16T10:00:00.000Z'
};

const conversation: ArchiveConversation = {
  id: 'conv:chatgpt:search',
  providerId: 'chatgpt',
  providerConversationId: 'provider-search',
  providerKey: 'chatgpt:provider-search',
  provisional: false,
  sourceUrl: 'https://chatgpt.com/c/provider-search',
  title: 'Provider research title',
  customTitle: 'Storefront Investigation',
  projectId: project.id,
  folderId: project.folders[0]!.id,
  tags: ['Urgent', 'Evidence'],
  createdAt: '2026-09-16T10:01:00.000Z',
  updatedAt: '2026-09-16T10:10:00.000Z',
  lastObservedAt: '2026-09-16T10:10:00.000Z',
  messageCount: 2,
  recordingState: 'recording',
  recordingStateUpdatedAt: '2026-09-16T10:01:00.000Z'
};

const messages: ArchiveMessage[] = [
  {
    id: `${conversation.id}:turn:user-1`,
    conversationId: conversation.id,
    providerId: 'chatgpt',
    providerTurnId: 'user-1',
    providerMessageId: 'user-1',
    role: 'user',
    orderHint: 0,
    plainText: 'Please investigate the broken checkout button on mobile.',
    markdown: null,
    partial: false,
    contentHash: 'user-hash',
    firstObservedAt: '2026-09-16T10:02:00.000Z',
    lastObservedAt: '2026-09-16T10:02:00.000Z',
    updatedAt: '2026-09-16T10:02:00.000Z'
  },
  {
    id: `${conversation.id}:turn:assistant-1`,
    conversationId: conversation.id,
    providerId: 'chatgpt',
    providerTurnId: 'assistant-1',
    providerMessageId: 'assistant-1',
    role: 'assistant',
    orderHint: 1,
    plainText:
      'The mobile checkout button is hidden by a fixed footer. The evidence points to a stacking context issue.',
    markdown: null,
    partial: false,
    modelLabel: 'GPT-5.6 Sol',
    visibleActivities: [
      {
        providerActivityId: 'assistant-1:visible:0:a',
        kind: 'reasoning-summary',
        text: 'Thinking about the mobile layout',
        orderHint: 0,
        firstObservedAt: '2026-09-16T10:02:30.000Z',
        lastObservedAt: '2026-09-16T10:02:31.000Z'
      },
      {
        providerActivityId: 'assistant-1:visible:1:b',
        kind: 'tool',
        text: 'Fetched storefront stylesheet and checked workflow status',
        orderHint: 1,
        firstObservedAt: '2026-09-16T10:02:40.000Z',
        lastObservedAt: '2026-09-16T10:02:41.000Z'
      }
    ],
    contentHash: 'assistant-hash',
    firstObservedAt: '2026-09-16T10:03:00.000Z',
    lastObservedAt: '2026-09-16T10:03:00.000Z',
    updatedAt: '2026-09-16T10:03:00.000Z'
  }
];

const record: LibraryRecord = { conversation, messages, project };

const unsortedConversation: ArchiveConversation = {
  ...conversation,
  id: 'conv:chatgpt:loose',
  providerConversationId: 'provider-loose',
  providerKey: 'chatgpt:provider-loose',
  sourceUrl: 'https://chatgpt.com/c/provider-loose',
  customTitle: 'Loose notes',
  updatedAt: '2026-09-16T09:00:00.000Z'
};
delete unsortedConversation.projectId;
delete unsortedConversation.folderId;
delete unsortedConversation.tags;
const unsorted: LibraryRecord = {
  conversation: unsortedConversation,
  messages: [],
  project: undefined
};

describe('full-text Library search', () => {
  it('returns conversation-level matches for title, project, folder and tags', () => {
    expect(searchLibraryRecords([record], 'STOREFRONT')[0]).toMatchObject({
      kind: 'conversation',
      field: 'title',
      conversationId: conversation.id
    });
    expect(searchLibraryRecords([record], 'research project')[0]?.field).toBe('project');
    expect(searchLibraryRecords([record], 'primary sources')[0]?.field).toBe('folder');
    expect(searchLibraryRecords([record], 'urgent')[0]?.field).toBe('tag');
  });

  it('returns the specific matching message with a concise context snippet', () => {
    const results = searchLibraryRecords([record], 'stacking context');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      kind: 'message',
      field: 'message',
      conversationId: conversation.id,
      messageId: messages[1]!.id,
      orderHint: 1
    });
    expect(results[0]?.snippet).toContain('stacking context');
  });

  it('finds model labels and visible work even when the final answer does not contain them', () => {
    const workResults = searchLibraryRecords([record], 'workflow status');
    expect(workResults).toHaveLength(1);
    expect(workResults[0]).toMatchObject({
      kind: 'message',
      messageId: messages[1]!.id,
      field: 'message'
    });
    expect(workResults[0]?.snippet).toContain('workflow status');

    const modelResults = searchLibraryRecords([record], 'GPT-5.6 Sol');
    expect(modelResults).toHaveLength(1);
    expect(modelResults[0]?.messageId).toBe(messages[1]!.id);
  });

  it('ranks metadata matches ahead of message-body matches deterministically', () => {
    const results = searchLibraryRecords([record], 'evidence');
    expect(results.map((result) => result.kind)).toEqual(['conversation', 'message']);
    expect(results[0]?.field).toBe('tag');
    expect(results[1]?.messageId).toBe(messages[1]!.id);
  });

  it('treats missing project assignment as searchable Unsorted metadata', () => {
    const results = searchLibraryRecords([unsorted], 'unsorted');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ kind: 'conversation', field: 'project' });
  });

  it('returns no results for a blank query', () => {
    expect(searchLibraryRecords([record], '   ')).toEqual([]);
  });
});
