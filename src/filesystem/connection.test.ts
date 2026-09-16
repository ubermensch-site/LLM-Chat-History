import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearStoredDirectoryHandle,
  getStoredDirectoryHandle,
  healthFromPermission,
  openMirrorSettingsDb,
  pickAndStoreDirectory,
  queryDirectoryHealth,
  requestStoredDirectoryPermission,
  storeDirectoryHandle
} from './connection';

const databases: Array<{ name: string; db: IDBDatabase }> = [];

async function createDb(): Promise<IDBDatabase> {
  const name = `llm-chat-history-filesystem-test-${crypto.randomUUID()}`;
  const db = await openMirrorSettingsDb({ name, factory: indexedDB });
  databases.push({ name, db });
  return db;
}

function handle(
  name: string,
  query: 'granted' | 'prompt' | 'denied' = 'granted',
  request: 'granted' | 'prompt' | 'denied' = query
): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name,
    queryPermission: async () => query,
    requestPermission: async () => request
  } as unknown as FileSystemDirectoryHandle;
}

function targetWithPicker(
  picker: () => Promise<FileSystemDirectoryHandle>
): Window {
  return {
    showDirectoryPicker: picker
  } as unknown as Window;
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

describe('filesystem folder connection', () => {
  it('maps permission states to visible mirror health', () => {
    expect(healthFromPermission('Archive', 'granted')).toEqual({
      state: 'connected',
      folderName: 'Archive',
      detail: null
    });
    expect(healthFromPermission('Archive', 'prompt').state).toBe('permission-needed');
    expect(healthFromPermission('Archive', 'denied').state).toBe('denied');
  });

  it('persists and disconnects a stored directory handle independently of chat data', async () => {
    const db = await createDb();
    const plainHandle = { kind: 'directory', name: 'LLM Archive' } as FileSystemDirectoryHandle;
    await storeDirectoryHandle(db, plainHandle);
    expect((await getStoredDirectoryHandle(db))?.name).toBe('LLM Archive');

    await clearStoredDirectoryHandle(db);
    expect(await getStoredDirectoryHandle(db)).toBeNull();
  });

  it('queries restored permissions without requesting them automatically', async () => {
    let requests = 0;
    const restored = {
      kind: 'directory',
      name: 'Archive',
      queryPermission: async () => 'prompt',
      requestPermission: async () => {
        requests += 1;
        return 'granted';
      }
    } as unknown as FileSystemDirectoryHandle;
    const health = await queryDirectoryHealth(restored, targetWithPicker(async () => restored));
    expect(health.state).toBe('permission-needed');
    expect(requests).toBe(0);
  });

  it('requests permission only through the explicit reconnect operation', async () => {
    const db = await createDb();
    const persisted = { kind: 'directory', name: 'Archive' } as FileSystemDirectoryHandle;
    await storeDirectoryHandle(db, persisted);

    const restored = await getStoredDirectoryHandle(db);
    expect(restored?.name).toBe('Archive');

    const permissionHandle = handle('Archive', 'prompt', 'granted');
    await storeDirectoryHandle(db, permissionHandle).catch(() => undefined);
    const fakeDb = await createDb();
    const storable = { kind: 'directory', name: 'Archive' } as FileSystemDirectoryHandle;
    await storeDirectoryHandle(fakeDb, storable);

    // requestStoredDirectoryPermission is exercised with a handle that supplies the browser permission methods.
    const objectStore = fakeDb.transaction('settings', 'readwrite').objectStore('settings');
    objectStore.put({ key: 'archive-directory', value: permissionHandle });
    const health = await requestStoredDirectoryPermission(
      fakeDb,
      targetWithPicker(async () => permissionHandle)
    );
    expect(health.state).toBe('connected');
  });

  it('does not replace the previous connection when the picker is canceled', async () => {
    const db = await createDb();
    const previous = { kind: 'directory', name: 'Existing Archive' } as FileSystemDirectoryHandle;
    await storeDirectoryHandle(db, previous);
    const abort = new DOMException('Canceled', 'AbortError');

    await expect(
      pickAndStoreDirectory(db, targetWithPicker(async () => Promise.reject(abort)))
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect((await getStoredDirectoryHandle(db))?.name).toBe('Existing Archive');
  });

  it('returns an unsupported state when the picker API is unavailable', async () => {
    const health = await queryDirectoryHealth(null, {} as Window);
    expect(health.state).toBe('unsupported');
  });
});
