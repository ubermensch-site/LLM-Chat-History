import { describe, expect, it } from 'vitest';
import { renderJsonExport, type ArchiveExportBundle } from '../export/export';
import { messageId } from '../storage/ids';
import type { ArchiveConversation, ArchiveEvent, ArchiveMessage } from '../storage/schema';
import { ArchiveImportValidationError, parseJsonArchiveExport } from './json-import';

function bundle(): ArchiveExportBundle {
  const conversation: ArchiveConversation = {
    id: 'conv:chatgpt:backup-1',
    providerId: 'chatgpt',
    providerConversationId: 'provider-1',
    providerKey: 'chatgpt:provider-1',
    provisional: false,
    sourceUrl: 'https://chatgpt.com/c/provider-1',
    title: 'Import fixture',
    createdAt: '2026-09-16T10:00:00.000Z',
    updatedAt: '2026-09-16T10:05:00.000Z',
    lastObservedAt: '2026-09-16T10:05:00.000Z',
    messageCount: 2,
    recordingState: 'recording',
    recordingStateUpdatedAt: '2026-09-16T10:04:00.000Z'
  };

  const messages: ArchiveMessage[] = [
    {
      id: messageId(conversation.id, 'user-1'),
      conversationId: conversation.id,
      providerId: 'chatgpt',
      providerTurnId: 'user-1',
      providerMessageId: 'user-1',
      role: 'user',
      orderHint: 0,
      plainText: 'Question',
      markdown: 'Question',
      partial: false,
      contentHash: 'hash-user',
      firstObservedAt: '2026-09-16T10:01:00.000Z',
      lastObservedAt: '2026-09-16T10:01:00.000Z',
      updatedAt: '2026-09-16T10:01:00.000Z'
    },
    {
      id: messageId(conversation.id, 'assistant-1'),
      conversationId: conversation.id,
      providerId: 'chatgpt',
      providerTurnId: 'assistant-1',
      providerMessageId: 'assistant-1',
      role: 'assistant',
      orderHint: 1,
      plainText: 'Answer',
      markdown: '**Answer**',
      partial: false,
      modelLabel: 'GPT-5.6 Sol',
      visibleActivities: [
        {
          providerActivityId: 'assistant-1:visible:0:a',
          kind: 'reasoning-summary',
          text: 'Thinking',
          orderHint: 0,
          firstObservedAt: '2026-09-16T10:01:30.000Z',
          lastObservedAt: '2026-09-16T10:01:31.000Z'
        },
        {
          providerActivityId: 'assistant-1:visible:1:b',
          kind: 'tool',
          text: 'Fetched branch files',
          orderHint: 1,
          firstObservedAt: '2026-09-16T10:01:40.000Z',
          lastObservedAt: '2026-09-16T10:01:41.000Z'
        }
      ],
      contentHash: 'hash-assistant',
      firstObservedAt: '2026-09-16T10:02:00.000Z',
      lastObservedAt: '2026-09-16T10:02:00.000Z',
      updatedAt: '2026-09-16T10:02:00.000Z'
    }
  ];

  const events: ArchiveEvent[] = [
    {
      id: 'event-created',
      conversationId: conversation.id,
      type: 'conversation-created',
      createdAt: conversation.createdAt,
      data: { provisional: false }
    },
    {
      id: `suppressed:${conversation.id}:${encodeURIComponent('private-turn')}`,
      conversationId: conversation.id,
      type: 'turn-suppressed',
      createdAt: '2026-09-16T10:03:00.000Z',
      data: { providerTurnId: 'private-turn', reason: 'paused' }
    }
  ];

  return {
    conversation,
    messages,
    events,
    exportedAt: '2026-09-16T11:00:00.000Z'
  };
}

function mutateExport(mutator: (value: Record<string, unknown>) => void): string {
  const value = JSON.parse(renderJsonExport(bundle())) as Record<string, unknown>;
  mutator(value);
  return JSON.stringify(value);
}

describe('JSON archive import validation', () => {
  it('round-trips the current schema without changing normalized archive data', () => {
    const source = bundle();
    const parsed = parseJsonArchiveExport(renderJsonExport(source));
    expect(parsed).toEqual(source);
  });

  it('rejects malformed JSON and unsupported schema versions', () => {
    expect(() => parseJsonArchiveExport('{nope')).toThrow(ArchiveImportValidationError);
    expect(() =>
      parseJsonArchiveExport(
        mutateExport((value) => {
          value.schemaVersion = 99;
        })
      )
    ).toThrow(/unsupported schema version/);
  });

  it('rejects non-normalized message IDs before persistence', () => {
    const invalid = mutateExport((value) => {
      const messages = value.messages as Array<Record<string, unknown>>;
      messages[0]!.id = 'wrong-id';
    });
    expect(() => parseJsonArchiveExport(invalid)).toThrow(/expected normalized ID/);
  });

  it('rejects duplicate provider turn IDs and inconsistent message counts', () => {
    const duplicate = mutateExport((value) => {
      const messages = value.messages as Array<Record<string, unknown>>;
      const copy = { ...messages[0] };
      copy.id = messages[0]!.id;
      copy.providerTurnId = messages[0]!.providerTurnId;
      messages[1] = copy;
    });
    expect(() => parseJsonArchiveExport(duplicate)).toThrow(/duplicate identifiers/);

    const badCount = mutateExport((value) => {
      const conversation = value.conversation as Record<string, unknown>;
      conversation.messageCount = 7;
    });
    expect(() => parseJsonArchiveExport(badCount)).toThrow(/messageCount/);
  });

  it('rejects malformed suppression markers so privacy boundaries cannot be weakened', () => {
    const invalid = mutateExport((value) => {
      const events = value.events as Array<Record<string, unknown>>;
      events[1]!.id = 'suppressed:wrong-conversation:private-turn';
    });
    expect(() => parseJsonArchiveExport(invalid)).toThrow(/normalized suppression ID/);
  });

  it('rejects malformed or duplicate visible activity entries', () => {
    const invalidKind = mutateExport((value) => {
      const messages = value.messages as Array<Record<string, unknown>>;
      const activities = messages[1]!.visibleActivities as Array<Record<string, unknown>>;
      activities[0]!.kind = 'hidden-chain-of-thought';
    });
    expect(() => parseJsonArchiveExport(invalidKind)).toThrow(/visible activity kind/);

    const duplicate = mutateExport((value) => {
      const messages = value.messages as Array<Record<string, unknown>>;
      const activities = messages[1]!.visibleActivities as Array<Record<string, unknown>>;
      activities[1]!.providerActivityId = activities[0]!.providerActivityId;
    });
    expect(() => parseJsonArchiveExport(duplicate)).toThrow(/duplicate visible activity identifiers/);
  });
});
