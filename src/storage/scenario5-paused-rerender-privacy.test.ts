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
  const name = `llm-chat-history-scenario5-${crypto.randomUUID()}`;
  const db = await openArchiveDb({ name, factory: indexedDB });
  const repository = new ArchiveRepository(db);
  opened.push({ name, repository });
  return repository;
}

const sourceSessionId = 'scenario5-live-smoke';
const providerConversationId = 'scenario5-chat';
const pageUrl = `https://chatgpt.com/c/${providerConversationId}`;

function turn(input: {
  providerTurnId: string;
  providerMessageId: string | null;
  role: 'user' | 'assistant';
  orderHint: number;
  text: string;
  partial?: boolean;
  observedAt: string;
}): ProviderTurnObservation {
  return {
    providerId: 'chatgpt',
    providerConversationId,
    providerTurnId: input.providerTurnId,
    providerMessageId: input.providerMessageId,
    role: input.role,
    orderHint: input.orderHint,
    plainText: input.text,
    markdown: input.text || null,
    partial: input.partial ?? false,
    observedAt: input.observedAt
  };
}

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

function command(
  command: 'pause' | 'resume',
  observedAt: string
): RecorderCommandMessage {
  return {
    type: 'LLMCH_RECORDER_COMMAND',
    requestId: `scenario5:${command}:${observedAt}`,
    providerId: 'chatgpt',
    sourceSessionId,
    pageUrl,
    identity: {
      providerId: 'chatgpt',
      providerConversationId,
      sourceUrl: pageUrl,
      provisional: false
    },
    command,
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

describe('Scenario 5 paused interval privacy across provider identity churn', () => {
  it('never backfills a paused assistant when placeholder/final/rerender identities change', async () => {
    const repository = await createRepository();

    const publicBefore = [
      turn({
        providerTurnId: 'before-user',
        providerMessageId: 'before-user',
        role: 'user',
        orderHint: 0,
        text: 'can you check if github plugin is connected',
        observedAt: '2026-09-20T02:55:11.724Z'
      }),
      turn({
        providerTurnId: 'before-assistant',
        providerMessageId: 'before-assistant-message',
        role: 'assistant',
        orderHint: 1,
        text: 'github plugin is connected',
        observedAt: '2026-09-20T02:55:36.529Z'
      })
    ];

    await repository.persistObservation(
      snapshot(publicBefore, '2026-09-20T02:55:36.529Z')
    );
    await repository.applyRecorderCommand(
      command('pause', '2026-09-20T02:56:27.743Z')
    );

    const privateUser = turn({
      providerTurnId: 'private-user',
      providerMessageId: 'private-user',
      role: 'user',
      orderHint: 2,
      text: 'now reply github is connected',
      observedAt: '2026-09-20T02:56:38.979Z'
    });

    const privateAssistantPlaceholder = turn({
      providerTurnId: 'request-WEB:private-1',
      providerMessageId: 'request-placeholder-request-WEB:private-1',
      role: 'assistant',
      orderHint: 3,
      text: '',
      partial: true,
      observedAt: '2026-09-20T02:56:38.979Z'
    });

    await repository.persistObservation(
      snapshot(
        [...publicBefore, privateUser, privateAssistantPlaceholder],
        '2026-09-20T02:56:38.979Z'
      )
    );

    const privateAssistantFinal = turn({
      providerTurnId: 'request-WEB:private-1',
      providerMessageId: 'private-final-provider-message',
      role: 'assistant',
      orderHint: 3,
      text: 'github is connected',
      observedAt: '2026-09-20T02:56:49.000Z'
    });

    await repository.persistObservation(
      snapshot(
        [...publicBefore, privateUser, privateAssistantFinal],
        '2026-09-20T02:56:49.000Z'
      )
    );

    await repository.applyRecorderCommand(
      command('resume', '2026-09-20T02:56:57.520Z')
    );

    const publicAfter = [
      turn({
        providerTurnId: 'after-user',
        providerMessageId: 'after-user',
        role: 'user',
        orderHint: 4,
        text: 'now reply github is active',
        observedAt: '2026-09-20T02:57:10.904Z'
      }),
      turn({
        providerTurnId: 'after-assistant',
        providerMessageId: 'after-assistant-message',
        role: 'assistant',
        orderHint: 5,
        text: 'github is active',
        observedAt: '2026-09-20T02:57:15.616Z'
      })
    ];

    await repository.persistObservation(
      snapshot(
        [...publicBefore, privateUser, privateAssistantFinal, ...publicAfter],
        '2026-09-20T02:57:15.616Z'
      )
    );

    // Model the live smoke failure: after navigation/re-render, ChatGPT exposes
    // the same private assistant under an entirely new turn/message identity.
    const rerenderedPrivateAssistant = turn({
      providerTurnId: 'rerendered-private-shell',
      providerMessageId: 'rerendered-private-provider-message',
      role: 'assistant',
      orderHint: 3,
      text: 'github is connected',
      observedAt: '2026-09-20T02:57:27.590Z'
    });

    await repository.persistObservation(
      snapshot(
        [...publicBefore, privateUser, rerenderedPrivateAssistant, ...publicAfter],
        '2026-09-20T02:57:27.870Z'
      )
    );

    const [conversation] = await repository.listConversations();
    expect(conversation?.recordingState).toBe('recording');
    expect(conversation?.messageCount).toBe(4);

    const messages = await repository.listMessages(conversation!.id);
    expect(messages.map((message) => message.plainText)).toEqual([
      'can you check if github plugin is connected',
      'github plugin is connected',
      'now reply github is active',
      'github is active'
    ]);
    expect(JSON.stringify(messages)).not.toContain('now reply github is connected');
    expect(JSON.stringify(messages)).not.toContain('github is connected');

    const events = await repository.listEvents(conversation!.id);
    expect(events.some((event) => event.type === 'recording-paused')).toBe(true);
    expect(events.some((event) => event.type === 'recording-resumed')).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'turn-suppressed' &&
          event.data.role === 'assistant' &&
          event.data.orderHint === 3
      )
    ).toBe(true);
    expect(
      events.filter(
        (event) =>
          event.type === 'message-added' &&
          event.data.role === 'assistant'
      )
    ).toHaveLength(2);
  });
});
