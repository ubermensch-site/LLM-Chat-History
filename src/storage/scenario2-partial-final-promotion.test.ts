import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { ContentToBackgroundMessage, ProviderObservation, ProviderTurnObservation } from '../shared/types';
import { ArchiveRepository } from './archive';
import { openArchiveDb, requestToPromise } from './db';

const opened: Array<{ name: string; repository: ArchiveRepository }> = [];

async function createRepository(): Promise<ArchiveRepository> {
  const name = `llm-chat-history-scenario2-partial-final-${crypto.randomUUID()}`;
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

function snapshot(
  sourceSessionId: string,
  providerConversationId: string | null,
  observedAt: string,
  options: {
    idPrefix: string;
    userText?: string;
    assistantText?: string;
    assistantPartial?: boolean;
  }
): ContentToBackgroundMessage {
  const pageUrl = providerConversationId
    ? `https://chatgpt.com/c/${providerConversationId}`
    : 'https://chatgpt.com/';
  const userText = options.userText ?? 'Reply with exactly: scenario 2 identity test passed';
  const assistantText = options.assistantText ?? 'scenario 2 identity test passed';
  const turns: ProviderTurnObservation[] = [
    {
      providerId: 'chatgpt',
      providerConversationId,
      providerTurnId: `${options.idPrefix}-user-turn`,
      providerMessageId: `${options.idPrefix}-user-message`,
      role: 'user',
      orderHint: 0,
      plainText: userText,
      markdown: userText,
      partial: false,
      observedAt
    },
    {
      providerId: 'chatgpt',
      providerConversationId,
      providerTurnId: `${options.idPrefix}-assistant-turn`,
      providerMessageId: `${options.idPrefix}-assistant-message`,
      role: 'assistant',
      orderHint: 1,
      plainText: assistantText,
      markdown: assistantText,
      partial: options.assistantPartial ?? false,
      observedAt
    }
  ];
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

async function persistStableFinal(
  repository: ArchiveRepository,
  observedAt: string,
  userText = 'Reply with exactly: scenario 2 identity test passed'
): Promise<void> {
  await repository.persistObservation(
    conversation('tab:501', 'stable-conversation', observedAt, 'Identity test reply')
  );
  await repository.persistObservation(
    snapshot('tab:501', 'stable-conversation', observedAt, {
      idPrefix: 'stable',
      userText,
      assistantText: 'scenario 2 identity test passed',
      assistantPartial: false
    })
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

describe('Scenario 2 partial provisional to stable final promotion', () => {
  it('reconciles the live race: exact user turn plus partial assistant becomes one stable final chat', async () => {
    const repository = await createRepository();

    await repository.persistObservation(
      conversation('provisional-document', null, '2026-09-17T16:09:11.463Z')
    );
    await repository.persistObservation(
      snapshot('provisional-document', null, '2026-09-17T16:09:59.000Z', {
        idPrefix: 'provisional',
        assistantText: 'Thinking',
        assistantPartial: true
      })
    );

    await persistStableFinal(repository, '2026-09-17T16:10:06.995Z');

    const conversations = await repository.listConversations();
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({
      providerConversationId: 'stable-conversation',
      provisional: false,
      title: 'Identity test reply',
      messageCount: 2
    });
    const messages = await repository.listMessages(conversations[0]!.id);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      plainText: 'scenario 2 identity test passed',
      partial: false
    });
  });

  it('does not reconcile a partial candidate when the user turn differs', async () => {
    const repository = await createRepository();

    await repository.persistObservation(
      conversation('provisional-document', null, '2026-09-17T16:20:00.000Z')
    );
    await repository.persistObservation(
      snapshot('provisional-document', null, '2026-09-17T16:20:01.000Z', {
        idPrefix: 'provisional',
        userText: 'A different prompt',
        assistantText: 'Thinking',
        assistantPartial: true
      })
    );
    await persistStableFinal(repository, '2026-09-17T16:20:05.000Z');

    expect(await repository.listConversations()).toHaveLength(2);
  });

  it('does not reconcile an old partial candidate outside the narrow promotion window', async () => {
    const repository = await createRepository();

    await repository.persistObservation(
      conversation('provisional-document', null, '2026-09-17T16:00:00.000Z')
    );
    await repository.persistObservation(
      snapshot('provisional-document', null, '2026-09-17T16:00:01.000Z', {
        idPrefix: 'provisional',
        assistantText: 'Thinking',
        assistantPartial: true
      })
    );
    await persistStableFinal(repository, '2026-09-17T16:05:00.000Z');

    expect(await repository.listConversations()).toHaveLength(2);
  });

  it('does not destructively reconcile when two fresh partial candidates match the same final chat', async () => {
    const repository = await createRepository();

    for (const [session, second] of [
      ['provisional-a', '00'],
      ['provisional-b', '02']
    ] as const) {
      await repository.persistObservation(
        conversation(session, null, `2026-09-17T16:30:${second}.000Z`)
      );
      await repository.persistObservation(
        snapshot(session, null, `2026-09-17T16:30:${Number(second) + 1}.000Z`, {
          idPrefix: session,
          assistantText: 'Thinking',
          assistantPartial: true
        })
      );
    }

    await persistStableFinal(repository, '2026-09-17T16:30:05.000Z');

    const conversations = await repository.listConversations();
    expect(conversations).toHaveLength(3);
    expect(conversations.filter((entry) => entry.provisional)).toHaveLength(2);
  });

  it('does not reconcile a finalized assistant with different content through the partial fallback', async () => {
    const repository = await createRepository();

    await repository.persistObservation(
      conversation('provisional-document', null, '2026-09-17T16:40:00.000Z')
    );
    await repository.persistObservation(
      snapshot('provisional-document', null, '2026-09-17T16:40:01.000Z', {
        idPrefix: 'provisional',
        assistantText: 'A different completed answer',
        assistantPartial: false
      })
    );
    await persistStableFinal(repository, '2026-09-17T16:40:05.000Z');

    expect(await repository.listConversations()).toHaveLength(2);
  });
});
