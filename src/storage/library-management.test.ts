import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { ContentToBackgroundMessage, ProviderObservation } from '../shared/types';
import { conversationDisplayTitle } from './conversation';
import { ArchiveRepository } from './archive';
import { openArchiveDb, requestToPromise } from './db';
import {
  deleteConversationCascade,
  renameConversation,
  setConversationArchived,
  setConversationFavorite,
  setConversationPinned
} from './library-management';

const opened: Array<{ name: string; db: IDBDatabase }> = [];

async function createArchive(): Promise<{ db: IDBDatabase; repository: ArchiveRepository }> {
  const name = `llm-chat-history-library-management-${crypto.randomUUID()}`;
  const db = await openArchiveDb({ name, factory: indexedDB });
  opened.push({ name, db });
  return { db, repository: new ArchiveRepository(db) };
}

function envelope(observation: ProviderObservation): ContentToBackgroundMessage {
  return {
    type: 'LLMCH_PROVIDER_OBSERVATION',
    providerId: 'chatgpt',
    sourceSessionId: 'library-session',
    pageUrl: 'https://chatgpt.com/c/library-test',
    observation
  };
}

function conversation(title: string, observedAt: string): ContentToBackgroundMessage {
  return envelope({
    type: 'conversation',
    identity: {
      providerId: 'chatgpt',
      providerConversationId: 'library-test',
      sourceUrl: 'https://chatgpt.com/c/library-test',
      provisional: false
    },
    title,
    observedAt
  });
}

function turn(observedAt: string): ContentToBackgroundMessage {
  return envelope({
    type: 'turn-upsert',
    turn: {
      providerId: 'chatgpt',
      providerConversationId: 'library-test',
      providerTurnId: 'user-1',
      providerMessageId: 'user-1',
      role: 'user',
      orderHint: 0,
      plainText: 'Keep this captured turn',
      markdown: 'Keep this captured turn',
      partial: false,
      observedAt
    }
  });
}

afterEach(async () => {
  while (opened.length) {
    const entry = opened.pop();
    if (!entry) continue;
    entry.db.close();
    await requestToPromise(indexedDB.deleteDatabase(entry.name));
  }
});

describe('Library conversation management', () => {
  it('keeps a user rename durable across later provider title observations', async () => {
    const { db, repository } = await createArchive();
    await repository.persistObservation(conversation('Provider title', '2026-09-16T14:00:00.000Z'));
    const [created] = await repository.listConversations();

    await renameConversation(
      db,
      created!.id,
      '  My durable library name  ',
      '2026-09-16T14:01:00.000Z'
    );
    await repository.persistObservation(
      conversation('Provider title changed later', '2026-09-16T14:02:00.000Z')
    );

    const [updated] = await repository.listConversations();
    expect(updated?.title).toBe('Provider title changed later');
    expect(updated?.customTitle).toBe('My durable library name');
    expect(conversationDisplayTitle(updated!)).toBe('My durable library name');

    await renameConversation(db, updated!.id, null, '2026-09-16T14:03:00.000Z');
    const [cleared] = await repository.listConversations();
    expect(cleared?.customTitle).toBeUndefined();
    expect(conversationDisplayTitle(cleared!)).toBe('Provider title changed later');
  });

  it('archives and unarchives without changing provider identity or recorder state', async () => {
    const { db, repository } = await createArchive();
    await repository.persistObservation(conversation('Archive me', '2026-09-16T15:00:00.000Z'));
    const [created] = await repository.listConversations();

    const archived = await setConversationArchived(
      db,
      created!.id,
      true,
      '2026-09-16T15:01:00.000Z'
    );
    expect(archived.archivedAt).toBe('2026-09-16T15:01:00.000Z');
    expect(archived.providerConversationId).toBe(created?.providerConversationId);
    expect(archived.recordingState).toBe(created?.recordingState);

    const restored = await setConversationArchived(
      db,
      created!.id,
      false,
      '2026-09-16T15:02:00.000Z'
    );
    expect(restored.archivedAt).toBeUndefined();
    expect(restored.providerConversationId).toBe('library-test');
    expect(restored.recordingState).toBe('recording');
  });

  it('persists favorite and pin state independently from provider capture fields', async () => {
    const { db, repository } = await createArchive();
    await repository.persistObservation(conversation('Organize me', '2026-09-16T15:30:00.000Z'));
    const [created] = await repository.listConversations();

    const favorite = await setConversationFavorite(
      db,
      created!.id,
      true,
      '2026-09-16T15:31:00.000Z'
    );
    expect(favorite.favoriteAt).toBe('2026-09-16T15:31:00.000Z');
    expect(favorite.providerConversationId).toBe(created?.providerConversationId);

    const pinned = await setConversationPinned(
      db,
      created!.id,
      true,
      '2026-09-16T15:32:00.000Z'
    );
    expect(pinned.pinnedAt).toBe('2026-09-16T15:32:00.000Z');
    expect(pinned.favoriteAt).toBe('2026-09-16T15:31:00.000Z');

    const unfavorited = await setConversationFavorite(
      db,
      created!.id,
      false,
      '2026-09-16T15:33:00.000Z'
    );
    expect(unfavorited.favoriteAt).toBeUndefined();
    expect(unfavorited.pinnedAt).toBe('2026-09-16T15:32:00.000Z');

    const unpinned = await setConversationPinned(
      db,
      created!.id,
      false,
      '2026-09-16T15:34:00.000Z'
    );
    expect(unpinned.pinnedAt).toBeUndefined();
  });

  it('deletes the conversation, messages and conversation events atomically', async () => {
    const { db, repository } = await createArchive();
    await repository.persistObservation(conversation('Delete me', '2026-09-16T16:00:00.000Z'));
    await repository.persistObservation(turn('2026-09-16T16:01:00.000Z'));
    const [created] = await repository.listConversations();
    const beforeMessages = await repository.listMessages(created!.id);
    const beforeEvents = await repository.listEvents(created!.id);
    expect(beforeMessages.length).toBeGreaterThan(0);
    expect(beforeEvents.length).toBeGreaterThan(0);

    const result = await deleteConversationCascade(db, created!.id);
    expect(result.messagesDeleted).toBe(beforeMessages.length);
    expect(result.eventsDeleted).toBe(beforeEvents.length);
    expect(await repository.listConversations()).toHaveLength(0);
    expect(await repository.listMessages(created!.id)).toHaveLength(0);
    expect(await repository.listEvents(created!.id)).toHaveLength(0);
  });
});
