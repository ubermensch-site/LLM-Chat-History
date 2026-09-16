import { describe, expect, it } from 'vitest';
import {
  advanceStopConfirmation,
  isStopConfirmationArmed,
  transitionRecorderVisibility
} from './recorder-ui-state';

describe('recorder visibility state', () => {
  it('minimizes to the compact pill and hides independently', () => {
    expect(transitionRecorderVisibility('expanded', 'minimize')).toBe('collapsed');
    expect(transitionRecorderVisibility('collapsed', 'hide')).toBe('hidden');
    expect(transitionRecorderVisibility('expanded', 'hide')).toBe('hidden');
  });

  it('restores a hidden recorder explicitly', () => {
    expect(transitionRecorderVisibility('hidden', 'show')).toBe('expanded');
    expect(transitionRecorderVisibility('hidden', 'toggle')).toBe('expanded');
  });

  it('keeps minimize from accidentally restoring a hidden recorder', () => {
    expect(transitionRecorderVisibility('hidden', 'minimize')).toBe('hidden');
  });
});

describe('stop confirmation state', () => {
  it('requires a second action inside the confirmation window', () => {
    const first = advanceStopConfirmation({ deadlineMs: null }, 1_000, 5_000);
    expect(first.confirmed).toBe(false);
    expect(isStopConfirmationArmed(first.state, 2_000)).toBe(true);

    const second = advanceStopConfirmation(first.state, 3_000, 5_000);
    expect(second.confirmed).toBe(true);
    expect(second.state.deadlineMs).toBeNull();
  });

  it('re-arms instead of confirming after the window expires', () => {
    const first = advanceStopConfirmation({ deadlineMs: null }, 1_000, 5_000);
    const expired = advanceStopConfirmation(first.state, 7_000, 5_000);
    expect(expired.confirmed).toBe(false);
    expect(expired.state.deadlineMs).toBe(12_000);
  });
});
