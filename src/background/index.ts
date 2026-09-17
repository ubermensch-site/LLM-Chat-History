import type {
  BackgroundAck,
  ContentToBackgroundMessage,
  ContentToBackgroundRequest,
  CreateCheckpointMessage,
  LiveQaArchiveStatus,
  LiveQaStatusMessage,
  OpenLibraryMessage,
  RecorderCommandMessage,
  RefreshMirrorMessage,
  ShowRecorderMessage
} from '../shared/types';
import { openMirrorSettingsDb } from '../filesystem/connection';
import { mirrorConversationLatest } from '../filesystem/service';
import { MIRROR_RUNTIME_STATUS_KEY, type MirrorRuntimeStatus } from '../filesystem/status';
import { CoalescingMirrorQueue } from '../filesystem/writer';
import { ArchiveRepository } from '../storage/archive';
import { openArchiveDb } from '../storage/db';
import { provisionalConversationKey } from '../storage/ids';
import {
  authoritativeCurrentTabUrl,
  isStaleProvisionalObservationForCurrentTab,
  stableSourceSessionId
} from './source-session';

type PersistingRequest = Exclude<
  ContentToBackgroundRequest,
  OpenLibraryMessage | RefreshMirrorMessage | LiveQaStatusMessage
>;

let archiveDbPromise: Promise<IDBDatabase> | null = null;
let repositoryPromise: Promise<ArchiveRepository> | null = null;
let mirrorSettingsDbPromise: Promise<IDBDatabase> | null = null;
const mirrorQueue = new CoalescingMirrorQueue();

function getArchiveDb(): Promise<IDBDatabase> {
  archiveDbPromise ??= openArchiveDb();
  return archiveDbPromise;
}

function getRepository(): Promise<ArchiveRepository> {
  repositoryPromise ??= getArchiveDb().then((db) => new ArchiveRepository(db));
  return repositoryPromise;
}

function getMirrorSettingsDb(): Promise<IDBDatabase> {
  mirrorSettingsDbPromise ??= openMirrorSettingsDb();
  return mirrorSettingsDbPromise;
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

function withStableSourceSession<T extends { sourceSessionId: string }>(
  message: T,
  sender: chrome.runtime.MessageSender
): T {
  const sourceSessionId = stableSourceSessionId(message.sourceSessionId, sender.tab?.id);
  return sourceSessionId === message.sourceSessionId
    ? message
    : { ...message, sourceSessionId };
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

function isCreateCheckpointMessage(value: unknown): value is CreateCheckpointMessage {
  if (!hasEnvelopeFields(value)) return false;
  const candidate = value as Partial<CreateCheckpointMessage>;
  return (
    candidate.type === 'LLMCH_CREATE_CHECKPOINT' &&
    typeof candidate.requestId === 'string' &&
    candidate.requestId.length > 0 &&
    Boolean(candidate.identity && typeof candidate.identity === 'object') &&
    typeof candidate.observedAt === 'string' &&
    typeof candidate.name === 'string' &&
    candidate.name.trim().length > 0 &&
    (candidate.note === null || typeof candidate.note === 'string')
  );
}

function isOpenLibraryMessage(value: unknown): value is OpenLibraryMessage {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as Partial<OpenLibraryMessage>).type === 'LLMCH_OPEN_LIBRARY'
  );
}

function isRefreshMirrorMessage(value: unknown): value is RefreshMirrorMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RefreshMirrorMessage>;
  return (
    candidate.type === 'LLMCH_REFRESH_MIRROR' &&
    typeof candidate.conversationId === 'string' &&
    candidate.conversationId.length > 0
  );
}

function isLiveQaStatusMessage(value: unknown): value is LiveQaStatusMessage {
  if (!hasEnvelopeFields(value)) return false;
  const candidate = value as Partial<LiveQaStatusMessage>;
  return (
    candidate.type === 'LLMCH_LIVE_QA_STATUS' &&
    Boolean(candidate.identity && typeof candidate.identity === 'object')
  );
}

function isKnownRequest(value: unknown): value is ContentToBackgroundRequest {
  return (
    isProviderObservationMessage(value) ||
    isRecorderCommandMessage(value) ||
    isCreateCheckpointMessage(value) ||
    isOpenLibraryMessage(value) ||
    isRefreshMirrorMessage(value) ||
    isLiveQaStatusMessage(value)
  );
}

async function openLibrary(): Promise<void> {
  await chrome.tabs.create({ url: chrome.runtime.getURL('library.html') });
}

async function showRecorder(tabId: number): Promise<boolean> {
  const message: ShowRecorderMessage = { type: 'LLMCH_SHOW_RECORDER' };
  try {
    const ack = (await chrome.tabs.sendMessage(tabId, message)) as BackgroundAck | undefined;
    return Boolean(ack?.ok);
  } catch {
    return false;
  }
}

function mirrorIdentity(message: PersistingRequest): {
  providerId: 'chatgpt';
  providerConversationId: string | null;
  sourceSessionId: string;
} | null {
  if (message.type === 'LLMCH_PROVIDER_OBSERVATION') {
    if (message.observation.type === 'health') return null;
    if (message.observation.type === 'conversation') {
      return {
        providerId: message.providerId,
        providerConversationId: message.observation.identity.providerConversationId,
        sourceSessionId: message.sourceSessionId
      };
    }
    if (message.observation.type === 'turn-snapshot') {
      const first = message.observation.turns[0];
      if (!first) return null;
      return {
        providerId: message.providerId,
        providerConversationId: first.providerConversationId,
        sourceSessionId: message.sourceSessionId
      };
    }
    return {
      providerId: message.providerId,
      providerConversationId: message.observation.turn.providerConversationId,
      sourceSessionId: message.sourceSessionId
    };
  }

  return {
    providerId: message.providerId,
    providerConversationId: message.identity.providerConversationId,
    sourceSessionId: message.sourceSessionId
  };
}

async function isStaleProviderObservationFromReplacedDocument(
  message: PersistingRequest,
  sender: chrome.runtime.MessageSender
): Promise<boolean> {
  if (message.type !== 'LLMCH_PROVIDER_OBSERVATION') return false;
  const identity = mirrorIdentity(message);
  if (!identity || identity.providerConversationId !== null) return false;

  const currentTabUrl = await authoritativeCurrentTabUrl(
    sender.tab?.id,
    sender.tab?.url,
    (tabId) => chrome.tabs.get(tabId)
  );
  return isStaleProvisionalObservationForCurrentTab(null, currentTabUrl);
}

async function isLateProvisionalTurnAgainstStableSessionOwner(
  repository: ArchiveRepository,
  message: PersistingRequest
): Promise<boolean> {
  if (message.type !== 'LLMCH_PROVIDER_OBSERVATION') return false;
  if (
    message.observation.type !== 'turn-snapshot' &&
    message.observation.type !== 'turn-upsert'
  ) {
    return false;
  }

  const identity = mirrorIdentity(message);
  if (!identity || identity.providerConversationId !== null) return false;

  const provisionalKey = provisionalConversationKey(identity.providerId, identity.sourceSessionId);
  const conversations = await repository.listConversations();
  return conversations.some(
    (conversation) =>
      conversation.providerId === identity.providerId &&
      conversation.provisionalKey === provisionalKey &&
      !conversation.provisional
  );
}

async function mirrorConversationIdForRequest(
  repository: ArchiveRepository,
  message: PersistingRequest
): Promise<string | null> {
  const identity = mirrorIdentity(message);
  if (!identity) return null;
  const conversations = await repository.listConversations();

  if (identity.providerConversationId) {
    return (
      conversations.find(
        (conversation) =>
          conversation.providerId === identity.providerId &&
          conversation.providerConversationId === identity.providerConversationId
      )?.id ?? null
    );
  }

  const provisionalKey = provisionalConversationKey(identity.providerId, identity.sourceSessionId);
  return conversations.find((conversation) => conversation.provisionalKey === provisionalKey)?.id ?? null;
}

async function liveQaStatusForRequest(
  repository: ArchiveRepository,
  message: LiveQaStatusMessage
): Promise<LiveQaArchiveStatus> {
  const conversations = await repository.listConversations();
  const providerConversationId = message.identity.providerConversationId;
  const conversation = providerConversationId
    ? conversations.find(
        (candidate) =>
          candidate.providerId === message.providerId &&
          candidate.providerConversationId === providerConversationId
      )
    : conversations.find(
        (candidate) =>
          candidate.provisionalKey === provisionalConversationKey(message.providerId, message.sourceSessionId)
      );

  if (!conversation) {
    return {
      conversationFound: false,
      messageCount: 0,
      eventCount: 0,
      visibleActivityCount: 0,
      recordingState: null
    };
  }

  const [messages, events] = await Promise.all([
    repository.listMessages(conversation.id),
    repository.listEvents(conversation.id)
  ]);

  return {
    conversationFound: true,
    messageCount: messages.length,
    eventCount: events.length,
    visibleActivityCount: messages.reduce(
      (total, archivedMessage) => total + (archivedMessage.visibleActivities?.length ?? 0),
      0
    ),
    recordingState: conversation.recordingState
  };
}

async function persistMirrorStatus(status: MirrorRuntimeStatus): Promise<void> {
  await chrome.storage.local.set({ [MIRROR_RUNTIME_STATUS_KEY]: status });
}

async function reportMirrorError(
  conversationId: string | null,
  error: unknown
): Promise<void> {
  const status: MirrorRuntimeStatus = {
    state: 'error',
    folderName: null,
    conversationId,
    path: null,
    detail: error instanceof Error ? error.message : String(error),
    updatedAt: new Date().toISOString()
  };
  console.warn('[LLM Chat History] optional filesystem mirror failed', error);
  try {
    await persistMirrorStatus(status);
  } catch (statusError) {
    console.warn('[LLM Chat History] unable to persist mirror health', statusError);
  }
}

async function mirrorConversationById(
  repository: ArchiveRepository,
  conversationId: string
): Promise<void> {
  try {
    await mirrorQueue.enqueue(conversationId, async () => {
      const [archiveDb, settingsDb] = await Promise.all([getArchiveDb(), getMirrorSettingsDb()]);
      const status = await mirrorConversationLatest({
        repository,
        archiveDb,
        settingsDb,
        conversationId
      });
      await persistMirrorStatus(status);
    });
  } catch (error) {
    await reportMirrorError(conversationId, error);
  }
}

async function mirrorAfterCanonicalPersistence(
  repository: ArchiveRepository,
  message: PersistingRequest
): Promise<void> {
  try {
    const conversationId = await mirrorConversationIdForRequest(repository, message);
    if (!conversationId) return;
    await mirrorConversationById(repository, conversationId);
  } catch (error) {
    // This entire path is optional. Even conversation lookup failures must never
    // propagate into the canonical persistence ACK.
    await reportMirrorError(null, error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.info('[LLM Chat History] extension installed');
});

chrome.action.onClicked.addListener((tab) => {
  void (async () => {
    if (typeof tab.id === 'number' && (await showRecorder(tab.id))) return;
    await openLibrary();
  })().catch((error: unknown) => {
    console.error('[LLM Chat History] toolbar action failed', error);
  });
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
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

  if (message.type === 'LLMCH_REFRESH_MIRROR') {
    void getRepository()
      .then((repository) => mirrorConversationById(repository, message.conversationId))
      .then(() => sendResponse({ ok: true } satisfies BackgroundAck))
      .catch((error: unknown) => {
        const text = error instanceof Error ? error.message : String(error);
        sendResponse({ ok: false, error: text } satisfies BackgroundAck);
      });
    return true;
  }

  if (message.type === 'LLMCH_LIVE_QA_STATUS') {
    const liveQaMessage = withStableSourceSession(message, sender);
    void getRepository()
      .then((repository) => liveQaStatusForRequest(repository, liveQaMessage))
      .then((liveQaStatus) => sendResponse({ ok: true, liveQaStatus } satisfies BackgroundAck))
      .catch((error: unknown) => {
        const text = error instanceof Error ? error.message : String(error);
        sendResponse({ ok: false, error: text } satisfies BackgroundAck);
      });
    return true;
  }

  const persistenceMessage = withStableSourceSession(message, sender);

  void (async () => {
    if (await isStaleProviderObservationFromReplacedDocument(persistenceMessage, sender)) {
      sendResponse({ ok: true, persistedAt: new Date().toISOString() } satisfies BackgroundAck);
      return;
    }

    const repository = await getRepository();
    if (await isLateProvisionalTurnAgainstStableSessionOwner(repository, persistenceMessage)) {
      sendResponse({ ok: true, persistedAt: new Date().toISOString() } satisfies BackgroundAck);
      return;
    }

    let recordingState;
    if (persistenceMessage.type === 'LLMCH_RECORDER_COMMAND') {
      recordingState = await repository.applyRecorderCommand(persistenceMessage);
    } else if (persistenceMessage.type === 'LLMCH_CREATE_CHECKPOINT') {
      recordingState = await repository.createCheckpoint(persistenceMessage);
    } else {
      recordingState = await repository.persistObservation(persistenceMessage);
    }

    const persistedAt = new Date().toISOString();
    await chrome.storage.local.set({
      lastPersistenceAt: persistedAt,
      lastPersistenceError: null
    });

    const ack: BackgroundAck = recordingState
      ? { ok: true, recordingState, persistedAt }
      : { ok: true, persistedAt };
    sendResponse(ack);

    // The canonical ACK is deliberately sent first. Optional filesystem work runs
    // from the latest IndexedDB state and can coalesce subsequent recorder events.
    void mirrorAfterCanonicalPersistence(repository, persistenceMessage);
  })().catch(async (error: unknown) => {
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
