import { requestToPromise, transactionDone } from './db';
import { INDEXES, STORES, type ArchiveConversation, type ArchiveEvent } from './schema';

export interface ArchiveCheckpoint {
  id: string;
  conversationId: string;
  name: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

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

export class CheckpointConflictError extends Error {
  constructor(checkpointId: string) {
    super(`Checkpoint ID conflicts with different local data: ${checkpointId}`);
    this.name = 'CheckpointConflictError';
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

function fromEvent(event: ArchiveEvent): ArchiveCheckpoint | null {
  if (event.type !== 'checkpoint' || !event.conversationId) return null;
  const name = event.data.name;
  const note = event.data.note;
  const updatedAt = event.data.updatedAt;
  if (typeof name !== 'string' || !name) return null;
  return {
    id: event.id,
    conversationId: event.conversationId,
    name,
    note: typeof note === 'string' && note ? note : null,
    createdAt: event.createdAt,
    updatedAt: typeof updatedAt === 'string' ? updatedAt : event.createdAt
  };
}

function toEvent(checkpoint: ArchiveCheckpoint): ArchiveEvent {
  return {
    id: checkpoint.id,
    conversationId: checkpoint.conversationId,
    type: 'checkpoint',
    createdAt: checkpoint.createdAt,
    data: {
      name: checkpoint.name,
      note: checkpoint.note,
      updatedAt: checkpoint.updatedAt
    }
  };
}

function sameCheckpoint(a: ArchiveCheckpoint, b: ArchiveCheckpoint): boolean {
  return (
    a.id === b.id &&
    a.conversationId === b.conversationId &&
    a.name === b.name &&
    a.note === b.note &&
    a.createdAt === b.createdAt &&
    a.updatedAt === b.updatedAt
  );
}

export async function listCheckpoints(
  db: IDBDatabase,
  conversationId: string
): Promise<ArchiveCheckpoint[]> {
  const transaction = db.transaction(STORES.events, 'readonly');
  const store = transaction.objectStore(STORES.events);
  const events = await requestToPromise<ArchiveEvent[]>(
    store
      .index(INDEXES.events.conversationTime)
      .getAll(IDBKeyRange.bound([conversationId, ''], [conversationId, '\uffff']))
  );
  await transactionDone(transaction);
  return events
    .map(fromEvent)
    .filter((checkpoint): checkpoint is ArchiveCheckpoint => Boolean(checkpoint))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export async function createCheckpoint(
  db: IDBDatabase,
  conversationId: string,
  name: string,
  note: string | null = null,
  now = new Date().toISOString(),
  checkpointId = `checkpoint:${crypto.randomUUID()}`
): Promise<ArchiveCheckpoint> {
  const transaction = db.transaction([STORES.conversations, STORES.events], 'readwrite');
  const conversations = transaction.objectStore(STORES.conversations);
  const events = transaction.objectStore(STORES.events);
  const [conversation, existingEvent] = await Promise.all([
    requestToPromise<ArchiveConversation | undefined>(conversations.get(conversationId)),
    requestToPromise<ArchiveEvent | undefined>(events.get(checkpointId))
  ]);
  if (!conversation) {
    transaction.abort();
    throw new CheckpointConversationNotFoundError(conversationId);
  }

  const checkpoint: ArchiveCheckpoint = {
    id: checkpointId,
    conversationId,
    name: cleanName(name),
    note: cleanNote(note),
    createdAt: now,
    updatedAt: now
  };

  if (existingEvent) {
    const existing = fromEvent(existingEvent);
    if (!existing || !sameCheckpoint(existing, checkpoint)) {
      transaction.abort();
      throw new CheckpointConflictError(checkpointId);
    }
    await transactionDone(transaction);
    return existing;
  }

  events.add(toEvent(checkpoint));
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
  const transaction = db.transaction(STORES.events, 'readwrite');
  const store = transaction.objectStore(STORES.events);
  const event = await requestToPromise<ArchiveEvent | undefined>(store.get(checkpointId));
  const existing = event ? fromEvent(event) : null;
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
  store.put(toEvent(updated));
  await transactionDone(transaction);
  return updated;
}

export async function deleteCheckpoint(db: IDBDatabase, checkpointId: string): Promise<void> {
  const transaction = db.transaction(STORES.events, 'readwrite');
  const store = transaction.objectStore(STORES.events);
  const event = await requestToPromise<ArchiveEvent | undefined>(store.get(checkpointId));
  if (!event || event.type !== 'checkpoint') {
    transaction.abort();
    throw new CheckpointNotFoundError(checkpointId);
  }
  store.delete(checkpointId);
  await transactionDone(transaction);
}
