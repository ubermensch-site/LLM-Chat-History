import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { openMirrorSettingsDb } from './connection';
import {
  clearMirrorLocation,
  getStoredMirrorLocation,
  storeMirrorLocation,
  type StoredMirrorLocation
} from './mirror-state';

const databases: Array<{ name: string; db: IDBDatabase }> = [];

async function createDb(): Promise<IDBDatabase> {
  const name = `llm-chat-history-mirror-state-${crypto.randomUUID()}`;
  const db = await openMirrorSettingsDb({ name, factory: indexedDB });
  databases.push({ name, db });
  return db;
}

afterEach(async () => {
  while (databases.length) {
    const entry = databases.pop();
    if (!entry) continue;
    entry.db.close();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(entry.name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
});

describe('filesystem mirror location state', () => {
  it('persists current and stale paths independently for each conversation', async () => {
    const db = await createDb();
    const location: StoredMirrorLocation = {
      conversationId: 'conv:one',
      current: ['LLM Chat History', 'Project', '2026-09', 'current.md'],
      stale: [['LLM Chat History', 'Old Project', '2026-09', 'old.md']],
      mirroredAt: '2026-09-16T12:00:00.000Z'
    };

    await storeMirrorLocation(db, location);
    await storeMirrorLocation(db, {
      conversationId: 'conv:two',
      current: ['LLM Chat History', 'Unsorted', '2026-09', 'two.md'],
      stale: [],
      mirroredAt: '2026-09-16T12:01:00.000Z'
    });

    expect(await getStoredMirrorLocation(db, 'conv:one')).toEqual(location);
    expect((await getStoredMirrorLocation(db, 'conv:two'))?.current[3]).toBe('two.md');
  });

  it('clears only the requested conversation location record', async () => {
    const db = await createDb();
    await storeMirrorLocation(db, {
      conversationId: 'conv:one',
      current: ['LLM Chat History', 'Project', '2026-09', 'one.md'],
      stale: [],
      mirroredAt: '2026-09-16T12:00:00.000Z'
    });
    await storeMirrorLocation(db, {
      conversationId: 'conv:two',
      current: ['LLM Chat History', 'Project', '2026-09', 'two.md'],
      stale: [],
      mirroredAt: '2026-09-16T12:00:00.000Z'
    });

    await clearMirrorLocation(db, 'conv:one');
    expect(await getStoredMirrorLocation(db, 'conv:one')).toBeNull();
    expect(await getStoredMirrorLocation(db, 'conv:two')).not.toBeNull();
  });
});
