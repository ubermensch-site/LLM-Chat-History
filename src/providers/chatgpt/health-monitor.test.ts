import { describe, expect, it } from 'vitest';
import type { AdapterHealth } from '../../shared/types';
import { ChatGptHealthMonitor, SELECTOR_FAILURE_THRESHOLD } from './health-monitor';

function health(
  state: AdapterHealth['state'],
  code: string,
  observedAt = '2026-09-16T11:00:00.000Z'
): AdapterHealth {
  return { state, code, observedAt };
}

describe('ChatGptHealthMonitor', () => {
  it('keeps transient empty identified-conversation snapshots degraded', () => {
    const monitor = new ChatGptHealthMonitor();
    const empty = health('degraded', 'conversation-has-no-rendered-turns');

    for (let index = 1; index < SELECTOR_FAILURE_THRESHOLD; index += 1) {
      expect(monitor.assess(empty, 'chat-a')).toMatchObject({
        state: 'degraded',
        code: 'conversation-has-no-rendered-turns'
      });
    }
  });

  it('escalates repeated empty snapshots to a selector-failure error', () => {
    const monitor = new ChatGptHealthMonitor();
    const empty = health('degraded', 'conversation-has-no-rendered-turns');
    let result = empty;
    for (let index = 0; index < SELECTOR_FAILURE_THRESHOLD; index += 1) {
      result = monitor.assess(empty, 'chat-a');
    }

    expect(result).toMatchObject({
      state: 'error',
      code: 'selector-failure-suspected'
    });
    expect(result.detail).toContain(`${SELECTOR_FAILURE_THRESHOLD} consecutive snapshots`);
  });

  it('recovers immediately and resets the streak when semantic turns return', () => {
    const monitor = new ChatGptHealthMonitor();
    const empty = health('degraded', 'conversation-has-no-rendered-turns');
    for (let index = 0; index < SELECTOR_FAILURE_THRESHOLD; index += 1) {
      monitor.assess(empty, 'chat-a');
    }

    expect(monitor.assess(health('healthy', 'adapter-ready'), 'chat-a')).toMatchObject({
      state: 'healthy',
      code: 'adapter-ready'
    });
    expect(monitor.assess(empty, 'chat-a')).toMatchObject({
      state: 'degraded',
      code: 'conversation-has-no-rendered-turns'
    });
  });

  it('does not carry a failure streak across conversations', () => {
    const monitor = new ChatGptHealthMonitor();
    const empty = health('degraded', 'conversation-has-no-rendered-turns');
    monitor.assess(empty, 'chat-a');
    monitor.assess(empty, 'chat-a');

    expect(monitor.assess(empty, 'chat-b')).toMatchObject({
      state: 'degraded',
      code: 'conversation-has-no-rendered-turns'
    });
  });

  it('keeps missing stable IDs degraded without treating them as selector absence', () => {
    const monitor = new ChatGptHealthMonitor();
    const missingIds = health('degraded', 'turn-ids-missing');
    for (let index = 0; index < 10; index += 1) {
      expect(monitor.assess(missingIds, 'chat-a')).toMatchObject({
        state: 'degraded',
        code: 'turn-ids-missing'
      });
    }
  });
});
