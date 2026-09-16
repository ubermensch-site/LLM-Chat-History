import { ChatGptAdapter } from '../providers/chatgpt/adapter';
import type { ContentToBackgroundMessage, ProviderObservation } from '../shared/types';
import { mountRecorderPill } from '../ui/recorder-pill';

const adapter = new ChatGptAdapter();
const pill = mountRecorderPill();

let renderedTurnIds = new Set<string>();

function postObservation(observation: ProviderObservation): void {
  if (observation.type === 'turn-upsert') {
    renderedTurnIds.add(observation.turn.providerTurnId);
    pill.update({ turnCount: renderedTurnIds.size });
  } else if (observation.type === 'health') {
    pill.update({ health: observation.health.state });
  } else if (observation.type === 'conversation') {
    renderedTurnIds = new Set<string>();
    pill.update({ turnCount: 0 });
  }

  const message: ContentToBackgroundMessage = {
    type: 'LLMCH_PROVIDER_OBSERVATION',
    observation
  };

  void chrome.runtime.sendMessage(message).catch((error: unknown) => {
    console.debug('[LLM Chat History] background unavailable', error);
  });
}

if (adapter.matchesLocation(new URL(location.href))) {
  adapter.observe(postObservation);
} else {
  pill.update({ health: 'error' });
}
