import type {
  ContentToBackgroundMessage,
  ProviderConversationIdentity,
  ProviderTurnObservation
} from '../shared/types';
import { requestToPromise, transactionDone } from './db';
import {
  messageId,
  newConversationId,
  providerConversationKey,
  provisionalConversationKey,
  sha256Hex
} from './ids';
import {
  INDEXES,
  STORES,
  type ArchiveConversation,
  type ArchiveEvent,
  type ArchiveEventType,
  type ArchiveMessage
} from './schema';

interface ConversationResolution {
  conversation: ArchiveConversation;
  created: boolean;
  identified: boolean;
  titleChanged: boolean;
}

interface ResolveConversationInput {
  identity: ProviderConversationIdentity;
  sourceSessionId: string;
  title?: string | null;
  observedAt: string;
}

function archiveEvent(
  conversationId: string | null,
  type: ArchiveEventType,
  createdAt: string,
  data: ArchiveEvent['data'] = {}
): ArchiveEvent {
  return {
    id: crypto.randomUUID(),
    conversationId,
    type,
    createdAt,
    data
  };
}

export class ArchiveRepository {
  constructor(private readonly db: IDBDatabase) {}

  close(): void {
    this.db.close();
  }

  private async resolveConversation(input: ResolveConversationInput): Promise<ConversationResolution> {
    const transaction = this.db.transaction(STORES.conversations, 'readwrite');
    const store = transaction.objectStore(STORES.conversations);
    const now = input.observedAt;
    const providerId = input.identity.providerId;
    const stableProviderKey = input.identity.providerConversationId
      ? providerConversationKey(providerId, input.identity.providerConversationId)
      : null;
    const provisionalKey = provisionalConversationKey(providerId, input.sourceSessionId);

    let existing: ArchiveConversation | undefined;
    let identified = false;

    if (stableProviderKey) {
      existing = await requestToPromise<ArchiveConversation | undefined>(
        store.index(INDEXES.conversations.providerKey).get(stableProviderKey)
      );

      if (!existing) {
        existing = await requestToPromise<ArchiveConversation | undefined>(
          store.index(INDEXES.conversations.provisionalKey).get(provisionalKey)
        );
        identified = Boolean(existing);
      }
    } else {
      existing = await requestToPromise<ArchiveConversation | undefined>(
        store.index(INDEXES.conversations.provisionalKey).get(provisionalKey)
      );
    }

    const created = !existing;
    const previousTitle = existing?.title ?? null;

    let conversation: ArchiveConversation;
    if (existing) {
      conversation = {
        ...existing,
        providerConversationId:
          input.identity.providerConversationId ?? existing.providerConversationId,
        provisional: input.identity.providerConversationId === null,
        sourceUrl: input.identity.sourceUrl || existing.sourceUrl,
        title: input.title === undefined ? existing.title : input.title,
        updatedAt: now,
        lastObservedAt: now
      };

      if (stableProviderKey) {
        conversation.providerKey = stableProviderKey;
        delete conversation.provisionalKey;
        conversation.provisional = false;
      } else {
        conversation.provisionalKey = provisionalKey;
      }
    } else {
      conversation = {
        id: newConversationId(providerId),
        providerId,
        providerConversationId: input.identity.providerConversationId,
        provisional: input.identity.providerConversationId === null,
        sourceUrl: input.identity.sourceUrl,
        title: input.title ?? null,
        createdAt: now,
        updatedAt: now,
        lastObservedAt: now,
        messageCount: 0
      };

      if (stableProviderKey) conversation.providerKey = stableProviderKey;
      else conversation.provisionalKey = provisionalKey;
    }

    store.put(conversation);
    await transactionDone(transaction);

    return {
      conversation,
      created,
      identified,
      titleChanged: !created && input.title !== undefined && input.title !== previousTitle
    };
  }

  private async appendEvent(event: ArchiveEvent): Promise<void> {
    const transaction = this.db.transaction(STORES.events, 'readwrite');
    transaction.objectStore(STORES.events).put(event);
    await transactionDone(transaction);
  }

  private async persistConversationObservation(message: ContentToBackgroundMessage): Promise<void> {
    if (message.observation.type !== 'conversation') return;

    const result = await this.resolveConversation({
      identity: message.observation.identity,
      sourceSessionId: message.sourceSessionId,
      title: message.observation.title,
      observedAt: message.observation.observedAt
    });

    if (result.created) {
      await this.appendEvent(
        archiveEvent(result.conversation.id, 'conversation-created', message.observation.observedAt, {
          provisional: result.conversation.provisional
        })
      );
    } else if (result.identified) {
      await this.appendEvent(
        archiveEvent(result.conversation.id, 'conversation-identified', message.observation.observedAt, {
          providerConversationId: result.conversation.providerConversationId
        })
      );
    }

    if (result.titleChanged) {
      await this.appendEvent(
        archiveEvent(result.conversation.id, 'title-changed', message.observation.observedAt, {
          title: result.conversation.title
        })
      );
    }
  }

  private async persistTurn(message: ContentToBackgroundMessage, turn: ProviderTurnObservation): Promise<void> {
    const identity: ProviderConversationIdentity = {
      providerId: turn.providerId,
      providerConversationId: turn.providerConversationId,
      sourceUrl: message.pageUrl,
      provisional: turn.providerConversationId === null
    };

    const resolution = await this.resolveConversation({
      identity,
      sourceSessionId: message.sourceSessionId,
      observedAt: turn.observedAt
    });
    const conversation = resolution.conversation;
    const id = messageId(conversation.id, turn.providerTurnId);
    const contentHash = await sha256Hex(
      JSON.stringify([turn.role, turn.plainText, turn.markdown])
    );

    const transaction = this.db.transaction(
      [STORES.messages, STORES.conversations, STORES.events],
      'readwrite'
    );
    const messages = transaction.objectStore(STORES.messages);
    const conversations = transaction.objectStore(STORES.conversations);
    const events = transaction.objectStore(STORES.events);

    const existing = await requestToPromise<ArchiveMessage | undefined>(messages.get(id));
    const isNew = !existing;
    const contentChanged = Boolean(existing && existing.contentHash !== contentHash);
    const finalized = Boolean(existing?.partial && !turn.partial);

    const record: ArchiveMessage = {
      id,
      conversationId: conversation.id,
      providerId: turn.providerId,
      providerTurnId: turn.providerTurnId,
      providerMessageId: turn.providerMessageId,
      role: turn.role,
      orderHint: turn.orderHint,
      plainText: turn.plainText,
      markdown: turn.markdown,
      partial: turn.partial,
      contentHash,
      firstObservedAt: existing?.firstObservedAt ?? turn.observedAt,
      lastObservedAt: turn.observedAt,
      updatedAt: turn.observedAt
    };

    messages.put(record);

    const latestConversation: ArchiveConversation = {
      ...conversation,
      updatedAt: turn.observedAt,
      lastObservedAt: turn.observedAt,
      messageCount: conversation.messageCount + (isNew ? 1 : 0)
    };
    conversations.put(latestConversation);

    if (isNew) {
      events.put(
        archiveEvent(conversation.id, 'message-added', turn.observedAt, {
          messageId: id,
          role: turn.role,
          partial: turn.partial
        })
      );
    } else if (contentChanged) {
      events.put(
        archiveEvent(conversation.id, 'message-updated', turn.observedAt, {
          messageId: id,
          role: turn.role
        })
      );
    }

    if (finalized) {
      events.put(
        archiveEvent(conversation.id, 'message-finalized', turn.observedAt, {
          messageId: id,
          role: turn.role
        })
      );
    }

    await transactionDone(transaction);
  }

  private async persistHealth(message: ContentToBackgroundMessage): Promise<void> {
    if (message.observation.type !== 'health') return;
    await this.appendEvent(
      archiveEvent(null, 'adapter-health', message.observation.health.observedAt, {
        providerId: message.providerId,
        state: message.observation.health.state,
        code: message.observation.health.code,
        detail: message.observation.health.detail ?? null
      })
    );
  }

  async persistObservation(message: ContentToBackgroundMessage): Promise<void> {
    switch (message.observation.type) {
      case 'conversation':
        await this.persistConversationObservation(message);
        return;
      case 'turn-upsert':
        await this.persistTurn(message, message.observation.turn);
        return;
      case 'health':
        await this.persistHealth(message);
    }
  }

  async listConversations(): Promise<ArchiveConversation[]> {
    const transaction = this.db.transaction(STORES.conversations, 'readonly');
    const records = await requestToPromise<ArchiveConversation[]>(
      transaction.objectStore(STORES.conversations).getAll()
    );
    await transactionDone(transaction);
    return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listMessages(conversationId: string): Promise<ArchiveMessage[]> {
    const transaction = this.db.transaction(STORES.messages, 'readonly');
    const index = transaction
      .objectStore(STORES.messages)
      .index(INDEXES.messages.conversationOrder);
    const range = IDBKeyRange.bound(
      [conversationId, 0],
      [conversationId, Number.MAX_SAFE_INTEGER]
    );
    const records = await requestToPromise<ArchiveMessage[]>(index.getAll(range));
    await transactionDone(transaction);
    return records.sort(
      (a, b) => a.orderHint - b.orderHint || a.firstObservedAt.localeCompare(b.firstObservedAt)
    );
  }

  async listEvents(conversationId?: string): Promise<ArchiveEvent[]> {
    const transaction = this.db.transaction(STORES.events, 'readonly');
    const store = transaction.objectStore(STORES.events);
    let records: ArchiveEvent[];

    if (conversationId) {
      const range = IDBKeyRange.bound([conversationId, ''], [conversationId, '\uffff']);
      records = await requestToPromise<ArchiveEvent[]>(
        store.index(INDEXES.events.conversationTime).getAll(range)
      );
    } else {
      records = await requestToPromise<ArchiveEvent[]>(store.getAll());
    }

    await transactionDone(transaction);
    return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}
