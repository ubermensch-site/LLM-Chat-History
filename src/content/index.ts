import { ChatGptAdapter } from '../providers/chatgpt/adapter';
import type {
  BackgroundAck,
  BackgroundToContentMessage,
  ContentToBackgroundMessage,
  CreateCheckpointMessage,
  OpenLibraryMessage,
  ProviderObservation,
  RecorderCommand,
  RecorderCommandMessage
} from '../shared/types';
import { withRetry } from '../transport/retry';
import { mountRecorderPill } from '../ui/recorder-pill';

const adapter = new ChatGptAdapter();
const sourceSessionId = crypto.randomUUID();

let renderedTurnIds = new Set<string>();
let activeConversationKey: string | null = null;
let sendQueue: Promise<unknown> = Promise.resolve();

const pill = mountRecorderPill({
  onCommand: (command) => sendRecorderCommand(command),
  onCheckpoint: (name, note) => sendCheckpoint(name, note),
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
  if (ack.recordingState) next.recordingState = ack.recordingState;
  if (ack.persistedAt) {
    next.storageHealth = 'healthy';
    next.lastSavedAt = ack.persistedAt;
  }
  pill.update(next);
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
    pill.update({ storageHealth: 'error' });
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
    pill.update({ storageHealth: 'error' });
    console.warn('[LLM Chat History] checkpoint persistence failed after retries', error);
    throw error;
  }
}

function enqueueObservation(observation: ProviderObservation): void {
  if (observation.type === 'turn-upsert') {
    renderedTurnIds.add(observation.turn.providerTurnId);
    pill.update({ turnCount: renderedTurnIds.size });
  } else if (observation.type === 'turn-snapshot') {
    for (const turn of observation.turns) renderedTurnIds.add(turn.providerTurnId);
    pill.update({ turnCount: renderedTurnIds.size });
  } else if (observation.type === 'health') {
    pill.update({
      health: observation.health.state,
      healthCode: observation.health.code,
      healthDetail: observation.health.detail ?? null
    });
  } else if (observation.type === 'conversation') {
    const nextKey = observationConversationKey(observation);
    if (nextKey !== activeConversationKey) {
      activeConversationKey = nextKey;
      renderedTurnIds = new Set<string>();
      pill.update({ turnCount: 0 });
    }
  }

  const message: ContentToBackgroundMessage = {
    type: 'LLMCH_PROVIDER_OBSERVATION',
    providerId: adapter.providerId,
    sourceSessionId,
    pageUrl: location.href,
    observation
  };

  sendQueue = sendQueue
    .then(() => sendRequest(message, observation.type !== 'health'))
    .catch((error: unknown) => {
      pill.update({ storageHealth: 'error' });
      console.warn('[LLM Chat History] observation persistence failed after retries', error);
    });
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const candidate = message as Partial<BackgroundToContentMessage> | null;
  if (!candidate || candidate.type !== 'LLMCH_SHOW_RECORDER') return;

  pill.show();
  sendResponse({ ok: true } satisfies BackgroundAck);
});

if (adapter.matchesLocation(new URL(location.href))) {
  adapter.observe(enqueueObservation);
} else {
  pill.update({
    health: 'error',
    healthCode: 'unsupported-location',
    healthDetail: 'The active page is not a supported ChatGPT conversation location.'
  });
}
