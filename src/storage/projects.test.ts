import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { openArchiveDb, requestToPromise, transactionDone } from './db';
import {
  addProjectFolder,
  assignConversationOrganization,
  createProject,
  deleteProject,
  deleteProjectFolder,
  listProjects,
  renameProject,
  renameProjectFolder,
  setConversationTags
} from './projects';
import { INDEXES, STORES, type ArchiveConversation } from './schema';

const databases: string[] = [];

function conversation(id: string): ArchiveConversation {
  return {
    id,
    providerId: 'chatgpt',
    providerConversationId: id,
    providerKey: `chatgpt:${id}`,
    provisional: false,
    sourceUrl: `https://chatgpt.com/c/${id}`,
    title: id,
    createdAt: '2026-09-16T18:00:00.000Z',
    updatedAt: '2026-09-16T18:00:00.000Z',
    lastObservedAt: '2026-09-16T18:00:00.000Z',
    messageCount: 0,
    recordingState: 'recording',
    recordingStateUpdatedAt: '2026-09-16T18:00:00.000Z'
  };
}

async function createDb(): Promise<IDBDatabase> {
  const name = `llm-chat-history-projects-${crypto.randomUUID()}`;
  databases.push(name);
  return openArchiveDb({ name, factory: indexedDB });
}

async function putConversation(db: IDBDatabase, value: ArchiveConversation): Promise<void> {
  const transaction = db.transaction(STORES.conversations, 'readwrite');
  transaction.objectStore(STORES.conversations).put(value);
  await transactionDone(transaction);
}

async function getConversation(
  db: IDBDatabase,
  id: string
): Promise<ArchiveConversation | undefined> {
  const transaction = db.transaction(STORES.conversations, 'readonly');
  const value = await requestToPromise<ArchiveConversation | undefined>(
    transaction.objectStore(STORES.conversations).get(id)
  );
  await transactionDone(transaction);
  return value;
}

function createLegacyV1(name: string, existing: ArchiveConversation): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      const conversations = db.createObjectStore(STORES.conversations, { keyPath: 'id' });
      conversations.createIndex(INDEXES.conversations.providerKey, 'providerKey', { unique: true });
      conversations.createIndex(INDEXES.conversations.provisionalKey, 'provisionalKey', { unique: true });
      conversations.createIndex(INDEXES.conversations.updatedAt, 'updatedAt');
      conversations.put(existing);

      const messages = db.createObjectStore(STORES.messages, { keyPath: 'id' });
      messages.createIndex(INDEXES.messages.conversationOrder, ['conversationId', 'orderHint']);
      messages.createIndex(INDEXES.messages.providerTurn, ['conversationId', 'providerTurnId'], {
        unique: true
      });
      messages.createIndex(INDEXES.messages.conversationUpdatedAt, ['conversationId', 'updatedAt']);

      const events = db.createObjectStore(STORES.events, { keyPath: 'id' });
      events.createIndex(INDEXES.events.conversationTime, ['conversationId', 'createdAt']);
      events.createIndex(INDEXES.events.typeTime, ['type', 'createdAt']);
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

afterEach(async () => {
  while (databases.length) {
    const name = databases.pop();
    if (name) await requestToPromise(indexedDB.deleteDatabase(name));
  }
});

describe('archive organization schema v2', () => {
  it('upgrades an existing v1 archive without rewriting its conversations', async () => {
    const name = `llm-chat-history-v1-upgrade-${crypto.randomUUID()}`;
    databases.push(name);
    const legacyConversation = conversation('legacy-chat');
    await createLegacyV1(name, legacyConversation);

    const db = await openArchiveDb({ name, factory: indexedDB });
    expect(db.version).toBe(2);
    expect([...db.objectStoreNames]).toContain(STORES.projects);
    expect(await getConversation(db, legacyConversation.id)).toEqual(legacyConversation);
    expect((await getConversation(db, legacyConversation.id))?.projectId).toBeUndefined();
    db.close();
  });

  it('creates, edits and lists provider-neutral projects and folders', async () => {
    const db = await createDb();
    const first = await createProject(db, ' Research ', '2026-09-16T18:01:00.000Z');
    const second = await createProject(db, 'Work', '2026-09-16T18:02:00.000Z');
    expect((await listProjects(db)).map((project) => project.name)).toEqual(['Research', 'Work']);

    const renamed = await renameProject(db, first.id, 'Deep Research', '2026-09-16T18:03:00.000Z');
    expect(renamed.name).toBe('Deep Research');
    const { folder } = await addProjectFolder(db, first.id, ' Sources ', '2026-09-16T18:04:00.000Z');
    const withRenamedFolder = await renameProjectFolder(
      db,
      first.id,
      folder.id,
      'Primary sources',
      '2026-09-16T18:05:00.000Z'
    );
    expect(withRenamedFolder.folders).toEqual([{ id: folder.id, name: 'Primary sources' }]);
    expect(second).not.toHaveProperty('providerId');
    db.close();
  });

  it('assigns conversations to project/folder, normalizes tags and preserves Unsorted fallback', async () => {
    const db = await createDb();
    const chat = conversation('organized-chat');
    await putConversation(db, chat);
    expect((await getConversation(db, chat.id))?.projectId).toBeUndefined();

    const project = await createProject(db, 'Project A');
    const { folder } = await addProjectFolder(db, project.id, 'Folder A');
    await assignConversationOrganization(db, chat.id, project.id, folder.id);
    await setConversationTags(db, chat.id, [' Research ', 'research', 'Important']);

    const organized = await getConversation(db, chat.id);
    expect(organized?.projectId).toBe(project.id);
    expect(organized?.folderId).toBe(folder.id);
    expect(organized?.tags).toEqual(['Research', 'Important']);

    await assignConversationOrganization(db, chat.id, null, null);
    const unsorted = await getConversation(db, chat.id);
    expect(unsorted?.projectId).toBeUndefined();
    expect(unsorted?.folderId).toBeUndefined();
    expect(unsorted?.tags).toEqual(['Research', 'Important']);
    db.close();
  });

  it('clears folder/project assignments safely when organization containers are deleted', async () => {
    const db = await createDb();
    const chat = conversation('safe-delete-chat');
    await putConversation(db, chat);
    const project = await createProject(db, 'Project');
    const { folder } = await addProjectFolder(db, project.id, 'Folder');
    await assignConversationOrganization(db, chat.id, project.id, folder.id);
    await setConversationTags(db, chat.id, ['Keep tag']);

    await deleteProjectFolder(db, project.id, folder.id);
    const afterFolderDelete = await getConversation(db, chat.id);
    expect(afterFolderDelete?.projectId).toBe(project.id);
    expect(afterFolderDelete?.folderId).toBeUndefined();

    await deleteProject(db, project.id);
    const afterProjectDelete = await getConversation(db, chat.id);
    expect(afterProjectDelete?.projectId).toBeUndefined();
    expect(afterProjectDelete?.folderId).toBeUndefined();
    expect(afterProjectDelete?.tags).toEqual(['Keep tag']);
    expect(await listProjects(db)).toHaveLength(0);
    db.close();
  });
});
