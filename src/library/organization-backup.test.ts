import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { renderJsonExport, renderMarkdownExport, type ArchiveExportBundle } from '../export/export';
import { parseJsonArchiveExport } from '../import/json-import';
import { ArchiveRepository } from '../storage/archive';
import { openArchiveDb, requestToPromise } from '../storage/db';
import { importArchiveBundle } from '../storage/import';
import { messageId } from '../storage/ids';
import { listProjects } from '../storage/projects';
import type { ArchiveConversation, ArchiveMessage, ArchiveProject } from '../storage/schema';
import { matchesLibraryQuery } from './search';

const databaseNames: string[] = [];

function bundle(): ArchiveExportBundle {
  const project: ArchiveProject = {
    id: 'project:research',
    name: 'Research Project',
    folders: [{ id: 'folder:sources', name: 'Primary Sources' }],
    createdAt: '2026-09-16T19:00:00.000Z',
    updatedAt: '2026-09-16T19:01:00.000Z'
  };
  const conversation: ArchiveConversation = {
    id: 'conv:chatgpt:organized',
    providerId: 'chatgpt',
    providerConversationId: 'organized-provider',
    providerKey: 'chatgpt:organized-provider',
    provisional: false,
    sourceUrl: 'https://chatgpt.com/c/organized-provider',
    title: 'Provider title',
    projectId: project.id,
    folderId: project.folders[0]!.id,
    tags: ['Evidence', 'Urgent'],
    favoriteAt: '2026-09-16T19:03:30.000Z',
    pinnedAt: '2026-09-16T19:03:45.000Z',
    createdAt: '2026-09-16T19:02:00.000Z',
    updatedAt: '2026-09-16T19:04:00.000Z',
    lastObservedAt: '2026-09-16T19:04:00.000Z',
    messageCount: 1,
    recordingState: 'recording',
    recordingStateUpdatedAt: '2026-09-16T19:02:00.000Z'
  };
  const message: ArchiveMessage = {
    id: messageId(conversation.id, 'user-1'),
    conversationId: conversation.id,
    providerId: 'chatgpt',
    providerTurnId: 'user-1',
    providerMessageId: 'user-1',
    role: 'user',
    orderHint: 0,
    plainText: 'Question body',
    markdown: 'Question body',
    partial: false,
    contentHash: 'hash',
    firstObservedAt: '2026-09-16T19:03:00.000Z',
    lastObservedAt: '2026-09-16T19:03:00.000Z',
    updatedAt: '2026-09-16T19:03:00.000Z'
  };
  return {
    conversation,
    messages: [message],
    events: [],
    exportedAt: '2026-09-16T20:00:00.000Z',
    project
  };
}

afterEach(async () => {
  while (databaseNames.length) {
    const name = databaseNames.pop();
    if (name) await requestToPromise(indexedDB.deleteDatabase(name));
  }
});

describe('project organization integration', () => {
  it('searches project, folder and tag metadata and exposes it in Markdown', () => {
    const source = bundle();
    const record = {
      conversation: source.conversation,
      messages: source.messages,
      project: source.project ?? undefined
    };
    expect(matchesLibraryQuery(record, 'research project')).toBe(true);
    expect(matchesLibraryQuery(record, 'primary sources')).toBe(true);
    expect(matchesLibraryQuery(record, 'urgent')).toBe(true);

    const markdown = renderMarkdownExport(source);
    expect(markdown).toContain('- **Project:** Research Project');
    expect(markdown).toContain('- **Folder:** Primary Sources');
    expect(markdown).toContain('- **Tags:** Evidence, Urgent');
  });

  it('round-trips and restores project/folder/tag organization into a fresh archive', async () => {
    const source = bundle();
    const parsed = parseJsonArchiveExport(renderJsonExport(source));
    expect(parsed).toEqual(source);

    const name = `llm-chat-history-organization-restore-${crypto.randomUUID()}`;
    databaseNames.push(name);
    const db = await openArchiveDb({ name, factory: indexedDB });
    await importArchiveBundle(db, parsed);

    const projects = await listProjects(db);
    expect(projects).toEqual([source.project]);
    const repository = new ArchiveRepository(db);
    const [conversation] = await repository.listConversations();
    expect(conversation?.projectId).toBe(source.project?.id);
    expect(conversation?.folderId).toBe(source.project?.folders[0]?.id);
    expect(conversation?.tags).toEqual(['Evidence', 'Urgent']);
    expect(conversation?.favoriteAt).toBe(source.conversation.favoriteAt);
    expect(conversation?.pinnedAt).toBe(source.conversation.pinnedAt);
    db.close();
  });
});
