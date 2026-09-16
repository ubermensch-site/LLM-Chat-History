import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ContentToBackgroundMessage,
  ProviderObservation,
  ProviderVisibleActivityObservation
} from '../shared/types';
import { ArchiveRepository } from './archive';
import { openArchiveDb, requestToPromise } from './db';
import { INDEXES, STORES } from './schema';

const opened: Array<{ name: string; repository: ArchiveRepository }> = [];

async function createRepository(): Promise<ArchiveRepository> {
  const name = `llm-chat-history-test-${crypto.randomUUID()}`;
  const db = await openArchiveDb({ name, factory: indexedDB });
  const repository = new ArchiveRepository(db);
  opened.push({ name, repository });
  return repository;
}

function envelope(
  sourceSessionId: string,
  observation: ProviderObservation,
  pageUrl = 'https://chatgpt.com/'
): ContentToBackgroundMessage {
  return {
    type: 'LLMCH_PROVIDER_OBSERVATION',
    providerId: 'chatgpt',
    sourceSessionId,
    pageUrl,
    observation
  };
}

function conversationObservation(
  providerConversationId: string | null,
  sourceUrl: string,
  observedAt: string,
  title: string | null = null
): ProviderObservation {
  return {
    type: 'conversation',
    identity: {
      providerId: 'chatgpt',
      providerConversationId,
      sourceUrl,
      provisional: providerConversationId === null
    },
    title,
    observedAt
  };
}

function turnObservation(input: {
  providerConversationId: string | null;
  providerTurnId: string;
  role: 'user' | 'assistant';
  orderHint: number;
  plainText: string;
  partial?: boolean;
  modelLabel?: string | null;
  visibleActivities?: ProviderVisibleActivityObservation[];
  observedAt: string;
}): ProviderObservation {
  return {
    type: 'turn-upsert',
    turn: {
      providerId: 'chatgpt',
      providerConversationId: input.providerConversationId,
      providerTurnId: input.providerTurnId,
      providerMessageId: input.providerTurnId,
      role: input.role,
      orderHint: input.orderHint,
      plainText: input.plainText,
      markdown: input.plainText,
      partial: input.partial ?? false,
      ...(input.modelLabel !== undefined ? { modelLabel: input.modelLabel } : {}),
      ...(input.visibleActivities?.length ? { visibleActivities: input.visibleActivities } : {}),
      observedAt: input.observedAt
    }
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

describe('archive schema v2', () => {
  it('creates the canonical stores and indexes', async () => {
    const name = `llm-chat-history-schema-${crypto.randomUUID()}`;
    const db = await openArchiveDb({ name, factory: indexedDB });

    expect([...db.objectStoreNames]).toEqual([
      STORES.conversations,
      STORES.events,
      STORES.messages,
      STORES.projects
    ]);

    const transaction = db.transaction(
      [STORES.conversations, STORES.messages, STORES.events, STORES.projects],
      'readonly'
    );
    expect([...transaction.objectStore(STORES.conversations).indexNames]).toContain(
      INDEXES.conversations.providerKey
    );
    expect([...transaction.objectStore(STORES.messages).indexNames]).toContain(
      INDEXES.messages.conversationOrder
    );
    expect([...transaction.objectStore(STORES.events).indexNames]).toContain(
      INDEXES.events.conversationTime
    );
    expect([...transaction.objectStore(STORES.projects).indexNames]).toContain(
      INDEXES.projects.name
    );

    db.close();
    await requestToPromise(indexedDB.deleteDatabase(name));
  });

  it('promotes a provisional chat without duplicating the archive', async () => {
    const repository = await createRepository();
    const session = 'session-a';

    await repository.persistObservation(
      envelope(session, conversationObservation(null, 'https://chatgpt.com/', '2026-09-16T09:00:00.000Z'))
    );
    await repository.persistObservation(
      envelope(
        session,
        turnObservation({
          providerConversationId: null,
          providerTurnId: 'user-1',
          role: 'user',
          orderHint: 0,
          plainText: 'hello',
          observedAt: '2026-09-16T09:00:01.000Z'
        })
      )
    );

    await repository.persistObservation(
      envelope(
        session,
        conversationObservation(
          'conversation-123',
          'https://chatgpt.com/c/conversation-123',
          '2026-09-16T09:00:02.000Z',
          'Example chat'
        ),
        'https://chatgpt.com/c/conversation-123'
      )
    );

    const conversations = await repository.listConversations();
    expect(conversations).toHaveLength(1);
    expect(conversations[0]?.providerConversationId).toBe('conversation-123');
    expect(conversations[0]?.provisional).toBe(false);
    expect(conversations[0]?.title).toBe('Example chat');

    const messages = await repository.listMessages(conversations[0]!.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.plainText).toBe('hello');
  });

  it('upserts streaming turns, preserves visible activity and model labels, and avoids duplicates', async () => {
    const repository = await createRepository();
    const session = 'session-b';
    const conversationId = 'conversation-456';
    const pageUrl = `https://chatgpt.com/c/${conversationId}`;

    await repository.persistObservation(
      envelope(
        session,
        conversationObservation(conversationId, pageUrl, '2026-09-16T10:00:00.000Z', 'Streaming'),
        pageUrl
      )
    );
    await repository.persistObservation(
      envelope(
        session,
        turnObservation({
          providerConversationId: conversationId,
          providerTurnId: 'user-1',
          role: 'user',
          orderHint: 0,
          plainText: 'Question',
          observedAt: '2026-09-16T10:00:01.000Z'
        }),
        pageUrl
      )
    );
    await repository.persistObservation(
      envelope(
        session,
        turnObservation({
          providerConversationId: conversationId,
          providerTurnId: 'assistant-1',
          role: 'assistant',
          orderHint: 1,
          plainText: 'Partial',
          partial: true,
          visibleActivities: [
            {
              providerActivityId: 'assistant-1:visible:0:a',
              kind: 'reasoning-summary',
              text: 'Thinking',
              orderHint: 0,
              observedAt: '2026-09-16T10:00:02.000Z'
            }
          ],
          observedAt: '2026-09-16T10:00:02.000Z'
        }),
        pageUrl
      )
    );
    await repository.persistObservation(
      envelope(
        session,
        turnObservation({
          providerConversationId: conversationId,
          providerTurnId: 'assistant-1',
          role: 'assistant',
          orderHint: 1,
          plainText: 'Final answer',
          partial: false,
          modelLabel: 'GPT-5.6 Sol',
          visibleActivities: [
            {
              providerActivityId: 'assistant-1:visible:1:b',
              kind: 'tool',
              text: 'Fetched branch files',
              orderHint: 1,
              observedAt: '2026-09-16T10:00:03.000Z'
            }
          ],
          observedAt: '2026-09-16T10:00:03.000Z'
        }),
        pageUrl
      )
    );
    await repository.persistObservation(
      envelope(
        session,
        turnObservation({
          providerConversationId: conversationId,
          providerTurnId: 'assistant-1',
          role: 'assistant',
          orderHint: 1,
          plainText: 'Final answer',
          partial: false,
          observedAt: '2026-09-16T10:00:04.000Z'
        }),
        pageUrl
      )
    );

    const conversations = await repository.listConversations();
    expect(conversations).toHaveLength(1);
    expect(conversations[0]?.messageCount).toBe(2);

    const messages = await repository.listMessages(conversations[0]!.id);
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(messages[1]?.plainText).toBe('Final answer');
    expect(messages[1]?.partial).toBe(false);
    expect(messages[1]?.modelLabel).toBe('GPT-5.6 Sol');
    expect(messages[1]?.visibleActivities?.map((activity) => activity.text)).toEqual([
      'Thinking',
      'Fetched branch files'
    ]);

    const events = await repository.listEvents(conversations[0]!.id);
    expect(events.filter((event) => event.type === 'message-added')).toHaveLength(2);
    expect(events.some((event) => event.type === 'message-updated')).toBe(true);
    expect(events.some((event) => event.type === 'message-finalized')).toBe(true);
  });
});
