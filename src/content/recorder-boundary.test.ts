import { describe, expect, it } from 'vitest';
import type { ProviderTurnObservation } from '../shared/types';
import {
  buildRecorderBoundarySnapshot,
  shouldFlushRecorderBoundary
} from './recorder-boundary';

function assistant(partial: boolean): ProviderTurnObservation {
  return {
    providerId: 'chatgpt',
    providerConversationId: 'conversation-3',
    providerTurnId: 'assistant-1',
    providerMessageId: 'assistant-1',
    role: 'assistant',
    orderHint: 1,
    plainText: partial ? 'Streaming answer' : 'Complete answer',
    markdown: partial ? 'Streaming answer' : 'Complete answer',
    partial,
    observedAt: '2026-09-18T07:32:40.000Z'
  };
}

describe('recorder command boundary snapshot', () => {
  it('flushes current rendered state before pause or stop while recording', () => {
    expect(shouldFlushRecorderBoundary('recording', 'pause')).toBe(true);
    expect(shouldFlushRecorderBoundary('recording', 'stop')).toBe(true);
    expect(
      buildRecorderBoundarySnapshot(
        'recording',
        'stop',
        [assistant(false)],
        '2026-09-18T07:32:40.100Z'
      )
    ).toEqual({
      type: 'turn-snapshot',
      turns: [assistant(false)],
      observedAt: '2026-09-18T07:32:40.100Z'
    });
  });

  it('never captures a boundary snapshot after privacy is already paused or stopped', () => {
    expect(shouldFlushRecorderBoundary('paused', 'stop')).toBe(false);
    expect(shouldFlushRecorderBoundary('stopped', 'start')).toBe(false);
    expect(
      buildRecorderBoundarySnapshot(
        'paused',
        'stop',
        [assistant(false)],
        '2026-09-18T07:32:40.100Z'
      )
    ).toBeNull();
  });

  it('does not flush on start/resume or when no turns are rendered', () => {
    expect(shouldFlushRecorderBoundary('recording', 'resume')).toBe(false);
    expect(shouldFlushRecorderBoundary('recording', 'start')).toBe(false);
    expect(
      buildRecorderBoundarySnapshot(
        'recording',
        'stop',
        [],
        '2026-09-18T07:32:40.100Z'
      )
    ).toBeNull();
  });
});
