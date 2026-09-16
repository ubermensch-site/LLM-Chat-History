import type {
  ContentToBackgroundMessage,
  ProviderConversationIdentity,
  ProviderTurnObservation,
  RecorderCommandMessage,
  RecorderState
} from '../shared/types';
import { recorderEventTypeForCommand, transitionRecorderState } from '../recorder/state-machine';
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
  data: ArchiveEvent['data'] = {},
  id = crypto.randomUUID()
): ArchiveEvent {
  return { id, conversationId, type, createdAt, data };
}

function suppressedTurnEventId(conversationId: string, providerTurnId: string): string {
  return `suppressed:${conversationId}:${encodeURIComponent(providerTurnId)}`;
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
        lastObservedAt: now,
        recordingState: existing.recordingState ?? 'recording',
        recordingStateUpdatedAt: existing.recordingStateUpdatedAt ?? existing.createdAt
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
        messageCount: 0,
        recordingState: 'recording',
        recordingStateUpdatedAt: now
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

  private async recordResolutionEvents(
    result: ConversationResolution,
    observedAt: string
  ): Promise<void> {
    if (result.created) {
      await this.appendEvent(
        archiveEvent(result.conversation.id, 'conversation-created', observedAt, {
          provisional: result.conversation.provisional
        })
      );
    } else if (result.identified) {
      await this.appendEvent(
        archiveEvent(result.conversation.id, 'conversation-identified', observedAt, {
          providerConversationId: result.conversation.providerConversationId
        })
      );
    }

    if (result.titleChanged) {
      await this.appendEvent(
        archiveEvent(result.conversation.id, 'title-changed', observedAt, {
          title: result.conversation.title
        })
      );
    }
  }

  private async persistConversationObservation(
    message: ContentToBackgroundMessage
  ): Promise<RecorderState> {
    if (message.observation.type !== 'conversation') {
      throw new Error('Expected conversation observation');
    }

    const result = await this.resolveConversation({
      identity: message.observation.identity,
      sourceSessionId: message.sourceSessionId,
      title: message.observation.title,
      observedAt: message.observation.observedAt
    });
    await this.recordResolutionEvents(result, message.observation.observedAt);
    return result.conversation.recordingState;
  }

  private async isTurnSuppressed(
    conversationId: string,
    providerTurnId: string
  ): Promise<boolean> {
    const transaction = this.db.transaction(STORES.events, 'readonly');
    const event = await requestToPromise<ArchiveEvent | undefined>(
      transaction.objectStore(STORES.events).get(
        suppressedTurnEventId(conversationId, providerTurnId)
      )
    );
    await transactionDone(transaction);
    return Boolean(event);
  }

  private async suppressTurn(
    conversation: ArchiveConversation,
    turn: ProviderTurnObservation,
    state: RecorderState
  ): Promise<void> {
    const id = messageId(conversation.id, turn.providerTurnId);
    const contentHash = await sha256Hex(JSON.stringify([turn.role, turn.plainText, turn.markdown]));
    const suppressionId = suppressedTurnEventId(conversation.id, turn.providerTurnId);

    const readTransaction = this.db.transaction([STORES.messages, STORES.events], 'readonly');
    const existing = await requestToPromise<ArchiveMessage | undefined>(
      readTransaction.objectStore(STORES.messages).get(id)
    );
    const alreadySuppressed = await requestToPromise<ArchiveEvent | undefined>(
      readTransaction.objectStore(STORES.events).get(suppressionId)
    );
    await transactionDone(readTransaction);

    if (alreadySuppressed || existing?.contentHash === contentHash) return;

    await this.appendEvent(
      archiveEvent(
        conversation.id,
        'turn-suppressed',
        turn.observedAt,
        {
          providerTurnId: turn.providerTurnId,
          reason: state
        },
        suppressionId
      )
    );
  }

  private async persistTurn(
    message: ContentToBackgroundMessage,
    turn: ProviderTurnObservation
  ): Promise<RecorderState> {
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
    await this.recordResolutionEvents(resolution, turn.observedAt);

    const conversation = resolution.conversation;
    const state = conversation.recordingState;

    if (state !== 'recording') {
      await this.suppressTurn(conversation, turn, state);
      return state;
    }

    if (await this.isTurnSuppressed(conversation.id, turn.providerTurnId)) {
      return state;
    }

    const id = messageId(conversation.id, turn.providerTurnId);
    const contentHash = await sha256Hex(JSON.stringify([turn.role, turn.plainText, turn.markdown]));

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
    conversations.put({
      ...conversation,
      updatedAt: turn.observedAt,
      lastObservedAt: turn.observedAt,
      messageCount: conversation.messageCount + (isNew ? 1 : 0)
    } satisfies ArchiveConversation);

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
    return state;
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

  async persistObservation(message: ContentToBackgroundMessage): Promise<RecorderState | null> {
    switch (message.observation.type) {
      case 'conversation':
        return this.persistConversationObservation(message);
      case 'turn-upsert':
        return this.persistTurn(message, message.observation.turn);
      case 'health':
        await this.persistHealth(message);
        return null;
    }
  }

  async applyRecorderCommand(message: RecorderCommandMessage): Promise<RecorderState> {
    const resolution = await this.resolveConversation({
      identity: message.identity,
      sourceSessionId: message.sourceSessionId,
      observedAt: message.observedAt
    });
    await this.recordResolutionEvents(resolution, message.observedAt);

    const current = resolution.conversation.recordingState;
    const next = transitionRecorderState(current, message.command);
    const updated: ArchiveConversation = {
      ...resolution.conversation,
      recordingState: next,
      recordingStateUpdatedAt: message.observedAt,
      updatedAt: message.observedAt,
      lastObservedAt: message.observedAt
    };

    const transaction = this.db.transaction([STORES.conversations, STORES.events], 'readwrite');
    transaction.objectStore(STORES.conversations).put(updated);
    transaction.objectStore(STORES.events).put(
      archiveEvent(updated.id, recorderEventTypeForCommand(message.command), message.observedAt, {
        from: current,
        to: next,
        command: message.command
      })
    );
    await transactionDone(transaction);
    return next;
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
    const index = transaction.objectStore(STORES.messages).index(INDEXES.messages.conversationOrder);
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
