import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ContentToBackgroundMessage,
  ProviderConversationIdentity,
  ProviderTurnObservation,
  RecorderCommand,
  RecorderCommandMessage
} from '../shared/types';
import { ArchiveRepository } from './archive';
import { openArchiveDb, requestToPromise } from './db';

const databases: Array<{ name: string; repository: ArchiveRepository }> = [];

async function createRepository(prefix = 'stress'): Promise<{ name: string; repository: ArchiveRepository }> {
  const name = `llm-chat-history-${prefix}-${crypto.randomUUID()}`;
  const db = await openArchiveDb({ name, factory: indexedDB });
  const repository = new ArchiveRepository(db);
  databases.push({ name, repository });
  return { name, repository };
}

function identity(providerConversationId: string | null): ProviderConversationIdentity {
  return {
    providerId: 'chatgpt',
    providerConversationId,
    sourceUrl: providerConversationId
      ? `https://chatgpt.com/c/${providerConversationId}`
      : 'https://chatgpt.com/',
    provisional: providerConversationId === null
  };
}

function conversationObservation(
  sourceSessionId: string,
  providerConversationId: string | null,
  observedAt: string
): ContentToBackgroundMessage {
  return {
    type: 'LLMCH_PROVIDER_OBSERVATION',
    providerId: 'chatgpt',
    sourceSessionId,
    pageUrl: identity(providerConversationId).sourceUrl,
    observation: {
      type: 'conversation',
      identity: identity(providerConversationId),
      title: providerConversationId ? `Stress ${providerConversationId}` : 'New stress chat',
      observedAt
    }
  };
}

function canonicalTurn(
  providerConversationId: string | null,
  index: number,
  observedAt: string,
  partial = false,
  text = `turn-${index}`
): ProviderTurnObservation {
  const role = index % 2 === 0 ? 'user' : 'assistant';
  return {
    providerId: 'chatgpt',
    providerConversationId,
    providerTurnId: `turn-${index}`,
    providerMessageId: `message-${index}`,
    role,
    orderHint: index,
    plainText: text,
    markdown: text,
    partial,
    observedAt
  };
}

function snapshotObservation(
  sourceSessionId: string,
  providerConversationId: string | null,
  canonicalTurns: ProviderTurnObservation[],
  observedAt: string
): ContentToBackgroundMessage {
  return {
    type: 'LLMCH_PROVIDER_OBSERVATION',
    providerId: 'chatgpt',
    sourceSessionId,
    pageUrl: identity(providerConversationId).sourceUrl,
    observation: {
      type: 'turn-snapshot',
      // Deliberately reset orderHint to the rendered-window index. This reproduces
      // virtualization: DOM index 0 is not necessarily conversation turn 0.
      turns: canonicalTurns.map((turn, windowIndex) => ({
        ...turn,
        providerConversationId,
        orderHint: windowIndex,
        observedAt
      })),
      observedAt
    }
  };
}

function command(
  sourceSessionId: string,
  providerConversationId: string,
  value: RecorderCommand,
  requestId: string,
  observedAt: string
): RecorderCommandMessage {
  return {
    type: 'LLMCH_RECORDER_COMMAND',
    requestId,
    providerId: 'chatgpt',
    sourceSessionId,
    pageUrl: `https://chatgpt.com/c/${providerConversationId}`,
    identity: identity(providerConversationId),
    command: value,
    observedAt
  };
}

afterEach(async () => {
  while (databases.length) {
    const entry = databases.pop();
    if (!entry) continue;
    entry.repository.close();
    await requestToPromise(indexedDB.deleteDatabase(entry.name));
  }
});

describe('TASK-050 long-chat lifecycle stress', () => {
  it(
    'converges 1,002 turns from overlapping virtualized windows with exact order and no duplicates',
    async () => {
      const { repository } = await createRepository('virtualized-1002');
      const session = 'session-long';
      const providerId = 'long-chat';
      const base = Date.parse('2026-09-16T12:00:00.000Z');
      const turns = Array.from({ length: 1002 }, (_, index) =>
        canonicalTurn(providerId, index, new Date(base + index).toISOString())
      );

      await repository.persistObservation(
        conversationObservation(session, providerId, new Date(base).toISOString())
      );

      // Start at the newest tail, then scroll upward in overlapping windows.
      // Each new window shares 102 known turns with the prior canonical window.
      for (let start = 800; start >= 0; start -= 100) {
        const rendered = turns.slice(start, Math.min(start + 202, turns.length));
        await repository.persistObservation(
          snapshotObservation(
            session,
            providerId,
            rendered,
            new Date(base + 10_000 + (800 - start)).toISOString()
          )
        );
      }

      // Re-scan the whole history in overlapping forward windows to simulate
      // scrolling back down; this must not duplicate or reorder anything.
      for (let start = 0; start < turns.length; start += 150) {
        await repository.persistObservation(
          snapshotObservation(
            session,
            providerId,
            turns.slice(start, Math.min(start + 250, turns.length)),
            new Date(base + 20_000 + start).toISOString()
          )
        );
      }

      const conversations = await repository.listConversations();
      expect(conversations).toHaveLength(1);
      expect(conversations[0]?.messageCount).toBe(1002);

      const stored = await repository.listMessages(conversations[0]!.id);
      expect(stored).toHaveLength(1002);
      expect(stored.map((message) => message.providerTurnId)).toEqual(
        turns.map((turn) => turn.providerTurnId)
      );
      expect(stored.map((message) => message.orderHint)).toEqual(
        Array.from({ length: 1002 }, (_, index) => index)
      );
      expect(new Set(stored.map((message) => message.id)).size).toBe(1002);
    },
    30_000
  );

  it('keeps rapid A↔B navigation isolated under repeated overlapping snapshots', async () => {
    const { repository } = await createRepository('rapid-switch');
    const session = 'session-switch';
    const base = Date.parse('2026-09-16T13:00:00.000Z');
    const turnsA = Array.from({ length: 80 }, (_, index) =>
      canonicalTurn('chat-a', index, new Date(base + index).toISOString(), false, `A-${index}`)
    );
    const turnsB = Array.from({ length: 80 }, (_, index) =>
      canonicalTurn('chat-b', index, new Date(base + 1_000 + index).toISOString(), false, `B-${index}`)
    );

    for (let cycle = 0; cycle < 20; cycle += 1) {
      const providerId = cycle % 2 === 0 ? 'chat-a' : 'chat-b';
      const source = providerId === 'chat-a' ? turnsA : turnsB;
      const start = Math.min(cycle * 3, 40);
      const observedAt = new Date(base + 5_000 + cycle).toISOString();
      await repository.persistObservation(conversationObservation(session, providerId, observedAt));
      await repository.persistObservation(
        snapshotObservation(session, providerId, source.slice(start, start + 40), observedAt)
      );
    }

    // Finish both histories with overlapping windows.
    for (const [providerId, source] of [
      ['chat-a', turnsA],
      ['chat-b', turnsB]
    ] as const) {
      for (let start = 0; start < source.length; start += 20) {
        const observedAt = new Date(base + 8_000 + start).toISOString();
        await repository.persistObservation(conversationObservation(session, providerId, observedAt));
        await repository.persistObservation(
          snapshotObservation(session, providerId, source.slice(start, start + 40), observedAt)
        );
      }
    }

    const conversations = await repository.listConversations();
    expect(conversations).toHaveLength(2);
    const byProvider = new Map(conversations.map((entry) => [entry.providerConversationId, entry]));
    const storedA = await repository.listMessages(byProvider.get('chat-a')!.id);
    const storedB = await repository.listMessages(byProvider.get('chat-b')!.id);

    expect(storedA).toHaveLength(80);
    expect(storedB).toHaveLength(80);
    expect(storedA.every((message) => message.plainText.startsWith('A-'))).toBe(true);
    expect(storedB.every((message) => message.plainText.startsWith('B-'))).toBe(true);
    expect(storedA.map((message) => message.providerTurnId)).toEqual(
      turnsA.map((turn) => turn.providerTurnId)
    );
    expect(storedB.map((message) => message.providerTurnId)).toEqual(
      turnsB.map((turn) => turn.providerTurnId)
    );
  });

  it('survives a repository restart during assistant streaming and finalizes in place', async () => {
    const entry = await createRepository('stream-refresh');
    const session = 'session-stream';
    const providerId = 'stream-chat';
    const at = '2026-09-16T14:00:00.000Z';

    await entry.repository.persistObservation(conversationObservation(session, providerId, at));
    const partialTurns = [
      canonicalTurn(providerId, 0, at, false, 'Question'),
      canonicalTurn(providerId, 1, at, true, 'Partial answer')
    ];
    await entry.repository.persistObservation(snapshotObservation(session, providerId, partialTurns, at));

    const conversationBefore = (await entry.repository.listConversations())[0]!;
    const partial = (await entry.repository.listMessages(conversationBefore.id))[1]!;
    expect(partial.partial).toBe(true);

    // Simulate MV3/background restart by creating a fresh repository instance over
    // the same open IndexedDB connection state.
    const db = await openArchiveDb({ name: entry.name, factory: indexedDB });
    const restarted = new ArchiveRepository(db);
    databases.push({ name: `${entry.name}-secondary-handle`, repository: restarted });

    const finalAt = '2026-09-16T14:00:05.000Z';
    await restarted.persistObservation(
      snapshotObservation(session, providerId, [
        partialTurns[0]!,
        canonicalTurn(providerId, 1, finalAt, false, 'Complete answer')
      ], finalAt)
    );

    const conversations = await restarted.listConversations();
    expect(conversations).toHaveLength(1);
    const stored = await restarted.listMessages(conversations[0]!.id);
    expect(stored).toHaveLength(2);
    expect(stored[1]).toMatchObject({
      providerTurnId: 'turn-1',
      plainText: 'Complete answer',
      partial: false,
      orderHint: 1
    });
    const finalized = (await restarted.listEvents(conversations[0]!.id)).filter(
      (event) => event.type === 'message-finalized'
    );
    expect(finalized).toHaveLength(1);
  });

  it('promotes a provisional long-chat session without creating a second conversation', async () => {
    const { repository } = await createRepository('promotion');
    const session = 'session-provisional';
    const provisionalAt = '2026-09-16T15:00:00.000Z';
    const provisionalTurns = Array.from({ length: 20 }, (_, index) =>
      canonicalTurn(null, index, provisionalAt, false, `provisional-${index}`)
    );

    await repository.persistObservation(conversationObservation(session, null, provisionalAt));
    await repository.persistObservation(snapshotObservation(session, null, provisionalTurns, provisionalAt));

    const identifiedAt = '2026-09-16T15:00:02.000Z';
    await repository.persistObservation(conversationObservation(session, 'promoted-chat', identifiedAt));
    await repository.persistObservation(
      snapshotObservation(
        session,
        'promoted-chat',
        provisionalTurns.map((turn) => ({ ...turn, providerConversationId: 'promoted-chat' })),
        identifiedAt
      )
    );

    const conversations = await repository.listConversations();
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({
      providerConversationId: 'promoted-chat',
      provisional: false,
      messageCount: 20
    });
    expect(await repository.listMessages(conversations[0]!.id)).toHaveLength(20);
  });

  it('does not recover paused content when a later virtualized window re-renders it', async () => {
    const { repository } = await createRepository('privacy-window');
    const session = 'session-private-window';
    const providerId = 'private-chat';
    const startAt = '2026-09-16T16:00:00.000Z';

    await repository.persistObservation(conversationObservation(session, providerId, startAt));
    await repository.persistObservation(
      snapshotObservation(session, providerId, [
        canonicalTurn(providerId, 0, startAt, false, 'public-before')
      ], startAt)
    );
    await repository.applyRecorderCommand(
      command(session, providerId, 'pause', 'pause-private-window', '2026-09-16T16:00:01.000Z')
    );

    const privateTurn = canonicalTurn(
      providerId,
      1,
      '2026-09-16T16:00:02.000Z',
      false,
      'SECRET-PAUSED-CONTENT'
    );
    await repository.persistObservation(
      snapshotObservation(session, providerId, [privateTurn], '2026-09-16T16:00:02.000Z')
    );

    await repository.applyRecorderCommand(
      command(session, providerId, 'resume', 'resume-private-window', '2026-09-16T16:00:03.000Z')
    );
    const publicAfter = canonicalTurn(
      providerId,
      2,
      '2026-09-16T16:00:04.000Z',
      false,
      'public-after'
    );
    await repository.persistObservation(
      snapshotObservation(
        session,
        providerId,
        [
          canonicalTurn(providerId, 0, startAt, false, 'public-before'),
          privateTurn,
          publicAfter
        ],
        '2026-09-16T16:00:04.000Z'
      )
    );

    const conversation = (await repository.listConversations())[0]!;
    const stored = await repository.listMessages(conversation.id);
    expect(stored.map((message) => message.plainText)).toEqual(['public-before', 'public-after']);
    expect(JSON.stringify(stored)).not.toContain('SECRET-PAUSED-CONTENT');
    const suppressed = (await repository.listEvents(conversation.id)).filter(
      (event) => event.type === 'turn-suppressed'
    );
    expect(suppressed.length).toBeGreaterThanOrEqual(1);
    expect(suppressed.some((event) => event.id.includes('suppressed-slot:'))).toBe(true);
    expect(JSON.stringify(suppressed)).not.toContain('SECRET-PAUSED-CONTENT');
  });
});
