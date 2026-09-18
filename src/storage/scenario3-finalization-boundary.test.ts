import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ContentToBackgroundMessage,
  ProviderTurnObservation,
  RecorderCommandMessage
} from '../shared/types';
import { ArchiveRepository } from './archive';
import { openArchiveDb, requestToPromise } from './db';

const opened: Array<{ name: string; repository: ArchiveRepository }> = [];

async function createRepository(): Promise<ArchiveRepository> {
  const name = `llm-chat-history-scenario3-${crypto.randomUUID()}`;
  const db = await openArchiveDb({ name, factory: indexedDB });
  const repository = new ArchiveRepository(db);
  opened.push({ name, repository });
  return repository;
}

const sourceSessionId = 'scenario3-tab';
const providerConversationId = 'scenario3-conversation';
const pageUrl = `https://chatgpt.com/c/${providerConversationId}`;

function snapshot(
  turns: ProviderTurnObservation[],
  observedAt: string
): ContentToBackgroundMessage {
  return {
    type: 'LLMCH_PROVIDER_OBSERVATION',
    providerId: 'chatgpt',
    sourceSessionId,
    pageUrl,
    observation: { type: 'turn-snapshot', turns, observedAt }
  };
}

function turn(input: {
  id: string;
  role: 'user' | 'assistant';
  orderHint: number;
  text: string;
  partial: boolean;
  observedAt: string;
}): ProviderTurnObservation {
  return {
    providerId: 'chatgpt',
    providerConversationId,
    providerTurnId: input.id,
    providerMessageId: input.id,
    role: input.role,
    orderHint: input.orderHint,
    plainText: input.text,
    markdown: input.text,
    partial: input.partial,
    ...(input.role === 'assistant'
      ? {
          visibleActivities: [
            {
              providerActivityId: `${input.id}:visible:thinking`,
              kind: 'reasoning-summary' as const,
              text: 'Thinking',
              orderHint: 0,
              observedAt: input.observedAt
            }
          ]
        }
      : {}),
    observedAt: input.observedAt
  };
}

function stop(observedAt: string): RecorderCommandMessage {
  return {
    type: 'LLMCH_RECORDER_COMMAND',
    requestId: `scenario3-stop-${observedAt}`,
    providerId: 'chatgpt',
    sourceSessionId,
    pageUrl,
    identity: {
      providerId: 'chatgpt',
      providerConversationId,
      sourceUrl: pageUrl,
      provisional: false
    },
    command: 'stop',
    observedAt
  };
}

afterEach(async () => {
  while (opened.length) {
    const entry = opened.pop();
    if (!entry) continue;
    entry.repository.close();
    await requestToPromise(indexedDB.deleteDatabase(entry.name));
  }
});

describe('Scenario 3 finalization boundary', () => {
  it('finalizes the latest assistant snapshot before Stop changes recorder state', async () => {
    const repository = await createRepository();
    const user = turn({
      id: 'user-1',
      role: 'user',
      orderHint: 0,
      text: 'Compare extension and web app',
      partial: false,
      observedAt: '2026-09-18T07:32:16.000Z'
    });
    const partial = turn({
      id: 'assistant-1',
      role: 'assistant',
      orderHint: 1,
      text: 'Points 1 through 7',
      partial: true,
      observedAt: '2026-09-18T07:32:18.000Z'
    });
    const final = turn({
      id: 'assistant-1',
      role: 'assistant',
      orderHint: 1,
      text: 'Complete 20-point comparison and decision framework',
      partial: false,
      observedAt: '2026-09-18T07:32:40.000Z'
    });

    await repository.persistObservation(snapshot([user, partial], '2026-09-18T07:32:18.000Z'));
    await repository.persistObservation(snapshot([user, final], '2026-09-18T07:32:40.000Z'));
    expect(await repository.applyRecorderCommand(stop('2026-09-18T07:32:40.100Z'))).toBe('stopped');

    const [conversation] = await repository.listConversations();
    expect(conversation?.recordingState).toBe('stopped');

    const messages = await repository.listMessages(conversation!.id);
    expect(messages).toHaveLength(2);
    expect(messages[1]?.plainText).toBe('Complete 20-point comparison and decision framework');
    expect(messages[1]?.partial).toBe(false);
    expect(messages[1]?.visibleActivities?.map((entry) => entry.text)).toEqual(['Thinking']);

    const events = await repository.listEvents(conversation!.id);
    expect(events.filter((event) => event.type === 'message-finalized')).toHaveLength(1);
    const finalizedIndex = events.findIndex((event) => event.type === 'message-finalized');
    const stoppedIndex = events.findIndex((event) => event.type === 'recording-stopped');
    expect(finalizedIndex).toBeGreaterThanOrEqual(0);
    expect(stoppedIndex).toBeGreaterThan(finalizedIndex);
  });

  it('does not backfill the rest of an answer if Stop is pressed during active generation', async () => {
    const repository = await createRepository();
    const user = turn({
      id: 'user-1',
      role: 'user',
      orderHint: 0,
      text: 'Long answer please',
      partial: false,
      observedAt: '2026-09-18T07:40:00.000Z'
    });
    const partial = turn({
      id: 'assistant-1',
      role: 'assistant',
      orderHint: 1,
      text: 'Only content visible before Stop',
      partial: true,
      observedAt: '2026-09-18T07:40:02.000Z'
    });
    const laterFinal = turn({
      id: 'assistant-1',
      role: 'assistant',
      orderHint: 1,
      text: 'Private remainder after Stop',
      partial: false,
      observedAt: '2026-09-18T07:40:05.000Z'
    });

    await repository.persistObservation(snapshot([user, partial], '2026-09-18T07:40:02.000Z'));
    await repository.applyRecorderCommand(stop('2026-09-18T07:40:02.100Z'));
    await repository.persistObservation(snapshot([user, laterFinal], '2026-09-18T07:40:05.000Z'));

    const [conversation] = await repository.listConversations();
    const messages = await repository.listMessages(conversation!.id);
    expect(messages[1]?.plainText).toBe('Only content visible before Stop');
    expect(messages[1]?.partial).toBe(true);
    expect(JSON.stringify(messages)).not.toContain('Private remainder after Stop');

    const events = await repository.listEvents(conversation!.id);
    expect(events.some((event) => event.type === 'message-finalized')).toBe(false);
    expect(events.some((event) => event.type === 'turn-suppressed')).toBe(true);
  });
});
