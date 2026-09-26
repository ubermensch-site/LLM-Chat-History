import type { ArchiveExportBundle } from '../export/export';
import { requestToPromise, transactionDone } from './db';
import { messageId, providerConversationKey } from './ids';
import {
  INDEXES,
  STORES,
  type ArchiveConversation,
  type ArchiveEvent,
  type ArchiveMessage,
  type ArchiveProject
} from './schema';

export class ArchiveImportConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveImportConflictError';
  }
}

export interface ArchiveImportResult {
  conversationId: string;
  created: boolean;
  merged: boolean;
  messagesAdded: number;
  messagesUpdated: number;
  eventsAdded: number;
}

function sameStableIdentity(a: ArchiveConversation, b: ArchiveConversation): boolean {
  if (a.providerId !== b.providerId) return false;
  if (a.providerConversationId && b.providerConversationId) {
    return a.providerConversationId === b.providerConversationId;
  }
  return a.id === b.id;
}

function later<T>(a: T, aAt: string, b: T, bAt: string): T {
  return bAt > aAt ? b : a;
}

function mergedProject(existing: ArchiveProject | undefined, imported: ArchiveProject): ArchiveProject {
  if (!existing) return imported;
  const folders = new Map(imported.folders.map((folder) => [folder.id, folder] as const));
  for (const folder of existing.folders) folders.set(folder.id, folder);
  return {
    id: existing.id,
    name: existing.name,
    folders: [...folders.values()],
    createdAt: imported.createdAt < existing.createdAt ? imported.createdAt : existing.createdAt,
    updatedAt: imported.updatedAt > existing.updatedAt ? imported.updatedAt : existing.updatedAt
  };
}

function mergedConversation(
  existing: ArchiveConversation | undefined,
  imported: ArchiveConversation,
  targetId: string,
  messageCount: number
): ArchiveConversation {
  if (!existing) {
    return { ...imported, id: targetId, messageCount };
  }

  const metadata = later(existing, existing.updatedAt, imported, imported.updatedAt);
  const recording = later(
    { state: existing.recordingState, at: existing.recordingStateUpdatedAt },
    existing.recordingStateUpdatedAt,
    { state: imported.recordingState, at: imported.recordingStateUpdatedAt },
    imported.recordingStateUpdatedAt
  );
  const providerConversationId = imported.providerConversationId ?? existing.providerConversationId;
  const result: ArchiveConversation = {
    ...metadata,
    id: targetId,
    providerId: existing.providerId,
    providerConversationId,
    provisional: providerConversationId === null,
    sourceUrl: metadata.sourceUrl,
    title: metadata.title,
    createdAt: imported.createdAt < existing.createdAt ? imported.createdAt : existing.createdAt,
    updatedAt: imported.updatedAt > existing.updatedAt ? imported.updatedAt : existing.updatedAt,
    lastObservedAt:
      imported.lastObservedAt > existing.lastObservedAt
        ? imported.lastObservedAt
        : existing.lastObservedAt,
    messageCount,
    recordingState: recording.state,
    recordingStateUpdatedAt: recording.at
  };

  if (providerConversationId) {
    result.providerKey = providerConversationKey(result.providerId, providerConversationId);
    delete result.provisionalKey;
  } else {
    delete result.providerKey;
    const provisionalKey = existing.provisionalKey ?? imported.provisionalKey;
    if (provisionalKey) result.provisionalKey = provisionalKey;
    else delete result.provisionalKey;
  }

  const customTitle = existing.customTitle ?? imported.customTitle;
  if (customTitle) result.customTitle = customTitle;
  else delete result.customTitle;

  const favoriteAt = existing.favoriteAt ?? imported.favoriteAt;
  if (favoriteAt) result.favoriteAt = favoriteAt;
  else delete result.favoriteAt;

  const pinnedAt = existing.pinnedAt ?? imported.pinnedAt;
  if (pinnedAt) result.pinnedAt = pinnedAt;
  else delete result.pinnedAt;

  const archivedAt = existing.archivedAt ?? imported.archivedAt;
  if (archivedAt) result.archivedAt = archivedAt;
  else delete result.archivedAt;

  if (existing.projectId) result.projectId = existing.projectId;
  else delete result.projectId;
  if (existing.folderId) result.folderId = existing.folderId;
  else delete result.folderId;
  if (existing.tags?.length) result.tags = [...existing.tags];
  else delete result.tags;

  return result;
}

function mappedEvent(
  event: ArchiveEvent,
  sourceConversationId: string,
  targetConversationId: string,
  messageIds: Map<string, string>
): ArchiveEvent {
  const data = { ...event.data };
  if (typeof data.messageId === 'string') {
    data.messageId = messageIds.get(data.messageId) ?? data.messageId;
  }

  let id = event.id;
  if (targetConversationId !== sourceConversationId) {
    if (event.type === 'turn-suppressed' && typeof event.data.providerTurnId === 'string') {
      id = `suppressed:${targetConversationId}:${encodeURIComponent(event.data.providerTurnId)}`;
    } else if (event.type === 'checkpoint') {
      id = `checkpoint:import:${encodeURIComponent(sourceConversationId)}:${encodeURIComponent(event.id)}`;
    } else {
      id = `import:${encodeURIComponent(sourceConversationId)}:${event.id}`;
    }
  }

  return {
    ...event,
    id,
    conversationId: targetConversationId,
    data
  };
}

function sameEvent(a: ArchiveEvent, b: ArchiveEvent): boolean {
  return (
    a.id === b.id &&
    a.conversationId === b.conversationId &&
    a.type === b.type &&
    a.createdAt === b.createdAt &&
    JSON.stringify(a.data) === JSON.stringify(b.data)
  );
}

export async function importArchiveBundle(
  db: IDBDatabase,
  bundle: ArchiveExportBundle
): Promise<ArchiveImportResult> {
  const transaction = db.transaction(
    [STORES.conversations, STORES.messages, STORES.events, STORES.projects],
    'readwrite'
  );

  try {
    const conversations = transaction.objectStore(STORES.conversations);
    const messages = transaction.objectStore(STORES.messages);
    const events = transaction.objectStore(STORES.events);
    const projects = transaction.objectStore(STORES.projects);
    const imported = bundle.conversation;

    const byIdRequest = conversations.get(imported.id);
    const byProviderRequest = imported.providerConversationId
      ? conversations
          .index(INDEXES.conversations.providerKey)
          .get(providerConversationKey(imported.providerId, imported.providerConversationId))
      : null;
    const allMessagesRequest = messages.getAll();
    const allEventsRequest = events.getAll();
    const existingProjectRequest = bundle.project ? projects.get(bundle.project.id) : null;

    const [existingById, existingByProvider, allMessages, allEvents, existingProject] =
      await Promise.all([
        requestToPromise<ArchiveConversation | undefined>(byIdRequest),
        byProviderRequest
          ? requestToPromise<ArchiveConversation | undefined>(byProviderRequest)
          : Promise.resolve(undefined),
        requestToPromise<ArchiveMessage[]>(allMessagesRequest),
        requestToPromise<ArchiveEvent[]>(allEventsRequest),
        existingProjectRequest
          ? requestToPromise<ArchiveProject | undefined>(existingProjectRequest)
          : Promise.resolve(undefined)
      ]);

    if (existingById && !sameStableIdentity(existingById, imported)) {
      throw new ArchiveImportConflictError(
        `Conversation ID ${imported.id} already belongs to different local history`
      );
    }
    if (existingById && existingByProvider && existingById.id !== existingByProvider.id) {
      throw new ArchiveImportConflictError(
        'The imported internal ID and provider conversation ID resolve to different local conversations'
      );
    }

    const existing = existingByProvider ?? existingById;
    if (existing && imported.providerConversationId && !sameStableIdentity(existing, imported)) {
      throw new ArchiveImportConflictError('Provider conversation identity conflicts with local history');
    }

    const targetId = existing?.id ?? imported.id;
    const sourceId = imported.id;
    const existingMessages = allMessages.filter((message) => message.conversationId === targetId);
    const existingByTurn = new Map(
      existingMessages.map((message) => [message.providerTurnId, message] as const)
    );
    const finalMessages = new Map(
      existingMessages.map((message) => [message.providerTurnId, message] as const)
    );
    const oldToNewMessageId = new Map<string, string>();
    const messageWrites: ArchiveMessage[] = [];
    let messagesAdded = 0;
    let messagesUpdated = 0;

    for (const importedMessage of bundle.messages) {
      const targetMessageId = messageId(targetId, importedMessage.providerTurnId);
      oldToNewMessageId.set(importedMessage.id, targetMessageId);
      const mapped: ArchiveMessage = {
        ...importedMessage,
        id: targetMessageId,
        conversationId: targetId
      };
      const current = existingByTurn.get(importedMessage.providerTurnId);
      if (current && current.id !== targetMessageId) {
        throw new ArchiveImportConflictError(
          `Turn ${importedMessage.providerTurnId} has a non-canonical local message ID`
        );
      }
      if (!current) {
        messageWrites.push(mapped);
        finalMessages.set(mapped.providerTurnId, mapped);
        messagesAdded += 1;
      } else if (mapped.updatedAt > current.updatedAt) {
        messageWrites.push(mapped);
        finalMessages.set(mapped.providerTurnId, mapped);
        messagesUpdated += 1;
      }
    }

    const finalConversation = mergedConversation(existing, imported, targetId, finalMessages.size);

    const existingEvents = new Map(allEvents.map((event) => [event.id, event] as const));
    const eventWrites: ArchiveEvent[] = [];
    for (const sourceEvent of bundle.events) {
      const mapped = mappedEvent(sourceEvent, sourceId, targetId, oldToNewMessageId);
      const current = existingEvents.get(mapped.id);
      if (!current) {
        eventWrites.push(mapped);
        existingEvents.set(mapped.id, mapped);
      } else if (!sameEvent(current, mapped)) {
        throw new ArchiveImportConflictError(
          `Archive event ID ${mapped.id} conflicts with different local event data`
        );
      }
    }

    if (bundle.project && finalConversation.projectId === bundle.project.id) {
      projects.put(mergedProject(existingProject, bundle.project));
    }
    conversations.put(finalConversation);
    for (const message of messageWrites) messages.put(message);
    for (const event of eventWrites) events.put(event);

    await transactionDone(transaction);
    return {
      conversationId: targetId,
      created: !existing,
      merged: Boolean(existing),
      messagesAdded,
      messagesUpdated,
      eventsAdded: eventWrites.length
    };
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // The transaction may already be finished; preserve the original error.
    }
    throw error;
  }
}
