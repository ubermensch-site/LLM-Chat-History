import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearStoredDirectoryHandle,
  getStoredDirectoryHandle,
  healthFromPermission,
  openMirrorSettingsDb,
  pickAndStoreDirectory,
  queryDirectoryHealth,
  requestDirectoryPermission,
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

  it('persists and disconnects the serializable directory-handle value independently of chat data', async () => {
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
    let requests = 0;
    const permissionHandle = {
      kind: 'directory',
      name: 'Archive',
      queryPermission: async () => 'prompt',
      requestPermission: async () => {
        requests += 1;
        return 'granted';
      }
    } as unknown as FileSystemDirectoryHandle;

    const health = await requestDirectoryPermission(
      permissionHandle,
      targetWithPicker(async () => permissionHandle)
    );
    expect(health.state).toBe('connected');
    expect(requests).toBe(1);
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
