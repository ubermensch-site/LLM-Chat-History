import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { ArchiveExportBundle } from '../export/export';
import { messageId } from './ids';
import { ArchiveRepository } from './archive';
import { openArchiveDb, requestToPromise } from './db';
import { ArchiveImportConflictError, importArchiveBundle } from './import';
import type { ArchiveConversation, ArchiveEvent, ArchiveMessage } from './schema';

const opened: Array<{ name: string; db: IDBDatabase }> = [];

async function createDb(): Promise<IDBDatabase> {
  const name = `llm-chat-history-import-${crypto.randomUUID()}`;
  const db = await openArchiveDb({ name, factory: indexedDB });
  opened.push({ name, db });
  return db;
}

function makeBundle(input: {
  internalId: string;
  providerConversationId: string;
  title: string;
  updatedAt: string;
  turns: Array<{ id: string; role: 'user' | 'assistant'; text: string; at: string }>;
  suppressedTurnId?: string;
}): ArchiveExportBundle {
  const conversation: ArchiveConversation = {
    id: input.internalId,
    providerId: 'chatgpt',
    providerConversationId: input.providerConversationId,
    providerKey: `chatgpt:${input.providerConversationId}`,
    provisional: false,
    sourceUrl: `https://chatgpt.com/c/${input.providerConversationId}`,
    title: input.title,
    createdAt: input.turns[0]?.at ?? input.updatedAt,
    updatedAt: input.updatedAt,
    lastObservedAt: input.updatedAt,
    messageCount: input.turns.length,
    recordingState: 'recording',
    recordingStateUpdatedAt: input.updatedAt
  };

  const messages: ArchiveMessage[] = input.turns.map((turn, index) => ({
    id: messageId(conversation.id, turn.id),
    conversationId: conversation.id,
    providerId: 'chatgpt',
    providerTurnId: turn.id,
    providerMessageId: turn.id,
    role: turn.role,
    orderHint: index,
    plainText: turn.text,
    markdown: turn.text,
    partial: false,
    contentHash: `hash:${turn.id}:${turn.text}`,
    firstObservedAt: turn.at,
    lastObservedAt: turn.at,
    updatedAt: turn.at
  }));

  const events: ArchiveEvent[] = [
    {
      id: `created:${conversation.id}`,
      conversationId: conversation.id,
      type: 'conversation-created',
      createdAt: conversation.createdAt,
      data: { provisional: false }
    },
    ...messages.map(
      (message): ArchiveEvent => ({
        id: `added:${conversation.id}:${message.providerTurnId}`,
        conversationId: conversation.id,
        type: 'message-added',
        createdAt: message.firstObservedAt,
        data: { messageId: message.id, role: message.role, partial: false }
      })
    )
  ];

  if (input.suppressedTurnId) {
    events.push({
      id: `suppressed:${conversation.id}:${encodeURIComponent(input.suppressedTurnId)}`,
      conversationId: conversation.id,
      type: 'turn-suppressed',
      createdAt: input.updatedAt,
      data: { providerTurnId: input.suppressedTurnId, reason: 'paused' }
    });
  }

  return {
    conversation,
    messages,
    events,
    exportedAt: '2026-09-16T12:00:00.000Z'
  };
}

afterEach(async () => {
  while (opened.length) {
    const entry = opened.pop();
    if (!entry) continue;
    entry.db.close();
    await requestToPromise(indexedDB.deleteDatabase(entry.name));
  }
});

describe('archive JSON restore persistence', () => {
  it('preserves normalized IDs, order, metadata and privacy events on a fresh restore', async () => {
    const db = await createDb();
    const source = makeBundle({
      internalId: 'conv:chatgpt:backup-a',
      providerConversationId: 'provider-a',
      title: 'Fresh restore',
      updatedAt: '2026-09-16T10:05:00.000Z',
      turns: [
        { id: 'u1', role: 'user', text: 'Question', at: '2026-09-16T10:01:00.000Z' },
        { id: 'a1', role: 'assistant', text: 'Answer', at: '2026-09-16T10:02:00.000Z' }
      ],
      suppressedTurnId: 'private-1'
    });

    const result = await importArchiveBundle(db, source);
    expect(result).toMatchObject({
      conversationId: source.conversation.id,
      created: true,
      merged: false,
      messagesAdded: 2
    });

    const repository = new ArchiveRepository(db);
    const [conversation] = await repository.listConversations();
    expect(conversation).toEqual(source.conversation);
    expect(await repository.listMessages(conversation!.id)).toEqual(source.messages);
    const restoredEvents = await repository.listEvents(conversation!.id);
    expect(restoredEvents).toHaveLength(source.events.length);
    expect([...restoredEvents].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [...source.events].sort((a, b) => a.id.localeCompare(b.id))
    );
  });

  it('is idempotent when the same backup is imported twice', async () => {
    const db = await createDb();
    const source = makeBundle({
      internalId: 'conv:chatgpt:backup-b',
      providerConversationId: 'provider-b',
      title: 'Duplicate restore',
      updatedAt: '2026-09-16T11:05:00.000Z',
      turns: [
        { id: 'u1', role: 'user', text: 'One', at: '2026-09-16T11:01:00.000Z' },
        { id: 'a1', role: 'assistant', text: 'Two', at: '2026-09-16T11:02:00.000Z' }
      ]
    });

    await importArchiveBundle(db, source);
    const second = await importArchiveBundle(db, source);
    expect(second).toMatchObject({
      conversationId: source.conversation.id,
      created: false,
      merged: true,
      messagesAdded: 0,
      messagesUpdated: 0,
      eventsAdded: 0
    });

    const repository = new ArchiveRepository(db);
    expect(await repository.listConversations()).toHaveLength(1);
    expect(await repository.listMessages(source.conversation.id)).toHaveLength(2);
    expect(await repository.listEvents(source.conversation.id)).toHaveLength(source.events.length);
  });

  it('merges the same provider conversation from another installation into the local canonical ID', async () => {
    const db = await createDb();
    const local = makeBundle({
      internalId: 'conv:chatgpt:local',
      providerConversationId: 'provider-shared',
      title: 'Local title',
      updatedAt: '2026-09-16T12:03:00.000Z',
      turns: [
        { id: 'u1', role: 'user', text: 'Question', at: '2026-09-16T12:01:00.000Z' }
      ]
    });
    const remote = makeBundle({
      internalId: 'conv:chatgpt:other-install',
      providerConversationId: 'provider-shared',
      title: 'Newer backup title',
      updatedAt: '2026-09-16T12:08:00.000Z',
      turns: [
        { id: 'u1', role: 'user', text: 'Question', at: '2026-09-16T12:01:00.000Z' },
        { id: 'a1', role: 'assistant', text: 'Answer', at: '2026-09-16T12:07:00.000Z' }
      ],
      suppressedTurnId: 'private-cross-install'
    });

    await importArchiveBundle(db, local);
    const result = await importArchiveBundle(db, remote);
    expect(result.conversationId).toBe(local.conversation.id);
    expect(result.merged).toBe(true);
    expect(result.messagesAdded).toBe(1);

    const repository = new ArchiveRepository(db);
    const conversations = await repository.listConversations();
    expect(conversations).toHaveLength(1);
    expect(conversations[0]?.id).toBe(local.conversation.id);
    expect(conversations[0]?.title).toBe('Newer backup title');
    expect(conversations[0]?.messageCount).toBe(2);

    const messages = await repository.listMessages(local.conversation.id);
    expect(messages.map((message) => message.id)).toEqual([
      messageId(local.conversation.id, 'u1'),
      messageId(local.conversation.id, 'a1')
    ]);

    const events = await repository.listEvents(local.conversation.id);
    expect(
      events.some(
        (event) =>
          event.id ===
          `suppressed:${local.conversation.id}:${encodeURIComponent('private-cross-install')}`
      )
    ).toBe(true);
    const importedAdded = events.find(
      (event) =>
        event.type === 'message-added' && event.data.messageId === messageId(local.conversation.id, 'a1')
    );
    expect(importedAdded).toBeDefined();
  });

  it('rejects an internal-ID collision with unrelated provider history without partial writes', async () => {
    const db = await createDb();
    const original = makeBundle({
      internalId: 'conv:chatgpt:collision',
      providerConversationId: 'provider-original',
      title: 'Original',
      updatedAt: '2026-09-16T13:02:00.000Z',
      turns: [{ id: 'u1', role: 'user', text: 'Keep me', at: '2026-09-16T13:01:00.000Z' }]
    });
    const collision = makeBundle({
      internalId: 'conv:chatgpt:collision',
      providerConversationId: 'provider-other',
      title: 'Must not overwrite',
      updatedAt: '2026-09-16T13:05:00.000Z',
      turns: [{ id: 'u2', role: 'user', text: 'Do not import', at: '2026-09-16T13:04:00.000Z' }]
    });

    await importArchiveBundle(db, original);
    await expect(importArchiveBundle(db, collision)).rejects.toBeInstanceOf(
      ArchiveImportConflictError
    );

    const repository = new ArchiveRepository(db);
    const [conversation] = await repository.listConversations();
    expect(conversation?.providerConversationId).toBe('provider-original');
    expect(conversation?.title).toBe('Original');
    expect((await repository.listMessages(conversation!.id)).map((message) => message.plainText)).toEqual([
      'Keep me'
    ]);
  });
});
