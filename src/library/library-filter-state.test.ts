import { describe, expect, it } from 'vitest';
import type { ArchiveConversation, ArchiveProject } from '../storage/schema';
import type { LibraryRecord } from './search';
import {
  activeLibraryFilterCount,
  filterAndSortLibraryRecords,
  recordMatchesLibraryFilters,
  type LibraryFilterState
} from './library-filter-state';

const project: ArchiveProject = {
  id: 'project:alpha',
  name: 'Alpha',
  folders: [{ id: 'folder:research', name: 'Research' }],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z'
};

function conversation(
  id: string,
  updatedAt: string,
  overrides: Partial<ArchiveConversation> = {}
): ArchiveConversation {
  return {
    id,
    providerId: 'chatgpt',
    providerConversationId: id,
    provisional: false,
    sourceUrl: `https://chatgpt.com/c/${id}`,
    title: id,
    createdAt: updatedAt,
    updatedAt,
    lastObservedAt: updatedAt,
    messageCount: 2,
    recordingState: 'recording',
    recordingStateUpdatedAt: updatedAt,
    ...overrides
  };
}

const records: LibraryRecord[] = [
  {
    conversation: conversation('Newest', '2026-09-18T08:00:00.000Z', {
      projectId: project.id,
      folderId: 'folder:research',
      tags: ['Research']
    }),
    messages: [],
    project
  },
  {
    conversation: conversation('Older', '2026-08-01T08:00:00.000Z', {
      tags: ['Follow Up']
    }),
    messages: [],
    project: undefined
  }
];

const base: LibraryFilterState = {
  providerId: 'all',
  date: 'any',
  projectId: 'all',
  folderId: 'all',
  tag: 'all',
  sort: 'relevance'
};

describe('Library filter state', () => {
  it('combines provider, project, folder and tag filters', () => {
    expect(
      recordMatchesLibraryFilters(records[0]!, {
        ...base,
        providerId: 'chatgpt',
        projectId: project.id,
        folderId: 'folder:research',
        tag: 'research'
      })
    ).toBe(true);

    expect(
      recordMatchesLibraryFilters(records[1]!, {
        ...base,
        projectId: project.id
      })
    ).toBe(false);
  });

  it('filters by rolling date windows using conversation updatedAt', () => {
    const now = Date.parse('2026-09-18T12:00:00.000Z');
    expect(recordMatchesLibraryFilters(records[0]!, { ...base, date: '7d' }, now)).toBe(true);
    expect(recordMatchesLibraryFilters(records[1]!, { ...base, date: '30d' }, now)).toBe(false);
  });

  it('supports explicit Unsorted filtering', () => {
    expect(recordMatchesLibraryFilters(records[1]!, { ...base, projectId: 'unsorted' })).toBe(true);
    expect(recordMatchesLibraryFilters(records[0]!, { ...base, projectId: 'unsorted' })).toBe(false);
  });

  it('sorts newest, oldest and title deterministically', () => {
    expect(filterAndSortLibraryRecords(records, { ...base, sort: 'newest' }).map((r) => r.conversation.id))
      .toEqual(['Newest', 'Older']);
    expect(filterAndSortLibraryRecords(records, { ...base, sort: 'oldest' }).map((r) => r.conversation.id))
      .toEqual(['Older', 'Newest']);
    expect(filterAndSortLibraryRecords(records, { ...base, sort: 'title' }).map((r) => r.conversation.id))
      .toEqual(['Newest', 'Older']);
  });

  it('keeps pinned conversations above unpinned records without losing deterministic sort order', () => {
    const pinnedRecords: LibraryRecord[] = [
      records[0]!,
      {
        ...records[1]!,
        conversation: {
          ...records[1]!.conversation,
          pinnedAt: '2026-09-19T10:00:00.000Z'
        }
      }
    ];

    expect(
      filterAndSortLibraryRecords(pinnedRecords, { ...base, sort: 'newest' }).map(
        (record) => record.conversation.id
      )
    ).toEqual(['Older', 'Newest']);
  });

  it('counts only filters, not sorting, as active constraints', () => {
    expect(activeLibraryFilterCount({ ...base, sort: 'title' })).toBe(0);
    expect(activeLibraryFilterCount({ ...base, providerId: 'chatgpt', date: '7d', sort: 'title' })).toBe(2);
  });
});
