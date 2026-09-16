import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { createCheckpoint, deleteCheckpoint, listCheckpoints, updateCheckpoint } from './checkpoints';
import { openArchiveDb, requestToPromise, transactionDone } from './db';
import { deleteConversationCascade } from './library-management';
import { STORES, type ArchiveConversation } from './schema';

const databases: Array<{ name: string; db: IDBDatabase }> = [];

async function createDb(): Promise<{ db: IDBDatabase; conversation: ArchiveConversation }> {
  const name = `llm-chat-history-checkpoints-${crypto.randomUUID()}`;
  const db = await openArchiveDb({ name, factory: indexedDB });
  databases.push({ name, db });
  const conversation: ArchiveConversation = {
    id: 'conv:checkpoint-test',
    providerId: 'chatgpt',
    providerConversationId: 'provider-checkpoint-test',
    providerKey: 'chatgpt:provider-checkpoint-test',
    provisional: false,
    sourceUrl: 'https://chatgpt.com/c/provider-checkpoint-test',
    title: 'Checkpoint test',
    createdAt: '2026-09-16T10:00:00.000Z',
    updatedAt: '2026-09-16T10:00:00.000Z',
    lastObservedAt: '2026-09-16T10:00:00.000Z',
    messageCount: 0,
    recordingState: 'recording',
    recordingStateUpdatedAt: '2026-09-16T10:00:00.000Z'
  };
  const transaction = db.transaction(STORES.conversations, 'readwrite');
  transaction.objectStore(STORES.conversations).add(conversation);
  await transactionDone(transaction);
  return { db, conversation };
}

afterEach(async () => {
  while (databases.length) {
    const entry = databases.pop();
    if (!entry) continue;
    entry.db.close();
    await requestToPromise(indexedDB.deleteDatabase(entry.name));
  }
});

describe('checkpoint archive events', () => {
  it('creates, lists and edits named checkpoints with optional notes', async () => {
    const { db, conversation } = await createDb();
    const created = await createCheckpoint(
      db,
      conversation.id,
      '  Task 10 complete  ',
      '  Homepage carousel passed QA.  ',
      '2026-09-16T10:05:00.000Z'
    );

    expect(created.name).toBe('Task 10 complete');
    expect(created.note).toBe('Homepage carousel passed QA.');
    expect(await listCheckpoints(db, conversation.id)).toEqual([created]);

    const updated = await updateCheckpoint(
      db,
      created.id,
      'Task 10 verified',
      null,
      '2026-09-16T10:06:00.000Z'
    );
    expect(updated).toMatchObject({
      id: created.id,
      conversationId: conversation.id,
      name: 'Task 10 verified',
      note: null,
      createdAt: created.createdAt,
      updatedAt: '2026-09-16T10:06:00.000Z'
    });
    expect(await listCheckpoints(db, conversation.id)).toEqual([updated]);
  });

  it('deletes one checkpoint without altering the conversation', async () => {
    const { db, conversation } = await createDb();
    const checkpoint = await createCheckpoint(db, conversation.id, 'Milestone');
    await deleteCheckpoint(db, checkpoint.id);
    expect(await listCheckpoints(db, conversation.id)).toEqual([]);

    const read = await requestToPromise<ArchiveConversation | undefined>(
      db.transaction(STORES.conversations, 'readonly').objectStore(STORES.conversations).get(conversation.id)
    );
    expect(read?.id).toBe(conversation.id);
  });

  it('conversation cascade deletion removes checkpoint events atomically', async () => {
    const { db, conversation } = await createDb();
    await createCheckpoint(db, conversation.id, 'Before delete');
    const result = await deleteConversationCascade(db, conversation.id);
    expect(result.eventsDeleted).toBe(1);
    expect(await listCheckpoints(db, conversation.id)).toEqual([]);
  });
});
