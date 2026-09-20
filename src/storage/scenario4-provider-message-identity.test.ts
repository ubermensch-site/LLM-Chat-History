import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ContentToBackgroundMessage,
  ProviderTurnObservation,
  RecorderCommandMessage
} from '../shared/types';
import { ArchiveRepository } from './archive';
import { openArchiveDb, requestToPromise } from './db';
import { INDEXES, STORES } from './schema';

const opened: Array<{ name: string; repository: ArchiveRepository; db: IDBDatabase }> = [];

async function createRepository(): Promise<{
  repository: ArchiveRepository;
  db: IDBDatabase;
}> {
  const name = `llm-chat-history-scenario4-${crypto.randomUUID()}`;
  const db = await openArchiveDb({ name, factory: indexedDB });
  const repository = new ArchiveRepository(db);
  opened.push({ name, repository, db });
  return { repository, db };
}

const sourceSessionId = 'scenario4-tab';
const providerConversationId = 'scenario4-chat-b';
const pageUrl = `https://chatgpt.com/c/${providerConversationId}`;

function turn(input: {
  providerTurnId: string;
  providerMessageId: string;
  role: 'user' | 'assistant';
  orderHint: number;
  text: string;
  partial?: boolean;
  observedAt: string;
}): ProviderTurnObservation {
  return {
    providerId: 'chatgpt',
    providerConversationId,
    providerTurnId: input.providerTurnId,
    providerMessageId: input.providerMessageId,
    role: input.role,
    orderHint: input.orderHint,
    plainText: input.text,
    markdown: input.text,
    partial: input.partial ?? false,
    observedAt: input.observedAt
  };
}

function snapshot(
  turns: ProviderTurnObservation[],
  observedAt: string
): ContentToBackgroundMessage {
  return {
    type: 'LLMCH_PROVIDER_OBSERVATION',
    providerId: 'chatgpt',
    sourceSessionId,
    pageUrl,
    observation: { type: 'turn-snapshot', turns, observedAt }
  };
}

function command(
  command: 'pause' | 'resume',
  observedAt: string
): RecorderCommandMessage {
  return {
    type: 'LLMCH_RECORDER_COMMAND',
    requestId: `scenario4:${command}:${observedAt}`,
    providerId: 'chatgpt',
    sourceSessionId,
    pageUrl,
    identity: {
      providerId: 'chatgpt',
      providerConversationId,
      sourceUrl: pageUrl,
      provisional: false
    },
    command,
    observedAt
  };
}

afterEach(async () => {
  while (opened.length) {
    const entry = opened.pop();
    if (!entry) continue;
    entry.repository.close();
    await requestToPromise(indexedDB.deleteDatabase(entry.name));
  }
});

describe('Scenario 4 provider message identity across SPA rerenders', () => {
  it('keeps one canonical message when the turn shell id changes after revisit', async () => {
    const { repository } = await createRepository();

    const user = turn({
      providerTurnId: 'user-turn',
      providerMessageId: 'user-message',
      role: 'user',
      orderHint: 0,
      text: 'Reply with exactly: scenario 4 chat b',
      observedAt: '2026-09-18T09:10:16.142Z'
    });
    const firstAssistantShell = turn({
      providerTurnId: 'request-scenario4-chat-b-0',
      providerMessageId: 'assistant-message-stable',
      role: 'assistant',
      orderHint: 1,
      text: 'scenario 4 chat b',
      observedAt: '2026-09-18T09:10:20.412Z'
    });

    await repository.persistObservation(
      snapshot([user, firstAssistantShell], '2026-09-18T09:10:20.412Z')
    );

    const revisitedAssistantShell = turn({
      providerTurnId: 'c8127800-639b-4391-adb8-3c5a364a70a1',
      providerMessageId: 'assistant-message-stable',
      role: 'assistant',
      orderHint: 1,
      text: 'scenario 4 chat b',
      observedAt: '2026-09-18T09:15:49.790Z'
    });

    await repository.persistObservation(
      snapshot([user, revisitedAssistantShell], '2026-09-18T09:15:49.790Z')
    );

    const [conversation] = await repository.listConversations();
    expect(conversation?.messageCount).toBe(2);

    const messages = await repository.listMessages(conversation!.id);
    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(messages[1]?.providerMessageId).toBe('assistant-message-stable');
    expect(messages[1]?.providerTurnId).toBe('request-scenario4-chat-b-0');
    expect(messages[1]?.plainText).toBe('scenario 4 chat b');

    const events = await repository.listEvents(conversation!.id);
    expect(
      events.filter(
        (event) => event.type === 'message-added' && event.data.role === 'assistant'
      )
    ).toHaveLength(1);
  });

  it('heals an already duplicated provider message on the next observation', async () => {
    const { repository, db } = await createRepository();

    const user = turn({
      providerTurnId: 'user-turn',
      providerMessageId: 'user-message',
      role: 'user',
      orderHint: 0,
      text: 'Scenario 4',
      observedAt: '2026-09-18T09:10:16.142Z'
    });
    const assistant = turn({
      providerTurnId: 'request-original',
      providerMessageId: 'assistant-message-stable',
      role: 'assistant',
      orderHint: 1,
      text: 'scenario 4 chat b',
      observedAt: '2026-09-18T09:10:20.412Z'
    });
    await repository.persistObservation(snapshot([user, assistant], '2026-09-18T09:10:20.412Z'));

    const [conversation] = await repository.listConversations();
    const [, storedAssistant] = await repository.listMessages(conversation!.id);

    const duplicateId = `${conversation!.id}:turn:${encodeURIComponent('rerender-shell')}`;
    const tx = db.transaction([STORES.messages, STORES.conversations, STORES.events], 'readwrite');
    tx.objectStore(STORES.messages).put({
      ...storedAssistant!,
      id: duplicateId,
      providerTurnId: 'rerender-shell',
      orderHint: 2,
      firstObservedAt: '2026-09-18T09:15:49.790Z',
      lastObservedAt: '2026-09-18T09:15:49.790Z',
      updatedAt: '2026-09-18T09:15:49.790Z'
    });
    tx.objectStore(STORES.conversations).put({
      ...conversation!,
      messageCount: 3
    });
    tx.objectStore(STORES.events).put({
      id: 'legacy-duplicate-added',
      conversationId: conversation!.id,
      type: 'message-added',
      createdAt: '2026-09-18T09:15:49.790Z',
      data: {
        messageId: duplicateId,
        role: 'assistant',
        partial: false
      }
    });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
      tx.onerror = () => reject(tx.error ?? new Error('transaction failed'));
    });

    const indexTx = db.transaction(STORES.messages, 'readonly');
    const indexedMatches = await requestToPromise(
      indexTx.objectStore(STORES.messages)
        .index(INDEXES.messages.providerMessage)
        .getAll(IDBKeyRange.only([conversation!.id, 'assistant-message-stable']))
    );
    await new Promise<void>((resolve, reject) => {
      indexTx.oncomplete = () => resolve();
      indexTx.onabort = () => reject(indexTx.error ?? new Error('transaction aborted'));
      indexTx.onerror = () => reject(indexTx.error ?? new Error('transaction failed'));
    });
    expect(indexedMatches).toHaveLength(2);

    const revisit = turn({
      providerTurnId: 'another-shell-id',
      providerMessageId: 'assistant-message-stable',
      role: 'assistant',
      orderHint: 1,
      text: 'scenario 4 chat b',
      observedAt: '2026-09-18T09:16:30.000Z'
    });
    await repository.persistObservation(snapshot([user, revisit], '2026-09-18T09:16:30.000Z'));

    const [healedConversation] = await repository.listConversations();
    expect(healedConversation?.messageCount).toBe(2);
    const healedMessages = await repository.listMessages(healedConversation!.id);
    expect(healedMessages).toHaveLength(2);
    expect(
      healedMessages.filter((message) => message.providerMessageId === 'assistant-message-stable')
    ).toHaveLength(1);

    const healedEvents = await repository.listEvents(healedConversation!.id);
    expect(healedEvents.some((event) => event.id === 'legacy-duplicate-added')).toBe(false);
  });

  it('keeps paused content suppressed when the provider turn shell id changes after resume', async () => {
    const { repository } = await createRepository();

    await repository.applyRecorderCommand(command('pause', '2026-09-18T09:20:00.000Z'));

    const privateTurn = turn({
      providerTurnId: 'paused-shell-a',
      providerMessageId: 'paused-message-stable',
      role: 'assistant',
      orderHint: 0,
      text: 'private paused response',
      observedAt: '2026-09-18T09:20:01.000Z'
    });
    await repository.persistObservation(snapshot([privateTurn], '2026-09-18T09:20:01.000Z'));

    await repository.applyRecorderCommand(command('resume', '2026-09-18T09:20:02.000Z'));

    const rerenderedPrivateTurn = turn({
      providerTurnId: 'paused-shell-b',
      providerMessageId: 'paused-message-stable',
      role: 'assistant',
      orderHint: 0,
      text: 'private paused response',
      observedAt: '2026-09-18T09:20:03.000Z'
    });
    await repository.persistObservation(
      snapshot([rerenderedPrivateTurn], '2026-09-18T09:20:03.000Z')
    );

    const [conversation] = await repository.listConversations();
    const messages = await repository.listMessages(conversation!.id);
    expect(messages).toHaveLength(0);

    const events = await repository.listEvents(conversation!.id);
    const suppressed = events.filter((event) => event.type === 'turn-suppressed');
    expect(suppressed.some((event) => event.id.includes('suppressed-slot:'))).toBe(true);
    expect(suppressed.some((event) => event.data.providerMessageId === 'paused-message-stable')).toBe(true);
    expect(JSON.stringify(events)).not.toContain('private paused response');
  });
});
