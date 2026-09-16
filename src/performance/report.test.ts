import { describe, expect, it } from 'vitest';
import type {
  ArchiveConversation,
  ArchiveEvent,
  ArchiveMessage,
  ArchiveProject
} from '../storage/schema';
import { calculateArchiveFootprint } from './archive-footprint';
import { summarizePerformance, type PerformanceSample } from './metrics';
import {
  PERFORMANCE_PROFILE_SCHEMA,
  buildPerformanceProfileReport,
  renderPerformanceProfileJson
} from './report';

const conversation: ArchiveConversation = {
  id: 'conv:chatgpt:secret',
  providerId: 'chatgpt',
  providerConversationId: 'secret-provider-id',
  providerKey: 'chatgpt:secret-provider-id',
  provisional: false,
  sourceUrl: 'https://chatgpt.com/c/SECRET-URL',
  title: 'SECRET TITLE',
  createdAt: '2026-09-16T11:00:00.000Z',
  updatedAt: '2026-09-16T11:00:00.000Z',
  lastObservedAt: '2026-09-16T11:00:00.000Z',
  messageCount: 1,
  recordingState: 'recording',
  recordingStateUpdatedAt: '2026-09-16T11:00:00.000Z'
};

const message: ArchiveMessage = {
  id: 'conv:chatgpt:secret:turn:1',
  conversationId: conversation.id,
  providerId: 'chatgpt',
  providerTurnId: '1',
  providerMessageId: 'provider-message-secret',
  role: 'user',
  orderHint: 0,
  plainText: 'SECRET PROMPT BODY',
  markdown: '**SECRET PROMPT BODY**',
  partial: false,
  contentHash: 'hash',
  firstObservedAt: '2026-09-16T11:00:00.000Z',
  lastObservedAt: '2026-09-16T11:00:00.000Z',
  updatedAt: '2026-09-16T11:00:00.000Z'
};

const event: ArchiveEvent = {
  id: 'checkpoint:secret',
  conversationId: conversation.id,
  type: 'checkpoint',
  createdAt: '2026-09-16T11:00:00.000Z',
  data: { name: 'SECRET CHECKPOINT', note: 'SECRET NOTE' }
};

const project: ArchiveProject = {
  id: 'project:secret',
  name: 'SECRET PROJECT',
  folders: [{ id: 'folder:secret', name: 'SECRET FOLDER' }],
  createdAt: '2026-09-16T11:00:00.000Z',
  updatedAt: '2026-09-16T11:00:00.000Z'
};

function samples(metric: PerformanceSample['metric']): PerformanceSample[] {
  return [
    { metric, durationMs: 2, at: '2026-09-16T11:00:00.000Z', itemCount: 10 },
    { metric, durationMs: 4, at: '2026-09-16T11:01:00.000Z', itemCount: 20 }
  ];
}

describe('performance profile report', () => {
  it('contains aggregate metadata only even when source archive contains secrets', () => {
    const report = buildPerformanceProfileReport({
      generatedAt: '2026-09-16T12:00:00.000Z',
      extensionVersion: '0.0.1 beta?',
      archive: calculateArchiveFootprint({
        conversations: [conversation],
        messages: [message],
        events: [event],
        projects: [project]
      }),
      adapterSnapshot: summarizePerformance(samples('adapter-snapshot-ms')),
      librarySearch: summarizePerformance(samples('library-search-ms'))
    });
    const json = renderPerformanceProfileJson(report);

    expect(report.schema).toBe(PERFORMANCE_PROFILE_SCHEMA);
    expect(report.extensionVersion).toBe('0.0.1-beta-');
    expect(report.archive.totalRecords).toBe(4);
    expect(report.metrics.adapterSnapshot.meanMs).toBe(3);

    for (const forbidden of [
      'SECRET TITLE',
      'SECRET-URL',
      'SECRET PROMPT BODY',
      'SECRET CHECKPOINT',
      'SECRET NOTE',
      'SECRET PROJECT',
      'SECRET FOLDER',
      'secret-provider-id',
      'provider-message-secret'
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });
});
