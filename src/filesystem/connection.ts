export const MIRROR_SETTINGS_DB_NAME = 'llm-chat-history-filesystem';
const MIRROR_SETTINGS_DB_VERSION = 1;
const MIRROR_SETTINGS_STORE = 'settings';
const DIRECTORY_HANDLE_KEY = 'archive-directory';

export type MirrorConnectionState =
  | 'unsupported'
  | 'disconnected'
  | 'connected'
  | 'permission-needed'
  | 'denied'
  | 'error';

export interface MirrorConnectionHealth {
  state: MirrorConnectionState;
  folderName: string | null;
  detail: string | null;
}

interface StoredSetting<T> {
  key: string;
  value: T;
}

type PermissionMode = 'read' | 'readwrite';
type PermissionStateValue = 'granted' | 'denied' | 'prompt';

interface PermissionCapableDirectoryHandle extends FileSystemDirectoryHandle {
  queryPermission(options?: { mode?: PermissionMode }): Promise<PermissionStateValue>;
  requestPermission(options?: { mode?: PermissionMode }): Promise<PermissionStateValue>;
}

interface DirectoryPickerOptions {
  id?: string;
  mode?: PermissionMode;
  startIn?: FileSystemHandle | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
}

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;
}

export interface MirrorSettingsDbOptions {
  name?: string;
  factory?: IDBFactory;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Filesystem settings request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Filesystem settings transaction aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Filesystem settings transaction failed'));
  });
}

export function openMirrorSettingsDb(options: MirrorSettingsDbOptions = {}): Promise<IDBDatabase> {
  const factory = options.factory ?? indexedDB;
  const name = options.name ?? MIRROR_SETTINGS_DB_NAME;
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, MIRROR_SETTINGS_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MIRROR_SETTINGS_STORE)) {
        db.createObjectStore(MIRROR_SETTINGS_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open filesystem settings'));
    request.onblocked = () => reject(new Error('Filesystem settings upgrade is blocked'));
  });
}

export async function getStoredDirectoryHandle(
  db: IDBDatabase
): Promise<FileSystemDirectoryHandle | null> {
  const transaction = db.transaction(MIRROR_SETTINGS_STORE, 'readonly');
  const record = await requestToPromise<StoredSetting<FileSystemDirectoryHandle> | undefined>(
    transaction.objectStore(MIRROR_SETTINGS_STORE).get(DIRECTORY_HANDLE_KEY)
  );
  await transactionDone(transaction);
  return record?.value ?? null;
}

export async function storeDirectoryHandle(
  db: IDBDatabase,
  handle: FileSystemDirectoryHandle
): Promise<void> {
  const transaction = db.transaction(MIRROR_SETTINGS_STORE, 'readwrite');
  transaction.objectStore(MIRROR_SETTINGS_STORE).put({
    key: DIRECTORY_HANDLE_KEY,
    value: handle
  } satisfies StoredSetting<FileSystemDirectoryHandle>);
  await transactionDone(transaction);
}

export async function clearStoredDirectoryHandle(db: IDBDatabase): Promise<void> {
  const transaction = db.transaction(MIRROR_SETTINGS_STORE, 'readwrite');
  transaction.objectStore(MIRROR_SETTINGS_STORE).delete(DIRECTORY_HANDLE_KEY);
  await transactionDone(transaction);
}

export function directoryPickerSupported(target: Window = window): boolean {
  return typeof (target as DirectoryPickerWindow).showDirectoryPicker === 'function';
}

export function healthFromPermission(
  folderName: string,
  permission: PermissionStateValue
): MirrorConnectionHealth {
  if (permission === 'granted') {
    return { state: 'connected', folderName, detail: null };
  }
  if (permission === 'prompt') {
    return {
      state: 'permission-needed',
      folderName,
      detail: 'Folder access needs to be granted again.'
    };
  }
  return {
    state: 'denied',
    folderName,
    detail: 'Folder access is denied. Reconnect or choose another folder.'
  };
}

export async function queryDirectoryHealth(
  handle: FileSystemDirectoryHandle | null,
  target: Window = window
): Promise<MirrorConnectionHealth> {
  if (!directoryPickerSupported(target)) {
    return {
      state: 'unsupported',
      folderName: handle?.name ?? null,
      detail: 'This browser does not expose the required directory picker.'
    };
  }
  if (!handle) return { state: 'disconnected', folderName: null, detail: null };

  try {
    const permission = await (handle as PermissionCapableDirectoryHandle).queryPermission({
      mode: 'readwrite'
    });
    return healthFromPermission(handle.name, permission);
  } catch (error) {
    return {
      state: 'error',
      folderName: handle.name,
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function pickAndStoreDirectory(
  db: IDBDatabase,
  target: Window = window
): Promise<MirrorConnectionHealth> {
  const picker = (target as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) {
    return {
      state: 'unsupported',
      folderName: null,
      detail: 'This browser does not expose the required directory picker.'
    };
  }

  const handle = await picker.call(target, {
    id: 'llm-chat-history-archive',
    mode: 'readwrite',
    startIn: 'documents'
  });
  await storeDirectoryHandle(db, handle);
  return queryDirectoryHealth(handle, target);
}

export async function requestStoredDirectoryPermission(
  db: IDBDatabase,
  target: Window = window
): Promise<MirrorConnectionHealth> {
  const handle = await getStoredDirectoryHandle(db);
  if (!handle) return { state: 'disconnected', folderName: null, detail: null };
  if (!directoryPickerSupported(target)) {
    return {
      state: 'unsupported',
      folderName: handle.name,
      detail: 'This browser does not expose the required directory picker.'
    };
  }

  try {
    const permission = await (handle as PermissionCapableDirectoryHandle).requestPermission({
      mode: 'readwrite'
    });
    return healthFromPermission(handle.name, permission);
  } catch (error) {
    return {
      state: 'error',
      folderName: handle.name,
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}
