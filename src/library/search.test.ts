import { describe, expect, it } from 'vitest';
import type { ArchiveConversation, ArchiveMessage, ArchiveProject } from '../storage/schema';
import { filterLibraryRecords, matchesLibraryQuery } from './search';

const conversation: ArchiveConversation = {
  id: 'conv1',
  providerId: 'chatgpt',
  providerConversationId: 'provider-1',
  providerKey: 'chatgpt:provider-1',
  provisional: false,
  sourceUrl: 'https://chatgpt.com/c/provider-1',
  title: 'Shopify rebuild notes',
  createdAt: '2026-09-16T10:00:00.000Z',
  updatedAt: '2026-09-16T10:05:00.000Z',
  lastObservedAt: '2026-09-16T10:05:00.000Z',
  messageCount: 1,
  recordingState: 'recording',
  recordingStateUpdatedAt: '2026-09-16T10:00:00.000Z'
};

const message: ArchiveMessage = {
  id: 'm1',
  conversationId: conversation.id,
  providerId: 'chatgpt',
  providerTurnId: 'u1',
  providerMessageId: 'u1',
  role: 'user',
  orderHint: 0,
  plainText: 'Cotton wicks need a valid non-zero price before cutover.',
  markdown: null,
  partial: false,
  contentHash: 'hash',
  firstObservedAt: '2026-09-16T10:01:00.000Z',
  lastObservedAt: '2026-09-16T10:01:00.000Z',
  updatedAt: '2026-09-16T10:01:00.000Z'
};

const activityMessage: ArchiveMessage = {
  ...message,
  id: 'm2',
  providerTurnId: 'a1',
  providerMessageId: 'a1',
  role: 'assistant',
  orderHint: 1,
  plainText: 'Final result',
  modelLabel: 'GPT-5.6 Sol',
  visibleActivities: [
    {
      providerActivityId: 'a1:visible:0:a',
      kind: 'tool',
      text: 'Fetched release branch and checked workflow status',
      orderHint: 0,
      firstObservedAt: '2026-09-16T10:02:00.000Z',
      lastObservedAt: '2026-09-16T10:02:01.000Z'
    }
  ]
};

const record = { conversation, messages: [message], project: undefined };
const activityRecord = { conversation, messages: [activityMessage], project: undefined };

const project: ArchiveProject = {
  id: 'project:storefront',
  name: 'Storefront Redesign',
  folders: [{ id: 'folder:qa', name: 'QA Follow-up' }],
  createdAt: '2026-09-16T09:00:00.000Z',
  updatedAt: '2026-09-16T09:00:00.000Z'
};

const organizedRecord = {
  conversation: {
    ...conversation,
    projectId: project.id,
    folderId: project.folders[0]!.id,
    tags: ['Urgent', 'Visual QA']
  },
  messages: [message],
  project
};

describe('library search', () => {
  it('matches conversation metadata case-insensitively', () => {
    expect(matchesLibraryQuery(record, 'SHOPIFY')).toBe(true);
    expect(matchesLibraryQuery(record, 'provider-1')).toBe(true);
  });

  it('matches captured message text', () => {
    expect(matchesLibraryQuery(record, 'non-zero price')).toBe(true);
    expect(matchesLibraryQuery(record, 'missing phrase')).toBe(false);
  });

  it('matches visible model and work activity text', () => {
    expect(matchesLibraryQuery(activityRecord, 'workflow status')).toBe(true);
    expect(matchesLibraryQuery(activityRecord, 'GPT-5.6 Sol')).toBe(true);
  });

  it('matches project, folder and tag organization metadata', () => {
    expect(matchesLibraryQuery(organizedRecord, 'storefront redesign')).toBe(true);
    expect(matchesLibraryQuery(organizedRecord, 'qa follow-up')).toBe(true);
    expect(matchesLibraryQuery(organizedRecord, 'visual qa')).toBe(true);
    expect(matchesLibraryQuery(organizedRecord, 'urgent')).toBe(true);
    expect(matchesLibraryQuery(record, 'unsorted')).toBe(true);
  });

  it('returns every record for an empty query', () => {
    expect(filterLibraryRecords([record], '')).toHaveLength(1);
  });
});
