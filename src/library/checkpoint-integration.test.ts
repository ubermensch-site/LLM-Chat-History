import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  renderJsonExport,
  renderMarkdownExport,
  type ArchiveExportBundle
} from '../export/export';
import { parseJsonArchiveExport } from '../import/json-import';
import { listCheckpoints } from '../storage/checkpoints';
import { openArchiveDb, requestToPromise, transactionDone } from '../storage/db';
import { importArchiveBundle } from '../storage/import';
import { STORES, type ArchiveConversation, type ArchiveEvent } from '../storage/schema';
import { searchLibraryRecords } from './full-text-search';
import type { LibraryRecord } from './search';

const databases: Array<{ name: string; db: IDBDatabase }> = [];

function sourceBundle(): ArchiveExportBundle {
  const conversation: ArchiveConversation = {
    id: 'conv:source-checkpoint',
    providerId: 'chatgpt',
    providerConversationId: 'provider-checkpoint-shared',
    providerKey: 'chatgpt:provider-checkpoint-shared',
    provisional: false,
    sourceUrl: 'https://chatgpt.com/c/provider-checkpoint-shared',
    title: 'Checkpoint portability',
    createdAt: '2026-09-16T10:00:00.000Z',
    updatedAt: '2026-09-16T10:05:00.000Z',
    lastObservedAt: '2026-09-16T10:05:00.000Z',
    messageCount: 0,
    recordingState: 'recording',
    recordingStateUpdatedAt: '2026-09-16T10:00:00.000Z'
  };
  const checkpoint: ArchiveEvent = {
    id: 'checkpoint:source-1',
    conversationId: conversation.id,
    type: 'checkpoint',
    createdAt: '2026-09-16T10:03:00.000Z',
    data: {
      name: 'Catalog approved',
      note: 'Owner confirmed final product facts.',
      updatedAt: '2026-09-16T10:04:00.000Z'
    }
  };
  return {
    conversation,
    messages: [],
    events: [checkpoint],
    exportedAt: '2026-09-16T10:06:00.000Z'
  };
}

async function newDb(prefix: string): Promise<IDBDatabase> {
  const name = `${prefix}-${crypto.randomUUID()}`;
  const db = await openArchiveDb({ name, factory: indexedDB });
  databases.push({ name, db });
  return db;
}

afterEach(async () => {
  while (databases.length) {
    const entry = databases.pop();
    if (!entry) continue;
    entry.db.close();
    await requestToPromise(indexedDB.deleteDatabase(entry.name));
  }
});

describe('checkpoint search/export/import integration', () => {
  it('searches checkpoint names/notes and includes them in Markdown and JSON', () => {
    const bundle = sourceBundle();
    const record: LibraryRecord = {
      conversation: bundle.conversation,
      messages: [],
      project: undefined,
      checkpoints: [
        {
          id: bundle.events[0]!.id,
          conversationId: bundle.conversation.id,
          name: 'Catalog approved',
          note: 'Owner confirmed final product facts.',
          createdAt: bundle.events[0]!.createdAt,
          updatedAt: '2026-09-16T10:04:00.000Z'
        }
      ]
    };

    expect(searchLibraryRecords([record], 'final product facts')[0]).toMatchObject({
      kind: 'checkpoint',
      checkpointId: 'checkpoint:source-1',
      field: 'checkpoint'
    });

    const markdown = renderMarkdownExport(bundle);
    expect(markdown).toContain('Checkpoint — Catalog approved');
    expect(markdown).toContain('Owner confirmed final product facts.');

    const restored = parseJsonArchiveExport(renderJsonExport(bundle));
    expect(restored.events).toEqual(bundle.events);
  });

  it('restores checkpoints idempotently into a fresh archive', async () => {
    const db = await newDb('llm-chat-history-checkpoint-fresh');
    const bundle = sourceBundle();
    const first = await importArchiveBundle(db, bundle);
    const second = await importArchiveBundle(db, bundle);

    expect(first.eventsAdded).toBe(1);
    expect(second.eventsAdded).toBe(0);
    expect(await listCheckpoints(db, bundle.conversation.id)).toMatchObject([
      {
        id: 'checkpoint:source-1',
        name: 'Catalog approved',
        note: 'Owner confirmed final product facts.'
      }
    ]);
  });

  it('keeps checkpoint identity valid and deterministic when merging across installations', async () => {
    const db = await newDb('llm-chat-history-checkpoint-merge');
    const bundle = sourceBundle();
    const localConversation: ArchiveConversation = {
      ...bundle.conversation,
      id: 'conv:local-target',
      providerId: 'chatgpt',
      providerConversationId: 'provider-checkpoint-shared',
      providerKey: 'chatgpt:provider-checkpoint-shared',
      provisional: false,
      createdAt: '2026-09-16T09:00:00.000Z',
      updatedAt: '2026-09-16T09:00:00.000Z',
      lastObservedAt: '2026-09-16T09:00:00.000Z'
    };
    const transaction = db.transaction(STORES.conversations, 'readwrite');
    transaction.objectStore(STORES.conversations).add(localConversation);
    await transactionDone(transaction);

    const first = await importArchiveBundle(db, bundle);
    const second = await importArchiveBundle(db, bundle);
    expect(first.conversationId).toBe(localConversation.id);
    expect(first.eventsAdded).toBe(1);
    expect(second.eventsAdded).toBe(0);

    const checkpoints = await listCheckpoints(db, localConversation.id);
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]!.id).toMatch(/^checkpoint:import:/);

    const events = await requestToPromise<ArchiveEvent[]>(
      db.transaction(STORES.events, 'readonly').objectStore(STORES.events).getAll()
    );
    const reExport: ArchiveExportBundle = {
      conversation: localConversation,
      messages: [],
      events,
      exportedAt: '2026-09-16T11:00:00.000Z'
    };
    expect(() => parseJsonArchiveExport(renderJsonExport(reExport))).not.toThrow();
  });
});
