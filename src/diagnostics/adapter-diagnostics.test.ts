import { describe, expect, it } from 'vitest';
import type { ArchiveEvent } from '../storage/schema';
import {
  ADAPTER_DIAGNOSTICS_SCHEMA,
  buildAdapterDiagnosticsReport,
  renderAdapterDiagnosticsJson
} from './adapter-diagnostics';

function event(
  id: string,
  type: ArchiveEvent['type'],
  createdAt: string,
  data: ArchiveEvent['data']
): ArchiveEvent {
  return { id, type, createdAt, conversationId: type === 'adapter-health' ? null : 'conv:secret', data };
}

describe('adapter diagnostics report', () => {
  it('exports only allowlisted adapter health metadata', () => {
    const events: ArchiveEvent[] = [
      event('health-1', 'adapter-health', '2026-09-16T10:00:00.000Z', {
        providerId: 'chatgpt',
        state: 'degraded',
        code: 'conversation-has-no-rendered-turns',
        detail: 'SECRET PROMPT https://chatgpt.com/c/private-id'
      }),
      event('health-2', 'adapter-health', '2026-09-16T10:01:00.000Z', {
        providerId: 'chatgpt',
        state: 'error',
        code: 'Selector Failure Suspected !!!',
        detail: 'SECRET ASSISTANT RESPONSE'
      }),
      event('message', 'message-added', '2026-09-16T10:02:00.000Z', {
        title: 'SECRET CHAT TITLE',
        text: 'SECRET MESSAGE BODY',
        sourceUrl: 'https://chatgpt.com/c/private-id'
      }),
      event('checkpoint', 'checkpoint', '2026-09-16T10:03:00.000Z', {
        name: 'SECRET CHECKPOINT',
        note: 'SECRET CHECKPOINT NOTE'
      })
    ];

    const report = buildAdapterDiagnosticsReport(events, {
      generatedAt: '2026-09-16T11:00:00.000Z',
      extensionVersion: '0.0.1'
    });
    const json = renderAdapterDiagnosticsJson(report);

    expect(report.schema).toBe(ADAPTER_DIAGNOSTICS_SCHEMA);
    expect(report.totalHealthEvents).toBe(2);
    expect(report.countsByState).toEqual({ degraded: 1, error: 1 });
    expect(report.countsByCode).toEqual({
      'conversation-has-no-rendered-turns': 1,
      'selector-failure-suspected': 1
    });
    expect(report.recentHealthEvents).toEqual([
      {
        createdAt: '2026-09-16T10:00:00.000Z',
        providerId: 'chatgpt',
        state: 'degraded',
        code: 'conversation-has-no-rendered-turns'
      },
      {
        createdAt: '2026-09-16T10:01:00.000Z',
        providerId: 'chatgpt',
        state: 'error',
        code: 'selector-failure-suspected'
      }
    ]);

    for (const forbidden of [
      'SECRET PROMPT',
      'SECRET ASSISTANT RESPONSE',
      'SECRET CHAT TITLE',
      'SECRET MESSAGE BODY',
      'SECRET CHECKPOINT',
      'SECRET CHECKPOINT NOTE',
      'private-id',
      'sourceUrl',
      'conversationId',
      'detail'
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('bounds recent events and sanitizes unknown metadata', () => {
    const events: ArchiveEvent[] = Array.from({ length: 6 }, (_, index) =>
      event(`health-${index}`, 'adapter-health', `2026-09-16T10:0${index}:00.000Z`, {
        providerId: index === 5 ? 'other-provider' : 'chatgpt',
        state: index === 5 ? 'mystery-state' : 'healthy',
        code: index === 5 ? ' Strange Code / secret? ' : 'adapter-ready'
      })
    );

    const report = buildAdapterDiagnosticsReport(events, { recentLimit: 2 });
    expect(report.totalHealthEvents).toBe(6);
    expect(report.recentHealthEvents).toHaveLength(2);
    expect(report.recentHealthEvents[1]).toMatchObject({
      providerId: 'unknown',
      state: 'unknown',
      code: 'strange-code-secret'
    });
  });
});
