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

function suppressedProviderMessageEventId(
  conversationId: string,
  providerMessageId: string
): string {
  return `suppressed-message:${conversationId}:${encodeURIComponent(providerMessageId)}`;
}

function suppressionEventIds(
  conversationId: string,
  turn: ProviderTurnObservation
): string[] {
  const ids = [suppressedTurnEventId(conversationId, turn.providerTurnId)];
  if (turn.providerMessageId) {
    ids.unshift(suppressedProviderMessageEventId(conversationId, turn.providerMessageId));
  }
  return ids;
}

async function archivedMessagesForObservedTurn(
  store: IDBObjectStore,
  conversationId: string,
  turn: ProviderTurnObservation
): Promise<ArchiveMessage[]> {
  const byId = new Map<string, ArchiveMessage>();
  const direct = await requestToPromise<ArchiveMessage | undefined>(
    store.get(messageId(conversationId, turn.providerTurnId))
  );
  if (direct) byId.set(direct.id, direct);

  if (turn.providerMessageId) {
    const providerMatches = await requestToPromise<ArchiveMessage[]>(
      store.index(INDEXES.messages.providerMessage).getAll(
        IDBKeyRange.only([conversationId, turn.providerMessageId])
      )
    );
    for (const candidate of providerMatches) {
      if (candidate.providerId !== turn.providerId || candidate.role !== turn.role) continue;
      byId.set(candidate.id, candidate);
    }
  }

  return [...byId.values()].sort(
    (a, b) =>
      a.firstObservedAt.localeCompare(b.firstObservedAt) ||
      a.id.localeCompare(b.id)
  );
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

function strongProviderTurnId(value: string): boolean {
  return !value.startsWith('dom:') && !/^conversation-turn-\d+$/i.test(value);
}

function normalizedRenderedText(value: string | null): string | null {
  return value === null ? null : value.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
}

function renderedTurnSequenceMatches(
  messages: readonly ArchiveMessage[],
  turns: readonly ProviderTurnObservation[]
): boolean {
  if (turns.length < 2 || messages.length !== turns.length) return false;
  if (turns.some((turn) => turn.partial) || messages.some((message) => message.partial)) return false;

  const orderedMessages = [...messages].sort(
    (a, b) => a.orderHint - b.orderHint || a.firstObservedAt.localeCompare(b.firstObservedAt)
  );
  const orderedTurns = [...turns].sort(
    (a, b) => a.orderHint - b.orderHint || a.observedAt.localeCompare(b.observedAt)
  );
  const roles = new Set(orderedTurns.map((turn) => turn.role));
  if (!roles.has('user') || !roles.has('assistant')) return false;

  return orderedMessages.every((message, index) => {
    const turn = orderedTurns[index]!;
    return (
      message.role === turn.role &&
      normalizedRenderedText(message.plainText) === normalizedRenderedText(turn.plainText) &&
      normalizedRenderedText(message.markdown) === normalizedRenderedText(turn.markdown)
    );
  });
}

const PARTIAL_PROMOTION_WINDOW_MS = 120_000;

function partialRenderedTurnPromotionMatches(
  messages: readonly ArchiveMessage[],
  turns: readonly ProviderTurnObservation[]
): boolean {
  if (turns.length < 2 || messages.length !== turns.length) return false;
  if (turns.some((turn) => turn.partial)) return false;

  const orderedMessages = [...messages].sort(
    (a, b) => a.orderHint - b.orderHint || a.firstObservedAt.localeCompare(b.firstObservedAt)
  );
  const orderedTurns = [...turns].sort(
    (a, b) => a.orderHint - b.orderHint || a.observedAt.localeCompare(b.observedAt)
  );
  const partialIndexes = orderedMessages
    .map((message, index) => message.partial ? index : -1)
    .filter((index) => index >= 0);

  if (partialIndexes.length !== 1) return false;
  const partialIndex = partialIndexes[0]!;
  if (partialIndex !== orderedMessages.length - 1) return false;
  if (orderedMessages[partialIndex]!.role !== 'assistant' || orderedTurns[partialIndex]!.role !== 'assistant') {
    return false;
  }

  let matchedUser = false;
  for (let index = 0; index < orderedMessages.length; index += 1) {
    const message = orderedMessages[index]!;
    const turn = orderedTurns[index]!;
    if (message.role !== turn.role) return false;
    if (index === partialIndex) continue;
    if (message.partial) return false;
    if (
      normalizedRenderedText(message.plainText) !== normalizedRenderedText(turn.plainText) ||
      normalizedRenderedText(message.markdown) !== normalizedRenderedText(turn.markdown)
    ) {
      return false;
    }
    if (message.role === 'user') matchedUser = true;
  }

  return matchedUser;
}

function withinPartialPromotionWindow(
  candidate: ArchiveConversation,
  stableConversation: ArchiveConversation
): boolean {
  const candidateTime = Date.parse(candidate.lastObservedAt);
  const stableTime = Date.parse(stableConversation.lastObservedAt);
  if (!Number.isFinite(candidateTime) || !Number.isFinite(stableTime)) return false;
  const delta = stableTime - candidateTime;
  return delta >= 0 && delta <= PARTIAL_PROMOTION_WINDOW_MS;
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

  private async removeFreshProvisionalDuplicatesMatchingTurns(
    stableConversation: ArchiveConversation,
    turns: readonly ProviderTurnObservation[]
  ): Promise<void> {
    const providerMessageIds = new Set<string>();
    const providerTurnIds = new Set<string>();
    for (const turn of turns) {
      if (turn.providerMessageId) providerMessageIds.add(turn.providerMessageId);
      if (strongProviderTurnId(turn.providerTurnId)) providerTurnIds.add(turn.providerTurnId);
    }

    const conversationTransaction = this.db.transaction(STORES.conversations, 'readonly');
    const conversations = await requestToPromise<ArchiveConversation[]>(
      conversationTransaction.objectStore(STORES.conversations).getAll()
    );
    await transactionDone(conversationTransaction);

    const candidates = conversations.filter((conversation) => {
      if (
        conversation.id === stableConversation.id ||
        conversation.providerId !== stableConversation.providerId ||
        !conversation.provisional ||
        conversation.recordingState !== 'recording'
      ) {
        return false;
      }
      return !(
        conversation.customTitle ||
        conversation.archivedAt ||
        conversation.projectId ||
        conversation.folderId ||
        conversation.tags?.length
      );
    });
    if (!candidates.length) return;

    const readTransaction = this.db.transaction([STORES.messages, STORES.events], 'readonly');
    const [allMessages, allEvents] = await Promise.all([
      requestToPromise<ArchiveMessage[]>(readTransaction.objectStore(STORES.messages).getAll()),
      requestToPromise<ArchiveEvent[]>(readTransaction.objectStore(STORES.events).getAll())
    ]);
    await transactionDone(readTransaction);

    const safeEventTypes = new Set<ArchiveEventType>([
      'conversation-created',
      'conversation-identified',
      'title-changed',
      'message-added',
      'message-updated',
      'message-finalized'
    ]);

    const eligible = candidates.flatMap((conversation) => {
      const messages = allMessages.filter((message) => message.conversationId === conversation.id);
      if (!messages.length) return [];
      const events = allEvents.filter((event) => event.conversationId === conversation.id);
      if (!events.every((event) => safeEventTypes.has(event.type))) return [];
      return [{ conversation, messages }];
    });
    if (!eligible.length) return;

    const providerIdentityMatches = eligible.filter(({ messages }) => {
      if (messages.length !== turns.length || (!providerMessageIds.size && !providerTurnIds.size)) {
        return false;
      }
      return messages.every((message) => {
        if (message.providerMessageId && providerMessageIds.has(message.providerMessageId)) {
          return true;
        }
        return strongProviderTurnId(message.providerTurnId) && providerTurnIds.has(message.providerTurnId);
      });
    });

    let removable: ArchiveConversation[];
    if (providerIdentityMatches.length > 1) return;
    if (providerIdentityMatches.length === 1) {
      removable = [providerIdentityMatches[0]!.conversation];
    } else {
      const renderedSequenceMatches = eligible.filter(({ messages }) =>
        renderedTurnSequenceMatches(messages, turns)
      );
      if (renderedSequenceMatches.length > 1) return;
      if (renderedSequenceMatches.length === 1) {
        removable = [renderedSequenceMatches[0]!.conversation];
      } else {
        const partialPromotionMatches = eligible.filter(({ conversation, messages }) =>
          withinPartialPromotionWindow(conversation, stableConversation) &&
          partialRenderedTurnPromotionMatches(messages, turns)
        );
        if (partialPromotionMatches.length !== 1) return;
        removable = [partialPromotionMatches[0]!.conversation];
      }
    }

    const removableIds = new Set(removable.map((conversation) => conversation.id));
    const writeTransaction = this.db.transaction(
      [STORES.conversations, STORES.messages, STORES.events],
      'readwrite'
    );
    const conversationStore = writeTransaction.objectStore(STORES.conversations);
    const messageStore = writeTransaction.objectStore(STORES.messages);
    const eventStore = writeTransaction.objectStore(STORES.events);

    for (const conversation of removable) conversationStore.delete(conversation.id);
    for (const message of allMessages) {
      if (removableIds.has(message.conversationId)) messageStore.delete(message.id);
    }
    for (const event of allEvents) {
      if (event.conversationId && removableIds.has(event.conversationId)) eventStore.delete(event.id);
    }
    await transactionDone(writeTransaction);
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
    turn: ProviderTurnObservation
  ): Promise<boolean> {
    const transaction = this.db.transaction(STORES.events, 'readonly');
    const store = transaction.objectStore(STORES.events);
    const events = await Promise.all(
      suppressionEventIds(conversationId, turn).map((id) =>
        requestToPromise<ArchiveEvent | undefined>(store.get(id))
      )
    );
    await transactionDone(transaction);
    return events.some(Boolean);
  }

  private async suppressTurn(
    conversation: ArchiveConversation,
    turn: ProviderTurnObservation,
    state: RecorderState
  ): Promise<void> {
    const contentHash = await sha256Hex(turnContentHashInput(turn));
    const suppressionIds = suppressionEventIds(conversation.id, turn);
    const suppressionId = suppressionIds[0]!;

    const readTransaction = this.db.transaction([STORES.messages, STORES.events], 'readonly');
    const messageStore = readTransaction.objectStore(STORES.messages);
    const eventStore = readTransaction.objectStore(STORES.events);
    const [matchingMessages, suppressionEvents] = await Promise.all([
      archivedMessagesForObservedTurn(messageStore, conversation.id, turn),
      Promise.all(
        suppressionIds.map((id) =>
          requestToPromise<ArchiveEvent | undefined>(eventStore.get(id))
        )
      )
    ]);
    await transactionDone(readTransaction);

    const existing = matchingMessages[0];
    const activityChanged = observedActivityChanged(existing?.visibleActivities, turn.visibleActivities);
    if (suppressionEvents.some(Boolean) || (existing?.contentHash === contentHash && !activityChanged)) {
      return;
    }

    await this.appendEvent(
      archiveEvent(
        conversation.id,
        'turn-suppressed',
        turn.observedAt,
        {
          providerTurnId: turn.providerTurnId,
          providerMessageId: turn.providerMessageId,
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

    if (await this.isTurnSuppressed(conversation.id, turn)) {
      return state;
    }

    const fallbackId = messageId(conversation.id, turn.providerTurnId);
    const contentHash = await sha256Hex(turnContentHashInput(turn));

    const transaction = this.db.transaction(
      [STORES.messages, STORES.conversations, STORES.events],
      'readwrite'
    );
    const messages = transaction.objectStore(STORES.messages);
    const conversations = transaction.objectStore(STORES.conversations);
    const events = transaction.objectStore(STORES.events);

    const matchingMessages = await archivedMessagesForObservedTurn(
      messages,
      conversation.id,
      turn
    );
    const existing = matchingMessages[0];
    const duplicates = matchingMessages.slice(1);
    const id = existing?.id ?? fallbackId;
    const isNew = !existing;

    let priorVisibleActivities = existing?.visibleActivities ?? [];
    for (const duplicate of duplicates) {
      priorVisibleActivities = mergeVisibleActivities(
        priorVisibleActivities,
        duplicate.visibleActivities?.map((activity) => ({
          providerActivityId: activity.providerActivityId,
          kind: activity.kind,
          text: activity.text,
          orderHint: activity.orderHint,
          observedAt: activity.lastObservedAt
        }))
      );
    }

    const activityChanged = observedActivityChanged(priorVisibleActivities, turn.visibleActivities);
    const contentChanged = Boolean(existing && (existing.contentHash !== contentHash || activityChanged));
    const finalized = Boolean(existing?.partial && !turn.partial);
    const visibleActivities = mergeVisibleActivities(priorVisibleActivities, turn.visibleActivities);
    const duplicateIds = new Set(duplicates.map((duplicate) => duplicate.id));

    if (duplicateIds.size) {
      const conversationEvents = await requestToPromise<ArchiveEvent[]>(
        events.index(INDEXES.events.conversationTime).getAll(
          IDBKeyRange.bound([conversation.id, ''], [conversation.id, '\uffff'])
        )
      );
      for (const event of conversationEvents) {
        const eventMessageId = event.data.messageId;
        if (typeof eventMessageId === 'string' && duplicateIds.has(eventMessageId)) {
          events.delete(event.id);
        }
      }
      for (const duplicate of duplicates) messages.delete(duplicate.id);
    }

    const inheritedModelLabel =
      existing?.modelLabel ??
      duplicates.find((duplicate) => duplicate.modelLabel)?.modelLabel ??
      null;

    const record: ArchiveMessage = {
      id,
      conversationId: conversation.id,
      providerId: turn.providerId,
      providerTurnId: existing?.providerTurnId ?? turn.providerTurnId,
      providerMessageId: turn.providerMessageId ?? existing?.providerMessageId ?? null,
      role: turn.role,
      orderHint: existing?.orderHint ?? turn.orderHint,
      plainText: turn.plainText,
      markdown: turn.markdown,
      partial: turn.partial,
      modelLabel: turn.modelLabel ?? inheritedModelLabel,
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
      messageCount: Math.max(
        0,
        conversation.messageCount + (isNew ? 1 : 0) - duplicates.length
      )
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
    const currentByProviderMessageId = new Map(
      current.flatMap((message) =>
        message.providerMessageId
          ? [[message.providerMessageId, message] as const]
          : []
      )
    );
    const observedStoredIds = turns
      .map((turn) => {
        if (turn.providerMessageId) {
          const providerMatch = currentByProviderMessageId.get(turn.providerMessageId);
          if (providerMatch?.role === turn.role) return providerMatch.id;
        }
        return messageId(conversationId, turn.providerTurnId);
      })
      .filter((id) => currentById.has(id));
    const orderedIds = reconcileObservedTurnOrder(
      previous.map((message) => message.id),
      observedStoredIds
    );

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
    const observedAt = message.observation.type === 'turn-snapshot'
      ? message.observation.observedAt
      : first.observedAt;
    const resolution = await this.resolveConversation({
      identity,
      sourceSessionId: message.sourceSessionId,
      observedAt
    });
    await this.recordResolutionEvents(resolution, observedAt);
    if (resolution.stale) return resolution.conversation.recordingState;

    if (identity.providerConversationId) {
      await this.removeFreshProvisionalDuplicatesMatchingTurns(resolution.conversation, turns);
    }

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
