import { requestToPromise, transactionDone } from './db';
import { INDEXES, STORES, type ArchiveConversation } from './schema';

export class ConversationNotFoundError extends Error {
  constructor(conversationId: string) {
    super(`Conversation not found: ${conversationId}`);
    this.name = 'ConversationNotFoundError';
  }
}

async function updateConversation(
  db: IDBDatabase,
  conversationId: string,
  mutate: (conversation: ArchiveConversation) => ArchiveConversation
): Promise<ArchiveConversation> {
  const transaction = db.transaction(STORES.conversations, 'readwrite');
  const store = transaction.objectStore(STORES.conversations);
  const existing = await requestToPromise<ArchiveConversation | undefined>(store.get(conversationId));
  if (!existing) {
    transaction.abort();
    throw new ConversationNotFoundError(conversationId);
  }

  const updated = mutate(existing);
  store.put(updated);
  await transactionDone(transaction);
  return updated;
}

export async function renameConversation(
  db: IDBDatabase,
  conversationId: string,
  customTitle: string | null,
  updatedAt = new Date().toISOString()
): Promise<ArchiveConversation> {
  const normalized = customTitle?.trim() ?? '';
  return updateConversation(db, conversationId, (existing) => {
    const updated: ArchiveConversation = { ...existing, updatedAt };
    if (normalized) updated.customTitle = normalized;
    else delete updated.customTitle;
    return updated;
  });
}

export async function setConversationArchived(
  db: IDBDatabase,
  conversationId: string,
  archived: boolean,
  updatedAt = new Date().toISOString()
): Promise<ArchiveConversation> {
  return updateConversation(db, conversationId, (existing) => {
    const updated: ArchiveConversation = { ...existing, updatedAt };
    if (archived) updated.archivedAt = updatedAt;
    else delete updated.archivedAt;
    return updated;
  });
}

export interface DeleteConversationResult {
  conversationId: string;
  messagesDeleted: number;
  eventsDeleted: number;
}

export async function deleteConversationCascade(
  db: IDBDatabase,
  conversationId: string
): Promise<DeleteConversationResult> {
  const transaction = db.transaction(
    [STORES.conversations, STORES.messages, STORES.events],
    'readwrite'
  );
  const conversations = transaction.objectStore(STORES.conversations);
  const messages = transaction.objectStore(STORES.messages);
  const events = transaction.objectStore(STORES.events);

  const conversationRequest = conversations.get(conversationId);
  const messageKeysRequest = messages
    .index(INDEXES.messages.conversationOrder)
    .getAllKeys(IDBKeyRange.bound([conversationId, 0], [conversationId, Number.MAX_SAFE_INTEGER]));
  const eventKeysRequest = events
    .index(INDEXES.events.conversationTime)
    .getAllKeys(IDBKeyRange.bound([conversationId, ''], [conversationId, '\uffff']));

  const [conversation, messageKeys, eventKeys] = await Promise.all([
    requestToPromise<ArchiveConversation | undefined>(conversationRequest),
    requestToPromise<IDBValidKey[]>(messageKeysRequest),
    requestToPromise<IDBValidKey[]>(eventKeysRequest)
  ]);

  if (!conversation) {
    transaction.abort();
    throw new ConversationNotFoundError(conversationId);
  }

  for (const key of messageKeys) messages.delete(key);
  for (const key of eventKeys) events.delete(key);
  conversations.delete(conversationId);
  await transactionDone(transaction);

  return {
    conversationId,
    messagesDeleted: messageKeys.length,
    eventsDeleted: eventKeys.length
  };
}
