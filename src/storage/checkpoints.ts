import { requestToPromise, transactionDone } from './db';
import { INDEXES, STORES, type ArchiveCheckpoint, type ArchiveConversation } from './schema';

export class CheckpointConversationNotFoundError extends Error {
  constructor(conversationId: string) {
    super(`Conversation not found: ${conversationId}`);
    this.name = 'CheckpointConversationNotFoundError';
  }
}

export class CheckpointNotFoundError extends Error {
  constructor(checkpointId: string) {
    super(`Checkpoint not found: ${checkpointId}`);
    this.name = 'CheckpointNotFoundError';
  }
}

function cleanName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('Checkpoint name cannot be empty');
  return name;
}

function cleanNote(value: string | null | undefined): string | null {
  const note = value?.trim() ?? '';
  return note || null;
}

export async function listCheckpoints(
  db: IDBDatabase,
  conversationId: string
): Promise<ArchiveCheckpoint[]> {
  const transaction = db.transaction(STORES.checkpoints, 'readonly');
  const checkpoints = transaction.objectStore(STORES.checkpoints);
  const request = checkpoints
    .index(INDEXES.checkpoints.conversationTime)
    .getAll(IDBKeyRange.bound([conversationId, ''], [conversationId, '\uffff']));
  const result = await requestToPromise<ArchiveCheckpoint[]>(request);
  await transactionDone(transaction);
  return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export async function createCheckpoint(
  db: IDBDatabase,
  conversationId: string,
  name: string,
  note: string | null = null,
  now = new Date().toISOString()
): Promise<ArchiveCheckpoint> {
  const transaction = db.transaction([STORES.conversations, STORES.checkpoints], 'readwrite');
  const conversations = transaction.objectStore(STORES.conversations);
  const existing = await requestToPromise<ArchiveConversation | undefined>(
    conversations.get(conversationId)
  );
  if (!existing) {
    transaction.abort();
    throw new CheckpointConversationNotFoundError(conversationId);
  }

  const checkpoint: ArchiveCheckpoint = {
    id: `checkpoint:${crypto.randomUUID()}`,
    conversationId,
    name: cleanName(name),
    note: cleanNote(note),
    createdAt: now,
    updatedAt: now
  };
  transaction.objectStore(STORES.checkpoints).add(checkpoint);
  await transactionDone(transaction);
  return checkpoint;
}

export async function updateCheckpoint(
  db: IDBDatabase,
  checkpointId: string,
  name: string,
  note: string | null = null,
  now = new Date().toISOString()
): Promise<ArchiveCheckpoint> {
  const transaction = db.transaction(STORES.checkpoints, 'readwrite');
  const store = transaction.objectStore(STORES.checkpoints);
  const existing = await requestToPromise<ArchiveCheckpoint | undefined>(store.get(checkpointId));
  if (!existing) {
    transaction.abort();
    throw new CheckpointNotFoundError(checkpointId);
  }
  const updated: ArchiveCheckpoint = {
    ...existing,
    name: cleanName(name),
    note: cleanNote(note),
    updatedAt: now
  };
  store.put(updated);
  await transactionDone(transaction);
  return updated;
}

export async function deleteCheckpoint(db: IDBDatabase, checkpointId: string): Promise<void> {
  const transaction = db.transaction(STORES.checkpoints, 'readwrite');
  const store = transaction.objectStore(STORES.checkpoints);
  const existing = await requestToPromise<ArchiveCheckpoint | undefined>(store.get(checkpointId));
  if (!existing) {
    transaction.abort();
    throw new CheckpointNotFoundError(checkpointId);
  }
  store.delete(checkpointId);
  await transactionDone(transaction);
}
