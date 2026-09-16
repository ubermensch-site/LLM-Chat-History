import type {
  BackgroundAck,
  ContentToBackgroundMessage,
  ContentToBackgroundRequest,
  OpenLibraryMessage,
  RecorderCommandMessage
} from '../shared/types';
import { ArchiveRepository } from '../storage/archive';
import { openArchiveDb } from '../storage/db';

let repositoryPromise: Promise<ArchiveRepository> | null = null;

function getRepository(): Promise<ArchiveRepository> {
  repositoryPromise ??= openArchiveDb().then((db) => new ArchiveRepository(db));
  return repositoryPromise;
}

function hasEnvelopeFields(value: unknown): value is {
  providerId: 'chatgpt';
  sourceSessionId: string;
  pageUrl: string;
} {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.providerId === 'chatgpt' &&
    typeof candidate.sourceSessionId === 'string' &&
    candidate.sourceSessionId.length > 0 &&
    typeof candidate.pageUrl === 'string' &&
    candidate.pageUrl.length > 0
  );
}

function isProviderObservationMessage(value: unknown): value is ContentToBackgroundMessage {
  if (!hasEnvelopeFields(value)) return false;
  const candidate = value as Partial<ContentToBackgroundMessage>;
  return (
    candidate.type === 'LLMCH_PROVIDER_OBSERVATION' &&
    Boolean(candidate.observation && typeof candidate.observation === 'object')
  );
}

function isRecorderCommandMessage(value: unknown): value is RecorderCommandMessage {
  if (!hasEnvelopeFields(value)) return false;
  const candidate = value as Partial<RecorderCommandMessage>;
  return (
    candidate.type === 'LLMCH_RECORDER_COMMAND' &&
    typeof candidate.requestId === 'string' &&
    candidate.requestId.length > 0 &&
    Boolean(candidate.identity && typeof candidate.identity === 'object') &&
    typeof candidate.observedAt === 'string' &&
    ['pause', 'resume', 'stop', 'start'].includes(candidate.command ?? '')
  );
}

function isOpenLibraryMessage(value: unknown): value is OpenLibraryMessage {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as Partial<OpenLibraryMessage>).type === 'LLMCH_OPEN_LIBRARY'
  );
}

function isKnownRequest(value: unknown): value is ContentToBackgroundRequest {
  return (
    isProviderObservationMessage(value) ||
    isRecorderCommandMessage(value) ||
    isOpenLibraryMessage(value)
  );
}

async function openLibrary(): Promise<void> {
  await chrome.tabs.create({ url: chrome.runtime.getURL('library.html') });
}

chrome.runtime.onInstalled.addListener(() => {
  console.info('[LLM Chat History] extension installed');
});

chrome.action.onClicked.addListener(() => {
  void openLibrary().catch((error: unknown) => {
    console.error('[LLM Chat History] unable to open archive library', error);
  });
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isKnownRequest(message)) return;

  if (message.type === 'LLMCH_OPEN_LIBRARY') {
    void openLibrary()
      .then(() => sendResponse({ ok: true } satisfies BackgroundAck))
      .catch((error: unknown) => {
        const text = error instanceof Error ? error.message : String(error);
        sendResponse({ ok: false, error: text } satisfies BackgroundAck);
      });
    return true;
  }

  void getRepository()
    .then(async (repository) => {
      if (message.type === 'LLMCH_RECORDER_COMMAND') {
        return repository.applyRecorderCommand(message);
      }
      return repository.persistObservation(message);
    })
    .then(async (recordingState) => {
      await chrome.storage.local.set({
        lastPersistenceAt: new Date().toISOString(),
        lastPersistenceError: null
      });
      const ack: BackgroundAck = recordingState
        ? { ok: true, recordingState }
        : { ok: true };
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

  return true;
});
