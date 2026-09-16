import { describe, expect, it } from 'vitest';
import { RecorderStateTransitionError, transitionRecorderState } from './state-machine';

describe('recorder state machine', () => {
  it('supports the intended recording lifecycle', () => {
    expect(transitionRecorderState('recording', 'pause')).toBe('paused');
    expect(transitionRecorderState('paused', 'resume')).toBe('recording');
    expect(transitionRecorderState('recording', 'stop')).toBe('stopped');
    expect(transitionRecorderState('stopped', 'start')).toBe('recording');
  });

  it('can stop from paused and recover from error only deliberately', () => {
    expect(transitionRecorderState('paused', 'stop')).toBe('stopped');
    expect(transitionRecorderState('error', 'start')).toBe('recording');
    expect(transitionRecorderState('error', 'stop')).toBe('stopped');
  });

  it('rejects invalid transitions instead of guessing intent', () => {
    expect(() => transitionRecorderState('recording', 'resume')).toThrow(
      RecorderStateTransitionError
    );
    expect(() => transitionRecorderState('paused', 'start')).toThrow(
      RecorderStateTransitionError
    );
    expect(() => transitionRecorderState('stopped', 'resume')).toThrow(
      RecorderStateTransitionError
    );
  });
});
