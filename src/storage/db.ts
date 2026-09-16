import { ARCHIVE_DB_NAME, ARCHIVE_DB_VERSION, INDEXES, STORES } from './schema';

export interface OpenArchiveDbOptions {
  name?: string;
  factory?: IDBFactory;
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
  });
}

function migrateToV1(db: IDBDatabase): void {
  const conversations = db.createObjectStore(STORES.conversations, { keyPath: 'id' });
  conversations.createIndex(INDEXES.conversations.providerKey, 'providerKey', { unique: true });
  conversations.createIndex(INDEXES.conversations.provisionalKey, 'provisionalKey', { unique: true });
  conversations.createIndex(INDEXES.conversations.updatedAt, 'updatedAt');

  const messages = db.createObjectStore(STORES.messages, { keyPath: 'id' });
  messages.createIndex(
    INDEXES.messages.conversationOrder,
    ['conversationId', 'orderHint'],
    { unique: false }
  );
  messages.createIndex(
    INDEXES.messages.providerTurn,
    ['conversationId', 'providerTurnId'],
    { unique: true }
  );
  messages.createIndex(
    INDEXES.messages.conversationUpdatedAt,
    ['conversationId', 'updatedAt'],
    { unique: false }
  );

  const events = db.createObjectStore(STORES.events, { keyPath: 'id' });
  events.createIndex(INDEXES.events.conversationTime, ['conversationId', 'createdAt']);
  events.createIndex(INDEXES.events.typeTime, ['type', 'createdAt']);
}

function migrateToV2(db: IDBDatabase): void {
  const projects = db.createObjectStore(STORES.projects, { keyPath: 'id' });
  projects.createIndex(INDEXES.projects.name, 'name', { unique: false });
}

function migrateToV3(db: IDBDatabase): void {
  const checkpoints = db.createObjectStore(STORES.checkpoints, { keyPath: 'id' });
  checkpoints.createIndex(
    INDEXES.checkpoints.conversationTime,
    ['conversationId', 'createdAt'],
    { unique: false }
  );
}

export function applyArchiveMigrations(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) migrateToV1(db);
  if (oldVersion < 2) migrateToV2(db);
  if (oldVersion < 3) migrateToV3(db);
}

export function openArchiveDb(options: OpenArchiveDbOptions = {}): Promise<IDBDatabase> {
  const factory = options.factory ?? indexedDB;
  const name = options.name ?? ARCHIVE_DB_NAME;

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, ARCHIVE_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const oldVersion = (event as IDBVersionChangeEvent).oldVersion;
      applyArchiveMigrations(request.result, oldVersion);
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open archive database'));
    request.onblocked = () => reject(new Error('Archive database upgrade is blocked by another connection'));
  });
}
