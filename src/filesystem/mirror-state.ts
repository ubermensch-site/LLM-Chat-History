const MIRROR_SETTINGS_STORE = 'settings';
const LOCATION_PREFIX = 'mirror-location:';

export interface StoredMirrorLocation {
  conversationId: string;
  current: [string, string, string, string];
  stale: Array<[string, string, string, string]>;
  mirroredAt: string;
}

interface StoredSetting<T> {
  key: string;
  value: T;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Mirror state request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Mirror state transaction aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Mirror state transaction failed'));
  });
}

function locationKey(conversationId: string): string {
  return `${LOCATION_PREFIX}${conversationId}`;
}

export async function getStoredMirrorLocation(
  db: IDBDatabase,
  conversationId: string
): Promise<StoredMirrorLocation | null> {
  const transaction = db.transaction(MIRROR_SETTINGS_STORE, 'readonly');
  const record = await requestToPromise<StoredSetting<StoredMirrorLocation> | undefined>(
    transaction.objectStore(MIRROR_SETTINGS_STORE).get(locationKey(conversationId))
  );
  await transactionDone(transaction);
  return record?.value ?? null;
}

export async function storeMirrorLocation(
  db: IDBDatabase,
  location: StoredMirrorLocation
): Promise<void> {
  const transaction = db.transaction(MIRROR_SETTINGS_STORE, 'readwrite');
  transaction.objectStore(MIRROR_SETTINGS_STORE).put({
    key: locationKey(location.conversationId),
    value: location
  } satisfies StoredSetting<StoredMirrorLocation>);
  await transactionDone(transaction);
}

export async function clearMirrorLocation(
  db: IDBDatabase,
  conversationId: string
): Promise<void> {
  const transaction = db.transaction(MIRROR_SETTINGS_STORE, 'readwrite');
  transaction.objectStore(MIRROR_SETTINGS_STORE).delete(locationKey(conversationId));
  await transactionDone(transaction);
}
