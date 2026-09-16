import { ChatGptAdapter } from '../providers/chatgpt/adapter';
import type {
  BackgroundAck,
  ContentToBackgroundMessage,
  ProviderObservation
} from '../shared/types';
import { mountRecorderPill } from '../ui/recorder-pill';

const adapter = new ChatGptAdapter();
const pill = mountRecorderPill();
const sourceSessionId = crypto.randomUUID();

let renderedTurnIds = new Set<string>();
let activeConversationKey: string | null = null;
let sendQueue: Promise<unknown> = Promise.resolve();

function observationConversationKey(observation: ProviderObservation): string | null {
  if (observation.type !== 'conversation') return null;
  return observation.identity.providerConversationId
    ? `${observation.identity.providerId}:${observation.identity.providerConversationId}`
    : `${observation.identity.providerId}:provisional:${observation.identity.sourceUrl}`;
}

function enqueueObservation(observation: ProviderObservation): void {
  if (observation.type === 'turn-upsert') {
    renderedTurnIds.add(observation.turn.providerTurnId);
    pill.update({ turnCount: renderedTurnIds.size });
  } else if (observation.type === 'health') {
    pill.update({ health: observation.health.state });
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
    .then(async () => {
      const ack = (await chrome.runtime.sendMessage(message)) as BackgroundAck | undefined;
      if (ack && !ack.ok) throw new Error(ack.error ?? 'Background persistence failed');
    })
    .catch((error: unknown) => {
      pill.update({ health: 'error' });
      console.warn('[LLM Chat History] observation persistence failed', error);
    });
}

if (adapter.matchesLocation(new URL(location.href))) {
  adapter.observe(enqueueObservation);
} else {
  pill.update({ health: 'error' });
}
