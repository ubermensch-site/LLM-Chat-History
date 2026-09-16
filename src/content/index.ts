import { recordPerformanceSample } from '../performance/metrics';
import { ChatGptAdapter } from '../providers/chatgpt/adapter';
import {
  runHistoricalScrollHarvest,
  type HarvestViewport
} from '../providers/chatgpt/historical-harvest';
import {
  buildLiveQaReport,
  collectChatGptLiveQaDomEvidence,
  liveQaReportFilename,
  renderLiveQaReportJson,
  summarizeChatGptRoute
} from '../qa/live-qa-report';
import type {
  AdapterHealthState,
  BackgroundAck,
  BackgroundToContentMessage,
  ContentToBackgroundMessage,
  CreateCheckpointMessage,
  LiveQaArchiveStatus,
  LiveQaStatusMessage,
  OpenLibraryMessage,
  ProviderObservation,
  RecorderCommand,
  RecorderCommandMessage,
  RecorderState
} from '../shared/types';
import { withRetry } from '../transport/retry';
import {
  mountRecorderPill,
  type HistoricalImportSummary,
  type StorageHealthState
} from '../ui/recorder-pill';

const adapter = new ChatGptAdapter();
const sourceSessionId = crypto.randomUUID();

let renderedTurnIds = new Set<string>();
let activeConversationKey: string | null = null;
let sendQueue: Promise<unknown> = Promise.resolve();
let snapshotProfileStartedAt: number | null = null;
let snapshotRenderedTurnCount = 0;
let stopAdapterObservation: (() => void) | null = null;
let currentRecordingState: RecorderState = 'recording';
let currentStorageHealth: StorageHealthState = 'unknown';
let currentLastSavedAt: string | null = null;
let currentAdapterState: AdapterHealthState = 'healthy';
let currentAdapterCode = 'unknown';

const pill = mountRecorderPill({
  onCommand: (command) => sendRecorderCommand(command),
  onCheckpoint: (name, note) => sendCheckpoint(name, note),
  onImportHistory: () => importHistoricalConversation(),
  onDownloadLiveQaReport: () => downloadLiveQaReport(),
  onOpenLibrary: () => openLibrary()
});

function observationConversationKey(observation: ProviderObservation): string | null {
  if (observation.type !== 'conversation') return null;
  return observation.identity.providerConversationId
    ? `${observation.identity.providerId}:${observation.identity.providerConversationId}`
    : `${observation.identity.providerId}:provisional:${sourceSessionId}`;
}

function applyAck(ack: BackgroundAck | undefined): void {
  if (!ack) throw new Error('Background did not acknowledge the request');
  if (!ack.ok) throw new Error(ack.error ?? 'Background persistence failed');

  const next: Parameters<typeof pill.update>[0] = {};
  if (ack.recordingState) {
    currentRecordingState = ack.recordingState;
    next.recordingState = ack.recordingState;
  }
  if (ack.persistedAt) {
    currentStorageHealth = 'healthy';
    currentLastSavedAt = ack.persistedAt;
    next.storageHealth = 'healthy';
    next.lastSavedAt = ack.persistedAt;
  }
  pill.update(next);
}

function markStorageError(): void {
  currentStorageHealth = 'error';
  pill.update({ storageHealth: 'error' });
}

async function sendRequest(
  message: ContentToBackgroundMessage | RecorderCommandMessage | CreateCheckpointMessage,
  retry: boolean
): Promise<void> {
  const operation = async () => {
    const ack = (await chrome.runtime.sendMessage(message)) as BackgroundAck | undefined;
    applyAck(ack);
  };

  if (retry) {
    await withRetry(operation);
  } else {
    await operation();
  }
}

async function openLibrary(): Promise<void> {
  const message: OpenLibraryMessage = { type: 'LLMCH_OPEN_LIBRARY' };
  const ack = (await chrome.runtime.sendMessage(message)) as BackgroundAck | undefined;
  applyAck(ack);
}

async function sendRecorderCommand(command: RecorderCommand): Promise<void> {
  await sendQueue;
  const identity = adapter.getConversationIdentity();
  if (!identity) throw new Error('No supported conversation is active');

  const message: RecorderCommandMessage = {
    type: 'LLMCH_RECORDER_COMMAND',
    requestId: crypto.randomUUID(),
    providerId: adapter.providerId,
    sourceSessionId,
    pageUrl: location.href,
    identity,
    command,
    observedAt: new Date().toISOString()
  };

  try {
    await sendRequest(message, true);
  } catch (error) {
    markStorageError();
    console.warn('[LLM Chat History] recorder command failed after retries', error);
    throw error;
  }
}

async function sendCheckpoint(name: string, note: string | null): Promise<void> {
  await sendQueue;
  const identity = adapter.getConversationIdentity();
  if (!identity) throw new Error('No supported conversation is active');
  const observedAt = new Date().toISOString();
  const message: CreateCheckpointMessage = {
    type: 'LLMCH_CREATE_CHECKPOINT',
    requestId: crypto.randomUUID(),
    providerId: adapter.providerId,
    sourceSessionId,
    pageUrl: location.href,
    identity,
    name,
    note,
    observedAt
  };

  try {
    await sendRequest(message, true);
  } catch (error) {
    markStorageError();
    console.warn('[LLM Chat History] checkpoint persistence failed after retries', error);
    throw error;
  }
}

function recordSnapshotProfile(): void {
  if (snapshotProfileStartedAt === null) return;
  const durationMs = performance.now() - snapshotProfileStartedAt;
  snapshotProfileStartedAt = null;
  const sample = {
    metric: 'adapter-snapshot-ms' as const,
    durationMs,
    at: new Date().toISOString(),
    itemCount: snapshotRenderedTurnCount
  };
  void recordPerformanceSample(chrome.storage.local, sample).catch((error: unknown) => {
    console.debug('[LLM Chat History] performance sample unavailable', error);
  });
}

function applyObservationToRecorder(observation: ProviderObservation): void {
  if (observation.type === 'turn-upsert') {
    renderedTurnIds.add(observation.turn.providerTurnId);
    pill.update({ turnCount: renderedTurnIds.size });
  } else if (observation.type === 'turn-snapshot') {
    snapshotRenderedTurnCount = observation.turns.length;
    for (const turn of observation.turns) renderedTurnIds.add(turn.providerTurnId);
    pill.update({ turnCount: renderedTurnIds.size });
  } else if (observation.type === 'health') {
    recordSnapshotProfile();
    currentAdapterState = observation.health.state;
    currentAdapterCode = observation.health.code;
    pill.update({
      health: observation.health.state,
      healthCode: observation.health.code,
      healthDetail: observation.health.detail ?? null
    });
  } else if (observation.type === 'conversation') {
    snapshotProfileStartedAt = performance.now();
    snapshotRenderedTurnCount = 0;
    const nextKey = observationConversationKey(observation);
    if (nextKey !== activeConversationKey) {
      activeConversationKey = nextKey;
      renderedTurnIds = new Set<string>();
      pill.update({ turnCount: 0 });
    }
  }
}

function queueObservation(observation: ProviderObservation): Promise<void> {
  applyObservationToRecorder(observation);

  const message: ContentToBackgroundMessage = {
    type: 'LLMCH_PROVIDER_OBSERVATION',
    providerId: adapter.providerId,
    sourceSessionId,
    pageUrl: location.href,
    observation
  };

  const task = sendQueue.then(() => sendRequest(message, observation.type !== 'health'));
  sendQueue = task.catch((error: unknown) => {
    markStorageError();
    console.warn('[LLM Chat History] observation persistence failed after retries', error);
  });
  return task;
}

function enqueueObservation(observation: ProviderObservation): void {
  void queueObservation(observation).catch(() => undefined);
}

function startAdapterObservation(): void {
  stopAdapterObservation?.();
  stopAdapterObservation = adapter.observe(enqueueObservation);
}

function asHarvestViewport(element: HTMLElement): HarvestViewport {
  return {
    read: () => ({
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight
    }),
    scrollTo: (top) => element.scrollTo({ top, behavior: 'auto' })
  };
}

async function waitForHistoricalDomSettle(): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 180));
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}

async function importHistoricalConversation(): Promise<HistoricalImportSummary> {
  await sendQueue;
  const identity = adapter.getConversationIdentity();
  if (!identity?.providerConversationId) {
    throw new Error('Open an existing saved ChatGPT conversation before importing history.');
  }

  if (adapter.scanRenderedTurns().some((turn) => turn.partial)) {
    throw new Error('Wait for the assistant response to finish before importing history.');
  }

  const scrollContainer = adapter.getConversationScrollContainer();
  if (!scrollContainer) throw new Error('Could not find the ChatGPT conversation scroll area.');

  const providerConversationId = identity.providerConversationId;
  stopAdapterObservation?.();
  stopAdapterObservation = null;

  try {
    const result = await runHistoricalScrollHarvest({
      viewport: asHarvestViewport(scrollContainer),
      settle: waitForHistoricalDomSettle,
      maxWindows: 500,
      captureWindow: async () => {
        const currentIdentity = adapter.getConversationIdentity();
        if (currentIdentity?.providerConversationId !== providerConversationId) {
          throw new Error('Conversation changed during history import. Import was stopped.');
        }

        const turns = adapter.scanRenderedTurns();
        const observedAt = new Date().toISOString();
        await queueObservation({ type: 'turn-snapshot', turns, observedAt });
        return turns.map((turn) => turn.providerTurnId);
      }
    });

    return {
      windowsScanned: result.windowsScanned,
      uniqueTurnsSeen: result.uniqueTurnsSeen,
      complete: result.reachedTop && result.reachedBottom && !result.truncated,
      truncated: result.truncated
    };
  } finally {
    if (adapter.matchesLocation(new URL(location.href))) startAdapterObservation();
  }
}

async function getLiveQaArchiveStatus(): Promise<LiveQaArchiveStatus> {
  const identity = adapter.getConversationIdentity();
  if (!identity) {
    return {
      conversationFound: false,
      messageCount: 0,
      eventCount: 0,
      recordingState: null
    };
  }

  const message: LiveQaStatusMessage = {
    type: 'LLMCH_LIVE_QA_STATUS',
    providerId: adapter.providerId,
    sourceSessionId,
    pageUrl: location.href,
    identity
  };
  const ack = (await chrome.runtime.sendMessage(message)) as BackgroundAck | undefined;
  if (!ack?.ok) throw new Error(ack?.error ?? 'Unable to read local archive QA status.');
  if (!ack.liveQaStatus) throw new Error('Background did not return local archive QA status.');
  return ack.liveQaStatus;
}

function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function downloadLiveQaReport(): Promise<void> {
  await sendQueue;
  const identity = adapter.getConversationIdentity();
  const routeUrl = new URL(location.href);
  const scrollContainer = adapter.getConversationScrollContainer();
  const dom = collectChatGptLiveQaDomEvidence(document, {
    adapterScrollContainer: scrollContainer,
    documentScrollingElement: document.scrollingElement,
    historyApiAvailable:
      typeof window.history.pushState === 'function' &&
      typeof window.history.replaceState === 'function'
  });
  const route = summarizeChatGptRoute(
    routeUrl,
    Boolean(identity?.providerConversationId),
    identity?.provisional ?? true
  );
  const archive = await getLiveQaArchiveStatus();
  const generatedAt = new Date().toISOString();
  const historicalImportAvailable =
    currentRecordingState === 'recording' &&
    currentAdapterState !== 'error' &&
    Boolean(identity?.providerConversationId) &&
    !dom.stopGenerationControlPresent;

  const report = buildLiveQaReport({
    generatedAt,
    extensionVersion: chrome.runtime.getManifest().version,
    route,
    dom,
    runtime: {
      adapterState: currentAdapterState,
      adapterCode: currentAdapterCode,
      recordingState: currentRecordingState,
      storageHealth: currentStorageHealth,
      renderedTurnCount: renderedTurnIds.size,
      lastSaveConfirmed: currentLastSavedAt !== null,
      historicalImportAvailable
    },
    archive
  });

  downloadText(liveQaReportFilename(generatedAt), renderLiveQaReportJson(report));
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const candidate = message as Partial<BackgroundToContentMessage> | null;
  if (!candidate || candidate.type !== 'LLMCH_SHOW_RECORDER') return;

  pill.show();
  sendResponse({ ok: true } satisfies BackgroundAck);
});

if (adapter.matchesLocation(new URL(location.href))) {
  startAdapterObservation();
} else {
  currentAdapterState = 'error';
  currentAdapterCode = 'unsupported-location';
  pill.update({
    health: 'error',
    healthCode: 'unsupported-location',
    healthDetail: 'The active page is not a supported ChatGPT conversation location.'
  });
}
