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

const opened: Array<{ name: string; repository: ArchiveRepository }> = [];

async function createRepository(): Promise<ArchiveRepository> {
  const name = `llm-chat-history-recorder-${crypto.randomUUID()}`;
  const db = await openArchiveDb({ name, factory: indexedDB });
  const repository = new ArchiveRepository(db);
  opened.push({ name, repository });
  return repository;
}

const pageUrl = 'https://chatgpt.com/c/conversation-state-test';
const identity = {
  providerId: 'chatgpt' as const,
  providerConversationId: 'conversation-state-test',
  sourceUrl: pageUrl,
  provisional: false
};

function observation(observation: ProviderObservation): ContentToBackgroundMessage {
  return {
    type: 'LLMCH_PROVIDER_OBSERVATION',
    providerId: 'chatgpt',
    sourceSessionId: 'state-session',
    pageUrl,
    observation
  };
}

function turn(
  providerTurnId: string,
  plainText: string,
  orderHint: number,
  observedAt: string
): ContentToBackgroundMessage {
  return observation({
    type: 'turn-upsert',
    turn: {
      providerId: 'chatgpt',
      providerConversationId: identity.providerConversationId,
      providerTurnId,
      providerMessageId: providerTurnId,
      role: 'user',
      orderHint,
      plainText,
      markdown: plainText,
      partial: false,
      observedAt
    }
  });
}

function assistantTurn(
  providerTurnId: string,
  plainText: string,
  activityTexts: string[],
  observedAt: string
): ContentToBackgroundMessage {
  return observation({
    type: 'turn-upsert',
    turn: {
      providerId: 'chatgpt',
      providerConversationId: identity.providerConversationId,
      providerTurnId,
      providerMessageId: providerTurnId,
      role: 'assistant',
      orderHint: 0,
      plainText,
      markdown: plainText,
      partial: true,
      visibleActivities: activityTexts.map((text, index) => ({
        providerActivityId: `${providerTurnId}:visible:${index}`,
        kind: index === 0 ? 'reasoning-summary' : 'tool',
        text,
        orderHint: index,
        observedAt
      })),
      observedAt
    }
  });
}

function command(command: RecorderCommand, observedAt: string): RecorderCommandMessage {
  return {
    type: 'LLMCH_RECORDER_COMMAND',
    requestId: `state-test:${command}:${observedAt}`,
    providerId: 'chatgpt',
    sourceSessionId: 'state-session',
    pageUrl,
    identity,
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

describe('per-conversation recorder privacy policy', () => {
  it('does not persist paused content and does not backfill it after resume', async () => {
    const repository = await createRepository();

    await repository.persistObservation(
      observation({
        type: 'conversation',
        identity,
        title: 'Privacy test',
        observedAt: '2026-09-16T11:00:00.000Z'
      })
    );
    await repository.persistObservation(turn('turn-1', 'public before pause', 0, '2026-09-16T11:00:01.000Z'));

    expect(await repository.applyRecorderCommand(command('pause', '2026-09-16T11:00:02.000Z'))).toBe(
      'paused'
    );

    await repository.persistObservation(turn('turn-2', 'private omitted text', 1, '2026-09-16T11:00:03.000Z'));

    expect(await repository.applyRecorderCommand(command('resume', '2026-09-16T11:00:04.000Z'))).toBe(
      'recording'
    );

    // A post-resume DOM rescan sees the omitted turn again. The suppression ledger must block backfill.
    await repository.persistObservation(turn('turn-2', 'private omitted text', 1, '2026-09-16T11:00:05.000Z'));
    await repository.persistObservation(turn('turn-3', 'public after resume', 2, '2026-09-16T11:00:06.000Z'));

    const [conversation] = await repository.listConversations();
    expect(conversation?.recordingState).toBe('recording');

    const messages = await repository.listMessages(conversation!.id);
    expect(messages.map((message) => message.plainText)).toEqual([
      'public before pause',
      'public after resume'
    ]);

    const events = await repository.listEvents(conversation!.id);
    expect(events.some((event) => event.type === 'recording-paused')).toBe(true);
    expect(events.some((event) => event.type === 'recording-resumed')).toBe(true);
    expect(events.some((event) => event.type === 'turn-suppressed')).toBe(true);
    expect(JSON.stringify(events)).not.toContain('private omitted text');
  });

  it('does not backfill visible work that first appears while paused', async () => {
    const repository = await createRepository();
    await repository.persistObservation(
      assistantTurn(
        'assistant-visible',
        'Same partial answer',
        ['Thinking'],
        '2026-09-16T11:30:00.000Z'
      )
    );

    await repository.applyRecorderCommand(command('pause', '2026-09-16T11:30:01.000Z'));
    await repository.persistObservation(
      assistantTurn(
        'assistant-visible',
        'Same partial answer',
        ['Thinking', 'Fetched private paused work'],
        '2026-09-16T11:30:02.000Z'
      )
    );
    await repository.applyRecorderCommand(command('resume', '2026-09-16T11:30:03.000Z'));

    // The provider still renders that work after resume. It must remain suppressed.
    await repository.persistObservation(
      assistantTurn(
        'assistant-visible',
        'Final answer after resume',
        ['Thinking', 'Fetched private paused work'],
        '2026-09-16T11:30:04.000Z'
      )
    );

    const [conversation] = await repository.listConversations();
    const messages = await repository.listMessages(conversation!.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.plainText).toBe('Same partial answer');
    expect(messages[0]?.visibleActivities?.map((activity) => activity.text)).toEqual(['Thinking']);

    const events = await repository.listEvents(conversation!.id);
    const suppressed = events.filter((event) => event.type === 'turn-suppressed');
    expect(suppressed.length).toBeGreaterThanOrEqual(1);
    expect(suppressed.some((event) => event.id.includes('suppressed-slot:'))).toBe(true);
    expect(JSON.stringify(events)).not.toContain('Fetched private paused work');
  });

  it('keeps stopped state durable and requires an explicit start', async () => {
    const repository = await createRepository();

    await repository.persistObservation(
      observation({
        type: 'conversation',
        identity,
        title: 'Stop test',
        observedAt: '2026-09-16T12:00:00.000Z'
      })
    );
    expect(await repository.applyRecorderCommand(command('stop', '2026-09-16T12:00:01.000Z'))).toBe(
      'stopped'
    );

    await repository.persistObservation(turn('turn-stopped', 'must stay omitted', 0, '2026-09-16T12:00:02.000Z'));

    const stateFromLaterObservation = await repository.persistObservation(
      observation({
        type: 'conversation',
        identity,
        title: 'Stop test',
        observedAt: '2026-09-16T12:00:03.000Z'
      })
    );
    expect(stateFromLaterObservation).toBe('stopped');

    expect(await repository.applyRecorderCommand(command('start', '2026-09-16T12:00:04.000Z'))).toBe(
      'recording'
    );
    await repository.persistObservation(turn('turn-stopped', 'must stay omitted', 0, '2026-09-16T12:00:05.000Z'));
    await repository.persistObservation(turn('turn-new', 'new after explicit start', 1, '2026-09-16T12:00:06.000Z'));

    const [conversation] = await repository.listConversations();
    const messages = await repository.listMessages(conversation!.id);
    expect(messages.map((message) => message.plainText)).toEqual(['new after explicit start']);
  });

  it('does not suppress an unchanged pre-pause turn merely because a DOM rescan sees it', async () => {
    const repository = await createRepository();
    await repository.persistObservation(turn('turn-existing', 'same content', 0, '2026-09-16T13:00:00.000Z'));
    await repository.applyRecorderCommand(command('pause', '2026-09-16T13:00:01.000Z'));
    await repository.persistObservation(turn('turn-existing', 'same content', 0, '2026-09-16T13:00:02.000Z'));
    await repository.applyRecorderCommand(command('resume', '2026-09-16T13:00:03.000Z'));
    await repository.persistObservation(turn('turn-existing', 'updated after resume', 0, '2026-09-16T13:00:04.000Z'));

    const [conversation] = await repository.listConversations();
    const messages = await repository.listMessages(conversation!.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.plainText).toBe('updated after resume');

    const events = await repository.listEvents(conversation!.id);
    expect(events.filter((event) => event.type === 'turn-suppressed')).toHaveLength(0);
  });
});
