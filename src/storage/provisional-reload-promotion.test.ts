import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { stableSourceSessionId } from '../background/source-session';
import type {
  ContentToBackgroundMessage,
  ProviderObservation,
  ProviderTurnObservation
} from '../shared/types';
import { ArchiveRepository } from './archive';
import { openArchiveDb, requestToPromise, transactionDone } from './db';
import { STORES, type ArchiveConversation } from './schema';

const opened: Array<{ name: string; repository: ArchiveRepository }> = [];

async function createRepository(): Promise<ArchiveRepository> {
  const name = `llm-chat-history-reload-promotion-${crypto.randomUUID()}`;
  const db = await openArchiveDb({ name, factory: indexedDB });
  const repository = new ArchiveRepository(db);
  opened.push({ name, repository });
  return repository;
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

interface SnapshotOptions {
  idPrefix?: string;
  userText?: string;
  assistantText?: string;
  includeAssistant?: boolean;
}

function snapshot(
  sourceSessionId: string,
  providerConversationId: string | null,
  observedAt: string,
  options: SnapshotOptions = {}
): ContentToBackgroundMessage {
  const pageUrl = providerConversationId
    ? `https://chatgpt.com/c/${providerConversationId}`
    : 'https://chatgpt.com/';
  const idPrefix = options.idPrefix ?? '';
  const userText = options.userText ?? 'scenario 2 identity test';
  const assistantText = options.assistantText ?? 'scenario 2 identity test passed';
  const turns: ProviderTurnObservation[] = [
    {
      providerId: 'chatgpt',
      providerConversationId,
      providerTurnId: `${idPrefix}user-1`,
      providerMessageId: `${idPrefix}user-1`,
      role: 'user',
      orderHint: 0,
      plainText: userText,
      markdown: userText,
      partial: false,
      observedAt
    }
  ];

  if (options.includeAssistant !== false) {
    turns.push({
      providerId: 'chatgpt',
      providerConversationId,
      providerTurnId: `${idPrefix}assistant-1`,
      providerMessageId: `${idPrefix}assistant-1`,
      role: 'assistant',
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

async function patchConversationRecord(
  repository: ArchiveRepository,
  conversationId: string,
  patch: Partial<ArchiveConversation>
): Promise<void> {
  const entry = opened.find((candidate) => candidate.repository === repository);
  if (!entry) throw new Error('Repository is not tracked by this test');

  const db = await openArchiveDb({ name: entry.name, factory: indexedDB });
  const transaction = db.transaction(STORES.conversations, 'readwrite');
  const store = transaction.objectStore(STORES.conversations);
  const current = await requestToPromise<ArchiveConversation | undefined>(store.get(conversationId));
  if (!current) throw new Error(`Missing conversation ${conversationId}`);
  store.put({ ...current, ...patch } satisfies ArchiveConversation);
  await transactionDone(transaction);
  db.close();
}

afterEach(async () => {
  while (opened.length) {
    const entry = opened.pop();
    if (!entry) continue;
    entry.repository.close();
    await requestToPromise(indexedDB.deleteDatabase(entry.name));
  }
});

describe('Scenario 2 provisional identity across a document reload', () => {
  it('uses the tab-scoped source session so a new content script promotes in place', async () => {
    const repository = await createRepository();
    const tabId = 77;
    const beforeReload = stableSourceSessionId('content-session-before', tabId);
    const afterReload = stableSourceSessionId('content-session-after', tabId);

    expect(beforeReload).toBe('tab:77');
    expect(afterReload).toBe(beforeReload);

    await repository.persistObservation(
      conversation(beforeReload, null, '2026-09-16T19:21:48.440Z')
    );
    await repository.persistObservation(
      snapshot(beforeReload, null, '2026-09-16T19:22:54.000Z')
    );

    await repository.persistObservation(
      conversation(
        afterReload,
        'stable-conversation',
        '2026-09-16T19:23:03.000Z',
        'Identity test reply'
      )
    );
    await repository.persistObservation(
      snapshot(afterReload, 'stable-conversation', '2026-09-16T19:23:03.000Z')
    );

    const conversations = await repository.listConversations();
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({
      providerConversationId: 'stable-conversation',
      provisional: false,
      title: 'Identity test reply',
      messageCount: 2
    });
    expect(await repository.listMessages(conversations[0]!.id)).toHaveLength(2);
  });

  it('reconciles the same rendered turns when transport/session identity changes', async () => {
    const repository = await createRepository();
    const provisionalSession = 'content-only-provisional';
    const stableSession = 'tab:104';

    await repository.persistObservation(
      conversation(provisionalSession, null, '2026-09-17T12:12:15.948Z')
    );
    await repository.persistObservation(
      snapshot(provisionalSession, null, '2026-09-17T12:13:30.000Z')
    );

    await repository.persistObservation(
      conversation(
        stableSession,
        'stable-conversation',
        '2026-09-17T12:13:40.000Z',
        'Exact reply'
      )
    );
    await repository.persistObservation(
      snapshot(stableSession, 'stable-conversation', '2026-09-17T12:13:46.407Z')
    );

    const conversations = await repository.listConversations();
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({
      providerConversationId: 'stable-conversation',
      provisional: false,
      title: 'Exact reply',
      messageCount: 2
    });
    expect(await repository.listMessages(conversations[0]!.id)).toHaveLength(2);
  });

  it('reconciles identical rendered turns when provider turn and message IDs rotate', async () => {
    const repository = await createRepository();
    const provisionalSession = 'content-session-provisional';
    const stableSession = 'tab:205';

    await repository.persistObservation(
      conversation(provisionalSession, null, '2026-09-17T14:11:04.591Z')
    );
    await repository.persistObservation(
      snapshot(provisionalSession, null, '2026-09-17T14:11:40.000Z', {
        idPrefix: 'provisional-'
      })
    );

    await repository.persistObservation(
      conversation(
        stableSession,
        'stable-conversation',
        '2026-09-17T14:11:55.000Z',
        'LLM Chat History Test'
      )
    );
    await repository.persistObservation(
      snapshot(stableSession, 'stable-conversation', '2026-09-17T14:12:01.220Z', {
        idPrefix: 'stable-'
      })
    );

    const conversations = await repository.listConversations();
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({
      providerConversationId: 'stable-conversation',
      provisional: false,
      title: 'LLM Chat History Test',
      messageCount: 2
    });
    expect(await repository.listMessages(conversations[0]!.id)).toHaveLength(2);
  });

  it('does not reconcile when the complete rendered sequence differs', async () => {
    const repository = await createRepository();

    await repository.persistObservation(
      conversation('provisional-session', null, '2026-09-17T15:00:00.000Z')
    );
    await repository.persistObservation(
      snapshot('provisional-session', null, '2026-09-17T15:00:01.000Z', {
        idPrefix: 'provisional-'
      })
    );

    await repository.persistObservation(
      conversation('tab:301', 'stable-conversation', '2026-09-17T15:00:02.000Z', 'Different reply')
    );
    await repository.persistObservation(
      snapshot('tab:301', 'stable-conversation', '2026-09-17T15:00:03.000Z', {
        idPrefix: 'stable-',
        assistantText: 'scenario 2 identity test produced a different answer'
      })
    );

    const conversations = await repository.listConversations();
    expect(conversations).toHaveLength(2);
    expect(conversations.filter((entry) => entry.provisional)).toHaveLength(1);
    expect(conversations.filter((entry) => !entry.provisional)).toHaveLength(1);
    expect(conversations.map((entry) => entry.messageCount).sort()).toEqual([2, 2]);
  });

  it('does not reconcile a single repeated user turn', async () => {
    const repository = await createRepository();

    await repository.persistObservation(
      conversation('single-provisional', null, '2026-09-17T15:10:00.000Z')
    );
    await repository.persistObservation(
      snapshot('single-provisional', null, '2026-09-17T15:10:01.000Z', {
        idPrefix: 'provisional-',
        includeAssistant: false
      })
    );

    await repository.persistObservation(
      conversation('tab:302', 'stable-conversation', '2026-09-17T15:10:02.000Z', 'Single turn')
    );
    await repository.persistObservation(
      snapshot('tab:302', 'stable-conversation', '2026-09-17T15:10:03.000Z', {
        idPrefix: 'stable-',
        includeAssistant: false
      })
    );

    const conversations = await repository.listConversations();
    expect(conversations).toHaveLength(2);
    expect(conversations.map((entry) => entry.messageCount).sort()).toEqual([1, 1]);
  });

  it('does not reconcile a user-managed provisional record', async () => {
    const repository = await createRepository();

    await repository.persistObservation(
      conversation('managed-provisional', null, '2026-09-17T15:20:00.000Z')
    );
    await repository.persistObservation(
      snapshot('managed-provisional', null, '2026-09-17T15:20:01.000Z', {
        idPrefix: 'managed-'
      })
    );
    const provisional = (await repository.listConversations())[0]!;
    await patchConversationRecord(repository, provisional.id, { customTitle: 'Keep this local copy' });

    await repository.persistObservation(
      conversation('tab:303', 'stable-conversation', '2026-09-17T15:20:02.000Z', 'Stable copy')
    );
    await repository.persistObservation(
      snapshot('tab:303', 'stable-conversation', '2026-09-17T15:20:03.000Z', {
        idPrefix: 'stable-'
      })
    );

    const conversations = await repository.listConversations();
    expect(conversations).toHaveLength(2);
    expect(conversations.some((entry) => entry.customTitle === 'Keep this local copy')).toBe(true);
  });

  it('does not reconcile paused or stopped provisional records', async () => {
    const repository = await createRepository();

    await repository.persistObservation(
      conversation('paused-provisional', null, '2026-09-17T15:30:00.000Z')
    );
    await repository.persistObservation(
      snapshot('paused-provisional', null, '2026-09-17T15:30:01.000Z', {
        idPrefix: 'paused-'
      })
    );
    let provisional = (await repository.listConversations()).find((entry) => entry.provisional)!;
    await patchConversationRecord(repository, provisional.id, { recordingState: 'paused' });

    await repository.persistObservation(
      conversation('stopped-provisional', null, '2026-09-17T15:30:02.000Z')
    );
    await repository.persistObservation(
      snapshot('stopped-provisional', null, '2026-09-17T15:30:03.000Z', {
        idPrefix: 'stopped-'
      })
    );
    provisional = (await repository.listConversations()).find(
      (entry) => entry.provisional && entry.recordingState === 'recording'
    )!;
    await patchConversationRecord(repository, provisional.id, { recordingState: 'stopped' });

    await repository.persistObservation(
      conversation('tab:304', 'stable-conversation', '2026-09-17T15:30:04.000Z', 'Stable copy')
    );
    await repository.persistObservation(
      snapshot('tab:304', 'stable-conversation', '2026-09-17T15:30:05.000Z', {
        idPrefix: 'stable-'
      })
    );

    const conversations = await repository.listConversations();
    expect(conversations).toHaveLength(3);
    expect(conversations.some((entry) => entry.recordingState === 'paused')).toBe(true);
    expect(conversations.some((entry) => entry.recordingState === 'stopped')).toBe(true);
  });

  it('does not destructively reconcile when two provisional records are exact content matches', async () => {
    const repository = await createRepository();

    await repository.persistObservation(
      conversation('provisional-a', null, '2026-09-17T15:40:00.000Z')
    );
    await repository.persistObservation(
      snapshot('provisional-a', null, '2026-09-17T15:40:01.000Z', { idPrefix: 'a-' })
    );
    await repository.persistObservation(
      conversation('provisional-b', null, '2026-09-17T15:40:02.000Z')
    );
    await repository.persistObservation(
      snapshot('provisional-b', null, '2026-09-17T15:40:03.000Z', { idPrefix: 'b-' })
    );

    await repository.persistObservation(
      conversation('tab:305', 'stable-conversation', '2026-09-17T15:40:04.000Z', 'Stable copy')
    );
    await repository.persistObservation(
      snapshot('tab:305', 'stable-conversation', '2026-09-17T15:40:05.000Z', {
        idPrefix: 'stable-'
      })
    );

    const conversations = await repository.listConversations();
    expect(conversations).toHaveLength(3);
    expect(conversations.filter((entry) => entry.provisional)).toHaveLength(2);
    expect(conversations.filter((entry) => !entry.provisional)).toHaveLength(1);
  });

  it('ignores an older provisional snapshot that arrives after stable promotion', async () => {
    const repository = await createRepository();
    const sourceSessionId = stableSourceSessionId('content-session-before', 91);

    await repository.persistObservation(
      conversation(sourceSessionId, null, '2026-09-17T05:01:39.220Z')
    );

    await repository.persistObservation(
      conversation(
        sourceSessionId,
        'stable-conversation',
        '2026-09-17T05:02:02.000Z',
        'Reply scenario 2 identity test passed'
      )
    );
    await repository.persistObservation(
      snapshot(sourceSessionId, 'stable-conversation', '2026-09-17T05:02:02.100Z')
    );

    await repository.persistObservation(
      conversation(sourceSessionId, null, '2026-09-17T05:01:58.000Z')
    );
    await repository.persistObservation(
      snapshot(sourceSessionId, null, '2026-09-17T05:01:58.100Z')
    );

    const conversations = await repository.listConversations();
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({
      providerConversationId: 'stable-conversation',
      provisional: false,
      title: 'Reply scenario 2 identity test passed',
      messageCount: 2
    });
    expect(await repository.listMessages(conversations[0]!.id)).toHaveLength(2);
    const events = await repository.listEvents(conversations[0]!.id);
    expect(events.filter((event) => event.type === 'conversation-created')).toHaveLength(1);
  });

  it('releases the stable session claim when a genuinely newer new chat starts', async () => {
    const repository = await createRepository();
    const sourceSessionId = stableSourceSessionId('content-session', 92);

    await repository.persistObservation(
      conversation(sourceSessionId, null, '2026-09-17T05:01:00.000Z')
    );
    await repository.persistObservation(
      conversation(
        sourceSessionId,
        'first-stable-conversation',
        '2026-09-17T05:02:00.000Z',
        'First saved chat'
      )
    );
    await repository.persistObservation(
      snapshot(sourceSessionId, 'first-stable-conversation', '2026-09-17T05:02:01.000Z')
    );

    await repository.persistObservation(
      conversation(sourceSessionId, null, '2026-09-17T05:03:00.000Z', 'New later chat')
    );

    const conversations = await repository.listConversations();
    expect(conversations).toHaveLength(2);
    expect(conversations.filter((entry) => entry.provisional)).toHaveLength(1);
    expect(conversations.filter((entry) => !entry.provisional)).toHaveLength(1);
    expect(conversations.find((entry) => entry.provisional)?.title).toBe('New later chat');
  });

  it('keeps different tabs isolated', () => {
    expect(stableSourceSessionId('same-content-id', 77)).toBe('tab:77');
    expect(stableSourceSessionId('same-content-id', 78)).toBe('tab:78');
    expect(stableSourceSessionId('content-only', undefined)).toBe('content-only');
  });
});
