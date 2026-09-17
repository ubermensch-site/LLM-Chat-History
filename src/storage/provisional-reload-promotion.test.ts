import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { stableSourceSessionId } from '../background/source-session';
import type { ContentToBackgroundMessage, ProviderObservation } from '../shared/types';
import { ArchiveRepository } from './archive';
import { openArchiveDb, requestToPromise } from './db';

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

function snapshot(
  sourceSessionId: string,
  providerConversationId: string | null,
  observedAt: string
): ContentToBackgroundMessage {
  const pageUrl = providerConversationId
    ? `https://chatgpt.com/c/${providerConversationId}`
    : 'https://chatgpt.com/';
  return {
    type: 'LLMCH_PROVIDER_OBSERVATION',
    providerId: 'chatgpt',
    sourceSessionId,
    pageUrl,
    observation: {
      type: 'turn-snapshot',
      observedAt,
      turns: [
        {
          providerId: 'chatgpt',
          providerConversationId,
          providerTurnId: 'user-1',
          providerMessageId: 'user-1',
          role: 'user',
          orderHint: 0,
          plainText: 'scenario 2 identity test',
          markdown: 'scenario 2 identity test',
          partial: false,
          observedAt
        },
        {
          providerId: 'chatgpt',
          providerConversationId,
          providerTurnId: 'assistant-1',
          providerMessageId: 'assistant-1',
          role: 'assistant',
          orderHint: 1,
          plainText: 'scenario 2 identity test passed',
          markdown: 'scenario 2 identity test passed',
          partial: false,
          observedAt
        }
      ]
    }
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

  it('ignores an older provisional snapshot that arrives after stable promotion', async () => {
    const repository = await createRepository();
    const sourceSessionId = stableSourceSessionId('content-session-before', 91);

    // The QA report taken on the home route creates the zero-message provisional
    // record before ChatGPT assigns the stable conversation route.
    await repository.persistObservation(
      conversation(sourceSessionId, null, '2026-09-17T05:01:39.220Z')
    );

    // The replacement document wins the transport race and promotes the archive.
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

    // A delayed snapshot from the document being replaced carries an older
    // observation time. It must not recreate an Untitled provisional copy.
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
