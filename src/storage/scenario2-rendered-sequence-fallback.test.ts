import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ContentToBackgroundMessage,
  ProviderObservation,
  RecorderCommand
} from '../shared/types';
import { ArchiveRepository } from './archive';
import { openArchiveDb, requestToPromise, transactionDone } from './db';
import { STORES, type ArchiveConversation } from './schema';

const opened: Array<{ name: string; repository: ArchiveRepository }> = [];

async function createRepository(): Promise<{
  name: string;
  db: IDBDatabase;
  repository: ArchiveRepository;
}> {
  const name = `llm-chat-history-scenario2-sequence-${crypto.randomUUID()}`;
  const db = await openArchiveDb({ name, factory: indexedDB });
  const repository = new ArchiveRepository(db);
  opened.push({ name, repository });
  return { name, db, repository };
}

function conversation(
  sourceSessionId: string,
  providerConversationId: string | null,
  observedAt: string,
  title: string | null = null
): ContentToBackgroundMessage {
  const sourceUrl = providerConversationId
    ? `https://chatgpt.com/c/${providerConversationId}`
    : 'https://chatgpt.com/';
  const observation: ProviderObservation = {
    type: 'conversation',
    identity: {
      providerId: 'chatgpt',
      providerConversationId,
      sourceUrl,
      provisional: providerConversationId === null
    },
    title,
    observedAt
  };
  return {
    type: 'LLMCH_PROVIDER_OBSERVATION',
    providerId: 'chatgpt',
    sourceSessionId,
    pageUrl: sourceUrl,
    observation
  };
}

function snapshot(
  sourceSessionId: string,
  providerConversationId: string | null,
  observedAt: string,
  idPrefix: string,
  options: {
    userText?: string;
    assistantText?: string;
    singleUserTurn?: boolean;
  } = {}
): ContentToBackgroundMessage {
  const pageUrl = providerConversationId
    ? `https://chatgpt.com/c/${providerConversationId}`
    : 'https://chatgpt.com/';
  const userText = options.userText ?? 'Reply with exactly: scenario 2 identity test passed';
  const assistantText = options.assistantText ?? 'scenario 2 identity test passed';
  const turns = [
    {
      providerId: 'chatgpt' as const,
      providerConversationId,
      providerTurnId: `${idPrefix}-user-turn`,
      providerMessageId: `${idPrefix}-user-message`,
      role: 'user' as const,
      orderHint: 0,
      plainText: userText,
      markdown: userText,
      partial: false,
      observedAt
    }
  ];

  if (!options.singleUserTurn) {
    turns.push({
      providerId: 'chatgpt' as const,
      providerConversationId,
      providerTurnId: `${idPrefix}-assistant-turn`,
      providerMessageId: `${idPrefix}-assistant-message`,
      role: 'assistant' as const,
      orderHint: 1,
      plainText: assistantText,
      markdown: assistantText,
      partial: false,
      observedAt
    });
  }

  return {
    type: 'LLMCH_PROVIDER_OBSERVATION',
    providerId: 'chatgpt',
    sourceSessionId,
    pageUrl,
    observation: {
      type: 'turn-snapshot',
      observedAt,
      turns
    }
  };
}

async function setCustomTitle(db: IDBDatabase, conversationId: string): Promise<void> {
  const transaction = db.transaction(STORES.conversations, 'readwrite');
  const store = transaction.objectStore(STORES.conversations);
  const current = await requestToPromise<ArchiveConversation | undefined>(store.get(conversationId));
  if (!current) throw new Error('Conversation not found');
  store.put({ ...current, customTitle: 'Keep this local chat' } satisfies ArchiveConversation);
  await transactionDone(transaction);
}

async function changeRecorderState(
  repository: ArchiveRepository,
  sourceSessionId: string,
  command: Extract<RecorderCommand, 'pause' | 'stop'>,
  observedAt: string
): Promise<void> {
  await repository.applyRecorderCommand({
    type: 'LLMCH_RECORDER_COMMAND',
    requestId: `${command}-${crypto.randomUUID()}`,
    providerId: 'chatgpt',
    sourceSessionId,
    pageUrl: 'https://chatgpt.com/',
    identity: {
      providerId: 'chatgpt',
      providerConversationId: null,
      sourceUrl: 'https://chatgpt.com/',
      provisional: true
    },
    command,
    observedAt
  });
}

async function persistStablePair(
  repository: ArchiveRepository,
  stableSession: string,
  observedAt: string,
  options: Parameters<typeof snapshot>[4] = {}
): Promise<void> {
  await repository.persistObservation(
    conversation(stableSession, 'stable-scenario-2', observedAt, 'Exact reply')
  );
  await repository.persistObservation(
    snapshot(stableSession, 'stable-scenario-2', observedAt, 'stable', options)
  );
}

afterEach(async () => {
  while (opened.length) {
    const entry = opened.pop();
    if (!entry) continue;
    entry.repository.close();
    await requestToPromise(indexedDB.deleteDatabase(entry.name));
  }
});

describe('Scenario 2 rendered-sequence fallback', () => {
  it('reconciles one untouched provisional chat when provider IDs rotate', async () => {
    const { repository } = await createRepository();

    await repository.persistObservation(
      conversation('provisional-document', null, '2026-09-17T14:11:04.591Z')
    );
    await repository.persistObservation(
      snapshot('provisional-document', null, '2026-09-17T14:11:40.000Z', 'provisional')
    );

    await persistStablePair(repository, 'stable-document', '2026-09-17T14:12:01.220Z');

    const conversations = await repository.listConversations();
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({
      providerConversationId: 'stable-scenario-2',
      provisional: false,
      title: 'Exact reply',
      messageCount: 2
    });
    expect(await repository.listMessages(conversations[0]!.id)).toHaveLength(2);
  });

  it('does not reconcile when the complete rendered sequence differs', async () => {
    const { repository } = await createRepository();

    await repository.persistObservation(conversation('provisional-document', null, '2026-09-17T14:11:04.591Z'));
    await repository.persistObservation(
      snapshot('provisional-document', null, '2026-09-17T14:11:40.000Z', 'provisional', {
        assistantText: 'different assistant reply'
      })
    );

    await persistStablePair(repository, 'stable-document', '2026-09-17T14:12:01.220Z');

    expect(await repository.listConversations()).toHaveLength(2);
  });

  it('does not use content fallback for a single repeated user turn', async () => {
    const { repository } = await createRepository();

    await repository.persistObservation(conversation('provisional-document', null, '2026-09-17T14:11:04.591Z'));
    await repository.persistObservation(
      snapshot('provisional-document', null, '2026-09-17T14:11:40.000Z', 'provisional', {
        singleUserTurn: true
      })
    );

    await persistStablePair(repository, 'stable-document', '2026-09-17T14:12:01.220Z', {
      singleUserTurn: true
    });

    expect(await repository.listConversations()).toHaveLength(2);
  });

  it('does not reconcile a user-customized provisional record', async () => {
    const { db, repository } = await createRepository();

    await repository.persistObservation(conversation('provisional-document', null, '2026-09-17T14:11:04.591Z'));
    await repository.persistObservation(
      snapshot('provisional-document', null, '2026-09-17T14:11:40.000Z', 'provisional')
    );
    const provisional = (await repository.listConversations())[0]!;
    await setCustomTitle(db, provisional.id);

    await persistStablePair(repository, 'stable-document', '2026-09-17T14:12:01.220Z');

    expect(await repository.listConversations()).toHaveLength(2);
  });

  it.each(['pause', 'stop'] as const)(
    'does not reconcile a %sed provisional record',
    async (command) => {
      const { repository } = await createRepository();

      await repository.persistObservation(conversation('provisional-document', null, '2026-09-17T14:11:04.591Z'));
      await repository.persistObservation(
        snapshot('provisional-document', null, '2026-09-17T14:11:40.000Z', 'provisional')
      );
      await changeRecorderState(
        repository,
        'provisional-document',
        command,
        '2026-09-17T14:11:50.000Z'
      );

      await persistStablePair(repository, 'stable-document', '2026-09-17T14:12:01.220Z');

      expect(await repository.listConversations()).toHaveLength(2);
    }
  );

  it('does not delete anything when two provisional candidates match exactly', async () => {
    const { repository } = await createRepository();

    for (const [session, prefix] of [
      ['provisional-document-a', 'provisional-a'],
      ['provisional-document-b', 'provisional-b']
    ] as const) {
      await repository.persistObservation(conversation(session, null, '2026-09-17T14:11:04.591Z'));
      await repository.persistObservation(
        snapshot(session, null, '2026-09-17T14:11:40.000Z', prefix)
      );
    }

    await persistStablePair(repository, 'stable-document', '2026-09-17T14:12:01.220Z');

    const conversations = await repository.listConversations();
    expect(conversations).toHaveLength(3);
    expect(conversations.filter((entry) => entry.provisional)).toHaveLength(2);
    expect(conversations.filter((entry) => !entry.provisional)).toHaveLength(1);
  });
});
