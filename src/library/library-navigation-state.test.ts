import { describe, expect, it } from 'vitest';
import type { ArchiveCheckpoint } from '../storage/checkpoints';
import type { ArchiveConversation, ArchiveProject } from '../storage/schema';
import type { LibraryRecord } from './search';
import {
  buildNavigationFacets,
  navigationSection,
  navigationScopeProjectId,
  recordMatchesNavigationScope
} from './library-navigation-state';

const project: ArchiveProject = {
  id: 'project:alpha',
  name: 'Alpha',
  folders: [
    { id: 'folder:research', name: 'Research' },
    { id: 'folder:empty', name: 'Empty' }
  ],
  createdAt: '2026-09-18T00:00:00.000Z',
  updatedAt: '2026-09-18T00:00:00.000Z'
};

function conversation(id: string, overrides: Partial<ArchiveConversation> = {}): ArchiveConversation {
  return {
    id,
    providerId: 'chatgpt',
    providerConversationId: id,
    provisional: false,
    sourceUrl: `https://chatgpt.com/c/${id}`,
    title: id,
    createdAt: '2026-09-18T00:00:00.000Z',
    updatedAt: '2026-09-18T00:00:00.000Z',
    lastObservedAt: '2026-09-18T00:00:00.000Z',
    messageCount: 2,
    recordingState: 'recording',
    recordingStateUpdatedAt: '2026-09-18T00:00:00.000Z',
    ...overrides
  };
}

const checkpoint: ArchiveCheckpoint = {
  id: 'checkpoint:1',
  conversationId: 'organized',
  name: 'Decision',
  note: null,
  createdAt: '2026-09-18T00:01:00.000Z',
  updatedAt: '2026-09-18T00:01:00.000Z'
};

const records: LibraryRecord[] = [
  {
    conversation: conversation('organized', {
      projectId: project.id,
      folderId: 'folder:research',
      tags: ['Research', 'Follow Up']
    }),
    messages: [],
    project,
    checkpoints: [checkpoint]
  },
  {
    conversation: conversation('unsorted', { tags: ['research'] }),
    messages: [],
    project: undefined,
    checkpoints: []
  },
  {
    conversation: conversation('archived', {
      archivedAt: '2026-09-18T01:00:00.000Z',
      projectId: project.id,
      tags: ['Archived only']
    }),
    messages: [],
    project,
    checkpoints: []
  }
];

describe('Library navigation state', () => {
  it('matches real archive scopes without mixing archived conversations into active views', () => {
    expect(records.filter((record) => recordMatchesNavigationScope(record, { kind: 'library' }))).toHaveLength(2);
    expect(records.filter((record) => recordMatchesNavigationScope(record, { kind: 'archived' }))).toHaveLength(1);
    expect(records.filter((record) => recordMatchesNavigationScope(record, { kind: 'unsorted' }))).toHaveLength(1);
    expect(records.filter((record) => recordMatchesNavigationScope(record, { kind: 'project', projectId: project.id }))).toHaveLength(1);
    expect(records.filter((record) => recordMatchesNavigationScope(record, {
      kind: 'folder',
      projectId: project.id,
      folderId: 'folder:research'
    }))).toHaveLength(1);
    expect(records.filter((record) => recordMatchesNavigationScope(record, { kind: 'tag', tag: 'RESEARCH' }))).toHaveLength(2);
    expect(records.filter((record) => recordMatchesNavigationScope(record, { kind: 'checkpoints' }))).toHaveLength(1);
  });

  it('builds project, folder, tag and checkpoint facets from active archive data', () => {
    const facets = buildNavigationFacets(records, [project]);
    expect(facets.unsortedCount).toBe(1);
    expect(facets.projects).toEqual([{ id: project.id, name: 'Alpha', count: 1 }]);
    expect(facets.folders).toEqual([
      { id: 'folder:research', projectId: project.id, name: 'Alpha / Research', count: 1 },
      { id: 'folder:empty', projectId: project.id, name: 'Alpha / Empty', count: 0 }
    ]);
    expect(facets.tags).toEqual([
      { id: 'follow up', name: 'Follow Up', count: 1 },
      { id: 'research', name: 'Research', count: 2 }
    ]);
    expect(facets.checkpointCount).toBe(1);
  });

  it('maps scoped selections back to the correct Browse section and project selector', () => {
    expect(navigationSection({ kind: 'folder', projectId: project.id, folderId: 'folder:research' })).toBe('folders');
    expect(navigationSection({ kind: 'tag', tag: 'Research' })).toBe('tags');
    expect(navigationScopeProjectId({ kind: 'project', projectId: project.id })).toBe(project.id);
    expect(navigationScopeProjectId({ kind: 'tag', tag: 'Research' })).toBe('all');
  });
});
