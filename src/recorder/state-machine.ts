import type { RecorderCommand, RecorderState } from '../shared/types';

export class RecorderStateTransitionError extends Error {
  constructor(
    public readonly current: RecorderState,
    public readonly command: RecorderCommand
  ) {
    super(`Cannot ${command} while recorder is ${current}`);
    this.name = 'RecorderStateTransitionError';
  }
}

export function transitionRecorderState(
  current: RecorderState,
  command: RecorderCommand
): RecorderState {
  switch (current) {
    case 'recording':
      if (command === 'pause') return 'paused';
      if (command === 'stop') return 'stopped';
      if (command === 'resume' || command === 'start') return 'recording';
      break;
    case 'paused':
      if (command === 'resume') return 'recording';
      if (command === 'stop') return 'stopped';
      if (command === 'pause') return 'paused';
      break;
    case 'stopped':
      if (command === 'start') return 'recording';
      if (command === 'stop') return 'stopped';
      break;
    case 'error':
      if (command === 'start') return 'recording';
      if (command === 'stop') return 'stopped';
      break;
  }

  throw new RecorderStateTransitionError(current, command);
}

export function recorderEventTypeForCommand(
  command: RecorderCommand
): 'recording-started' | 'recording-paused' | 'recording-resumed' | 'recording-stopped' {
  switch (command) {
    case 'start':
      return 'recording-started';
    case 'pause':
      return 'recording-paused';
    case 'resume':
      return 'recording-resumed';
    case 'stop':
      return 'recording-stopped';
  }
}
