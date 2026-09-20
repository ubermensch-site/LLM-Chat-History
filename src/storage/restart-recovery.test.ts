import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ContentToBackgroundMessage,
  ProviderObservation,
  RecorderCommand,
  RecorderCommandMessage
} from '../shared/types';
import { ArchiveRepository } from './archive';
import { openArchiveDb, requestToPromise } from './db';

const databaseNames: string[] = [];

async function openRepository(name: string): Promise<ArchiveRepository> {
  const db = await openArchiveDb({ name, factory: indexedDB });
  return new ArchiveRepository(db);
}

function makeDatabaseName(): string {
  const name = `llm-chat-history-restart-${crypto.randomUUID()}`;
  databaseNames.push(name);
  return name;
}

const providerConversationId = 'restart-conversation';
const pageUrl = `https://chatgpt.com/c/${providerConversationId}`;
const identity = {
  providerId: 'chatgpt' as const,
  providerConversationId,
  sourceUrl: pageUrl,
  provisional: false
};

function envelope(observation: ProviderObservation): ContentToBackgroundMessage {
  return {
    type: 'LLMCH_PROVIDER_OBSERVATION',
    providerId: 'chatgpt',
    sourceSessionId: 'restart-session',
    pageUrl,
    observation
  };
}

function conversation(observedAt: string): ContentToBackgroundMessage {
  return envelope({
    type: 'conversation',
    identity,
    title: 'Restart recovery',
    observedAt
  });
}

function turn(input: {
  id: string;
  role: 'user' | 'assistant';
  order: number;
  text: string;
  partial?: boolean;
  observedAt: string;
}): ContentToBackgroundMessage {
  return envelope({
    type: 'turn-upsert',
    turn: {
      providerId: 'chatgpt',
      providerConversationId,
      providerTurnId: input.id,
      providerMessageId: input.id,
      role: input.role,
      orderHint: input.order,
      plainText: input.text,
      markdown: input.text,
      partial: input.partial ?? false,
      observedAt: input.observedAt
    }
  });
}

function command(
  requestId: string,
  recorderCommand: RecorderCommand,
  observedAt: string
): RecorderCommandMessage {
  return {
    type: 'LLMCH_RECORDER_COMMAND',
    requestId,
    providerId: 'chatgpt',
    sourceSessionId: 'restart-session',
    pageUrl,
    identity,
    command: recorderCommand,
    observedAt
  };
}

afterEach(async () => {
  while (databaseNames.length) {
    const name = databaseNames.pop();
    if (name) await requestToPromise(indexedDB.deleteDatabase(name));
  }
});

describe('restart and reopen recovery', () => {
  it('preserves finalized turns across reopen and remains idempotent when the DOM replays them', async () => {
    const name = makeDatabaseName();
    let repository = await openRepository(name);

    await repository.persistObservation(conversation('2026-09-16T14:00:00.000Z'));
    await repository.persistObservation(
      turn({
        id: 'user-1',
        role: 'user',
        order: 0,
        text: 'Question before restart',
        observedAt: '2026-09-16T14:00:01.000Z'
      })
    );
    await repository.persistObservation(
      turn({
        id: 'assistant-1',
        role: 'assistant',
        order: 1,
        text: 'Partial answer',
        partial: true,
        observedAt: '2026-09-16T14:00:02.000Z'
      })
    );
    const finalAssistant = turn({
      id: 'assistant-1',
      role: 'assistant',
      order: 1,
      text: 'Final answer before restart',
      observedAt: '2026-09-16T14:00:03.000Z'
    });
    await repository.persistObservation(finalAssistant);
    repository.close();

    repository = await openRepository(name);
    let conversations = await repository.listConversations();
    expect(conversations).toHaveLength(1);
    expect(conversations[0]?.messageCount).toBe(2);

    let messages = await repository.listMessages(conversations[0]!.id);
    expect(messages.map((message) => message.plainText)).toEqual([
      'Question before restart',
      'Final answer before restart'
    ]);
    expect(messages[1]?.partial).toBe(false);

    // A content script may emit the same rendered turn after reload. It must remain one message.
    await repository.persistObservation(finalAssistant);
    await repository.persistObservation(
      turn({
        id: 'user-2',
        role: 'user',
        order: 2,
        text: 'Question after restart',
        observedAt: '2026-09-16T14:01:00.000Z'
      })
    );

    conversations = await repository.listConversations();
    expect(conversations[0]?.messageCount).toBe(3);
    messages = await repository.listMessages(conversations[0]!.id);
    expect(messages).toHaveLength(3);
    expect(messages[2]?.plainText).toBe('Question after restart');

    const events = await repository.listEvents(conversations[0]!.id);
    expect(events.filter((event) => event.type === 'message-added')).toHaveLength(3);
    expect(events.filter((event) => event.type === 'message-finalized')).toHaveLength(1);
    repository.close();
  });

  it('preserves paused state and suppression boundaries across reopen without private backfill', async () => {
    const name = makeDatabaseName();
    let repository = await openRepository(name);

    await repository.persistObservation(conversation('2026-09-16T15:00:00.000Z'));
    await repository.persistObservation(
      turn({
        id: 'public-before',
        role: 'user',
        order: 0,
        text: 'Public before pause',
        observedAt: '2026-09-16T15:00:01.000Z'
      })
    );
    await expect(
      repository.applyRecorderCommand(
        command('pause-before-restart', 'pause', '2026-09-16T15:00:02.000Z')
      )
    ).resolves.toBe('paused');

    const privateTurn = turn({
      id: 'private-during-pause',
      role: 'user',
      order: 1,
      text: 'Private text must never be archived',
      observedAt: '2026-09-16T15:00:03.000Z'
    });
    await repository.persistObservation(privateTurn);
    repository.close();

    repository = await openRepository(name);
    let conversations = await repository.listConversations();
    expect(conversations[0]?.recordingState).toBe('paused');

    await expect(
      repository.applyRecorderCommand(
        command('resume-after-restart', 'resume', '2026-09-16T15:01:00.000Z')
      )
    ).resolves.toBe('recording');

    // Reload/rescan sees the omitted DOM turn. The durable suppression event must still block it.
    await repository.persistObservation(privateTurn);
    await repository.persistObservation(
      turn({
        id: 'public-after',
        role: 'user',
        order: 2,
        text: 'Public after resume',
        observedAt: '2026-09-16T15:01:01.000Z'
      })
    );

    conversations = await repository.listConversations();
    const messages = await repository.listMessages(conversations[0]!.id);
    expect(messages.map((message) => message.plainText)).toEqual([
      'Public before pause',
      'Public after resume'
    ]);

    const events = await repository.listEvents(conversations[0]!.id);
    const suppressed = events.filter((event) => event.type === 'turn-suppressed');
    expect(suppressed.length).toBeGreaterThanOrEqual(1);
    expect(suppressed.some((event) => event.id.includes('suppressed-slot:'))).toBe(true);
    expect(events.some((event) => event.type === 'recording-paused')).toBe(true);
    expect(events.some((event) => event.type === 'recording-resumed')).toBe(true);
    expect(JSON.stringify(events)).not.toContain('Private text must never be archived');
    repository.close();
  });
});
