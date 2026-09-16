import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { RecorderCommandMessage } from '../shared/types';
import { ArchiveRepository } from './archive';
import { openArchiveDb, requestToPromise } from './db';

const opened: Array<{ name: string; repository: ArchiveRepository }> = [];

async function createRepository(): Promise<ArchiveRepository> {
  const name = `llm-chat-history-command-test-${crypto.randomUUID()}`;
  const db = await openArchiveDb({ name, factory: indexedDB });
  const repository = new ArchiveRepository(db);
  opened.push({ name, repository });
  return repository;
}

function commandMessage(input: {
  requestId: string;
  command: RecorderCommandMessage['command'];
  observedAt: string;
}): RecorderCommandMessage {
  return {
    type: 'LLMCH_RECORDER_COMMAND',
    requestId: input.requestId,
    providerId: 'chatgpt',
    sourceSessionId: 'session-command-test',
    pageUrl: 'https://chatgpt.com/c/conversation-command-test',
    identity: {
      providerId: 'chatgpt',
      providerConversationId: 'conversation-command-test',
      sourceUrl: 'https://chatgpt.com/c/conversation-command-test',
      provisional: false
    },
    command: input.command,
    observedAt: input.observedAt
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

describe('recorder command idempotency', () => {
  it('returns the already-applied state when the same request is retried after ACK loss', async () => {
    const repository = await createRepository();
    const message = commandMessage({
      requestId: 'request-pause-1',
      command: 'pause',
      observedAt: '2026-09-16T12:00:00.000Z'
    });

    await expect(repository.applyRecorderCommand(message)).resolves.toBe('paused');
    await expect(repository.applyRecorderCommand(message)).resolves.toBe('paused');

    const [conversation] = await repository.listConversations();
    expect(conversation?.recordingState).toBe('paused');

    const events = await repository.listEvents(conversation!.id);
    const pauseEvents = events.filter((event) => event.type === 'recording-paused');
    expect(pauseEvents).toHaveLength(1);
    expect(pauseEvents[0]?.data.requestId).toBe('request-pause-1');
  });

  it('does not add another transition when a different request repeats the same intent', async () => {
    const repository = await createRepository();

    await expect(
      repository.applyRecorderCommand(
        commandMessage({
          requestId: 'request-pause-1',
          command: 'pause',
          observedAt: '2026-09-16T12:00:00.000Z'
        })
      )
    ).resolves.toBe('paused');

    await expect(
      repository.applyRecorderCommand(
        commandMessage({
          requestId: 'request-pause-2',
          command: 'pause',
          observedAt: '2026-09-16T12:00:01.000Z'
        })
      )
    ).resolves.toBe('paused');

    const [conversation] = await repository.listConversations();
    const events = await repository.listEvents(conversation!.id);
    expect(events.filter((event) => event.type === 'recording-paused')).toHaveLength(1);
  });
});
