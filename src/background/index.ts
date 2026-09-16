import type {
  BackgroundAck,
  ContentToBackgroundMessage,
  ContentToBackgroundRequest,
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
    Boolean(candidate.identity && typeof candidate.identity === 'object') &&
    typeof candidate.observedAt === 'string' &&
    ['pause', 'resume', 'stop', 'start'].includes(candidate.command ?? '')
  );
}

function isKnownRequest(value: unknown): value is ContentToBackgroundRequest {
  return isProviderObservationMessage(value) || isRecorderCommandMessage(value);
}

chrome.runtime.onInstalled.addListener(() => {
  console.info('[LLM Chat History] extension installed');
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isKnownRequest(message)) return;

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
