import type { BackgroundAck, ContentToBackgroundMessage } from '../shared/types';
import { ArchiveRepository } from '../storage/archive';
import { openArchiveDb } from '../storage/db';

let repositoryPromise: Promise<ArchiveRepository> | null = null;

function getRepository(): Promise<ArchiveRepository> {
  repositoryPromise ??= openArchiveDb().then((db) => new ArchiveRepository(db));
  return repositoryPromise;
}

function isProviderObservationMessage(value: unknown): value is ContentToBackgroundMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ContentToBackgroundMessage>;
  return (
    candidate.type === 'LLMCH_PROVIDER_OBSERVATION' &&
    candidate.providerId === 'chatgpt' &&
    typeof candidate.sourceSessionId === 'string' &&
    candidate.sourceSessionId.length > 0 &&
    typeof candidate.pageUrl === 'string' &&
    candidate.pageUrl.length > 0 &&
    Boolean(candidate.observation && typeof candidate.observation === 'object')
  );
}

chrome.runtime.onInstalled.addListener(() => {
  console.info('[LLM Chat History] extension installed');
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isProviderObservationMessage(message)) return;

  void getRepository()
    .then((repository) => repository.persistObservation(message))
    .then(async () => {
      await chrome.storage.local.set({ lastPersistenceAt: new Date().toISOString() });
      const ack: BackgroundAck = { ok: true };
      sendResponse(ack);
    })
    .catch(async (error: unknown) => {
      const text = error instanceof Error ? error.message : String(error);
      console.error('[LLM Chat History] persistence failure', error);
      await chrome.storage.local.set({
        lastPersistenceError: text,
        lastPersistenceErrorAt: new Date().toISOString()
      });
      const ack: BackgroundAck = { ok: false, error: text };
      sendResponse(ack);
    });

  // Keep the MV3 message channel open until IndexedDB persistence completes.
  return true;
});
