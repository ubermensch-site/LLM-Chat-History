import type {
  ContentToBackgroundMessage,
  CreateCheckpointMessage,
  ProviderConversationIdentity,
  ProviderTurnObservation,
  ProviderVisibleActivityObservation,
  RecorderCommandMessage,
  RecorderState
} from '../shared/types';
import { recorderEventTypeForCommand, transitionRecorderState } from '../recorder/state-machine';
import { createCheckpoint as persistCheckpoint } from './checkpoints';
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
  type ArchiveMessage,
  type ArchiveVisibleActivity
} from './schema';
import { reconcileObservedTurnOrder } from './turn-order';

interface ConversationResolution {
  conversation: ArchiveConversation;
  created: boolean;
  identified: boolean;
  titleChanged: boolean;
  stale: boolean;
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
  id: string = crypto.randomUUID()
): ArchiveEvent {
  return { id, conversationId, type, createdAt, data };
}

function suppressedTurnEventId(conversationId: string, providerTurnId: string): string {
  return `suppressed:${conversationId}:${encodeURIComponent(providerTurnId)}`;
}

function recorderCommandEventId(requestId: string): string {
  return `recorder-command:${encodeURIComponent(requestId)}`;
}

function recorderStateFromEvent(event: ArchiveEvent | undefined): RecorderState | null {
  const value = event?.data.to;
  return value === 'recording' || value === 'paused' || value === 'stopped' || value === 'error'
    ? value
    : null;
}

function turnContentHashInput(turn: ProviderTurnObservation): string {
  return JSON.stringify([
    turn.role,
    turn.plainText,
    turn.markdown,
    turn.modelLabel ?? null
  ]);
}

function observedActivityChanged(
  stored: readonly ArchiveVisibleActivity[] | undefined,
  observed: readonly ProviderVisibleActivityObservation[] | undefined
): boolean {
  if (!observed?.length) return false;
  const byId = new Map((stored ?? []).map((activity) => [activity.providerActivityId, activity] as const));
  return observed.some((activity) => {
    const previous = byId.get(activity.providerActivityId);
    return !previous ||
      previous.kind !== activity.kind ||
      previous.text !== activity.text ||
      previous.orderHint !== activity.orderHint;
  });
}

function mergeVisibleActivities(
  stored: readonly ArchiveVisibleActivity[] | undefined,
  observed: readonly ProviderVisibleActivityObservation[] | undefined
): ArchiveVisibleActivity[] {
  const byId = new Map<string, ArchiveVisibleActivity>();
  for (const activity of stored ?? []) byId.set(activity.providerActivityId, activity);

  for (const activity of observed ?? []) {
    const previous = byId.get(activity.providerActivityId);
    byId.set(activity.providerActivityId, {
      providerActivityId: activity.providerActivityId,
      kind: activity.kind,
      text: activity.text,
      orderHint: activity.orderHint,
      firstObservedAt: previous?.firstObservedAt ?? activity.observedAt,
      lastObservedAt: activity.observedAt
    });
  }

  return [...byId.values()].sort(
    (a, b) =>
      a.firstObservedAt.localeCompare(b.firstObservedAt) ||
      a.orderHint - b.orderHint ||
      a.providerActivityId.localeCompare(b.providerActivityId)
  );
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

    const staleResolution = async (
      conversation: ArchiveConversation
    ): Promise<ConversationResolution> => {
      await transactionDone(transaction);
      return {
        conversation,
        created: false,
        identified: false,
        titleChanged: false,
        stale: true
      };
    };

    let existing: ArchiveConversation | undefined;
    let identified = false;

    if (stableProviderKey) {
      const stableExisting = await requestToPromise<ArchiveConversation | undefined>(
        store.index(INDEXES.conversations.providerKey).get(stableProviderKey)
      );
      const sessionOwner = await requestToPromise<ArchiveConversation | undefined>(
        store.index(INDEXES.conversations.provisionalKey).get(provisionalKey)
      );

      if (stableExisting) {
        // A stable provider identity is authoritative. SPA navigation can move one
        // tab between already-known conversations, so transfer the unique
        // tab/session claim away from the previous owner before claiming it here.
        if (sessionOwner && sessionOwner.id !== stableExisting.id) {
          const releasedOwner = { ...sessionOwner };
          delete releasedOwner.provisionalKey;
          store.put(releasedOwner);
        }
        existing = stableExisting;
      } else if (sessionOwner?.provisional) {
        existing = sessionOwner;
        identified = true;
      } else {
        // The tab can navigate directly to a stable conversation that has not been
        // archived before. Release any older stable session owner before creating
        // the new stable record. Staleness protection is intentionally limited to
        // provisional observations below; provider conversation IDs are explicit.
        if (sessionOwner) {
          const releasedOwner = { ...sessionOwner };
          delete releasedOwner.provisionalKey;
          store.put(releasedOwner);
        }
        existing = undefined;
      }
    } else {
      existing = await requestToPromise<ArchiveConversation | undefined>(
        store.index(INDEXES.conversations.provisionalKey).get(provisionalKey)
      );

      if (existing && !existing.provisional) {
        // A stable conversation keeps the tab/session claim after promotion so an
        // older observation from the document being replaced cannot recreate the
        // provisional archive. A genuinely newer provisional route releases the
        // claim and starts the next local conversation in this tab.
        if (now <= existing.lastObservedAt) return staleResolution(existing);
        const releasedOwner = { ...existing };
        delete releasedOwner.provisionalKey;
        store.put(releasedOwner);
        existing = undefined;
      }
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
        // Keep the provisional key as the current tab/session ownership claim.
        // This closes the reload race where an older provisional snapshot can
        // arrive after stable identity has already been persisted.
        conversation.provisionalKey = provisionalKey;
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

      if (stableProviderKey) {
        conversation.providerKey = stableProviderKey;
        conversation.provisionalKey = provisionalKey;
      } else {
        conversation.provisionalKey = provisionalKey;
      }
    }

    store.put(conversation);
    await transactionDone(transaction);

    return {
      conversation,
      created,
      identified,
      titleChanged: !created && input.title !== undefined && input.title !== previousTitle,
      stale: false
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
    if (result.stale) return;

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
    const contentHash = await sha256Hex(turnContentHashInput(turn));
    const suppressionId = suppressedTurnEventId(conversation.id, turn.providerTurnId);

    const readTransaction = this.db.transaction([STORES.messages, STORES.events], 'readonly');
    const existing = await requestToPromise<ArchiveMessage | undefined>(
      readTransaction.objectStore(STORES.messages).get(id)
    );
    const alreadySuppressed = await requestToPromise<ArchiveEvent | undefined>(
      readTransaction.objectStore(STORES.events).get(suppressionId)
    );
    await transactionDone(readTransaction);

    const activityChanged = observedActivityChanged(existing?.visibleActivities, turn.visibleActivities);
    if (alreadySuppressed || (existing?.contentHash === contentHash && !activityChanged)) return;

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
    if (resolution.stale) return state;

    if (state !== 'recording') {
      await this.suppressTurn(conversation, turn, state);
      return state;
    }

    if (await this.isTurnSuppressed(conversation.id, turn.providerTurnId)) {
      return state;
    }

    const id = messageId(conversation.id, turn.providerTurnId);
    const contentHash = await sha256Hex(turnContentHashInput(turn));

    const transaction = this.db.transaction(
      [STORES.messages, STORES.conversations, STORES.events],
      'readwrite'
    );
    const messages = transaction.objectStore(STORES.messages);
    const conversations = transaction.objectStore(STORES.conversations);
    const events = transaction.objectStore(STORES.events);

    const existing = await requestToPromise<ArchiveMessage | undefined>(messages.get(id));
    const isNew = !existing;
    const activityChanged = observedActivityChanged(existing?.visibleActivities, turn.visibleActivities);
    const contentChanged = Boolean(existing && (existing.contentHash !== contentHash || activityChanged));
    const finalized = Boolean(existing?.partial && !turn.partial);
    const visibleActivities = mergeVisibleActivities(existing?.visibleActivities, turn.visibleActivities);

    const record: ArchiveMessage = {
      id,
      conversationId: conversation.id,
      providerId: turn.providerId,
      providerTurnId: turn.providerTurnId,
      providerMessageId: turn.providerMessageId,
      role: turn.role,
      // DOM indexes are window-local under virtualization. Once a stable turn has
      // entered the archive, never overwrite its canonical order with a later
      // virtualized-window index. Snapshot reconciliation below updates ordering.
      orderHint: existing?.orderHint ?? turn.orderHint,
      plainText: turn.plainText,
      markdown: turn.markdown,
      partial: turn.partial,
      modelLabel: turn.modelLabel ?? existing?.modelLabel ?? null,
      ...(visibleActivities.length ? { visibleActivities } : {}),
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

  private async reconcileSnapshotOrder(
    conversationId: string,
    previous: ArchiveMessage[],
    turns: ProviderTurnObservation[]
  ): Promise<void> {
    const current = await this.listMessages(conversationId);
    const currentById = new Map(current.map((message) => [message.id, message] as const));
    const observedStoredIds = turns
      .map((turn) => messageId(conversationId, turn.providerTurnId))
      .filter((id) => currentById.has(id));
    const orderedIds = reconcileObservedTurnOrder(
      previous.map((message) => message.id),
      observedStoredIds
    );

    // Include any current record that was not represented by the prior canonical
    // order or this visible snapshot. This is defensive for mixed old/new clients.
    for (const message of current) {
      if (!orderedIds.includes(message.id)) orderedIds.push(message.id);
    }

    const transaction = this.db.transaction(STORES.messages, 'readwrite');
    const store = transaction.objectStore(STORES.messages);
    orderedIds.forEach((id, orderHint) => {
      const message = currentById.get(id);
      if (!message || message.orderHint === orderHint) return;
      store.put({ ...message, orderHint } satisfies ArchiveMessage);
    });
    await transactionDone(transaction);
  }

  private async persistTurnSnapshot(
    message: ContentToBackgroundMessage,
    turns: ProviderTurnObservation[]
  ): Promise<RecorderState | null> {
    if (!turns.length) return null;

    const first = turns[0]!;
    const identity: ProviderConversationIdentity = {
      providerId: first.providerId,
      providerConversationId: first.providerConversationId,
      sourceUrl: message.pageUrl,
      provisional: first.providerConversationId === null
    };
    const resolution = await this.resolveConversation({
      identity,
      sourceSessionId: message.sourceSessionId,
      observedAt: message.observation.type === 'turn-snapshot'
        ? message.observation.observedAt
        : first.observedAt
    });
    await this.recordResolutionEvents(
      resolution,
      message.observation.type === 'turn-snapshot'
        ? message.observation.observedAt
        : first.observedAt
    );
    if (resolution.stale) return resolution.conversation.recordingState;

    const previous = await this.listMessages(resolution.conversation.id);
    let state: RecorderState = resolution.conversation.recordingState;
    for (const turn of turns) {
      state = await this.persistTurn(message, turn);
    }

    if (state === 'recording') {
      await this.reconcileSnapshotOrder(resolution.conversation.id, previous, turns);
    }
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
      case 'turn-snapshot':
        return this.persistTurnSnapshot(message, message.observation.turns);
      case 'health':
        await this.persistHealth(message);
        return null;
    }
  }

  async applyRecorderCommand(message: RecorderCommandMessage): Promise<RecorderState> {
    const eventId = recorderCommandEventId(message.requestId);
    const readTransaction = this.db.transaction(STORES.events, 'readonly');
    const priorEvent = await requestToPromise<ArchiveEvent | undefined>(
      readTransaction.objectStore(STORES.events).get(eventId)
    );
    await transactionDone(readTransaction);

    const priorState = recorderStateFromEvent(priorEvent);
    if (priorState) return priorState;

    const resolution = await this.resolveConversation({
      identity: message.identity,
      sourceSessionId: message.sourceSessionId,
      observedAt: message.observedAt
    });
    await this.recordResolutionEvents(resolution, message.observedAt);
    if (resolution.stale) return resolution.conversation.recordingState;

    const current = resolution.conversation.recordingState;
    const next = transitionRecorderState(current, message.command);
    if (next === current) return current;

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
      archiveEvent(
        updated.id,
        recorderEventTypeForCommand(message.command),
        message.observedAt,
        {
          from: current,
          to: next,
          command: message.command,
          requestId: message.requestId
        },
        eventId
      )
    );
    await transactionDone(transaction);
    return next;
  }

  async createCheckpoint(message: CreateCheckpointMessage): Promise<RecorderState> {
    const resolution = await this.resolveConversation({
      identity: message.identity,
      sourceSessionId: message.sourceSessionId,
      observedAt: message.observedAt
    });
    await this.recordResolutionEvents(resolution, message.observedAt);
    if (resolution.stale) return resolution.conversation.recordingState;

    await persistCheckpoint(
      this.db,
      resolution.conversation.id,
      message.name,
      message.note,
      message.observedAt,
      `checkpoint:${encodeURIComponent(message.requestId)}`
    );
    return resolution.conversation.recordingState;
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
