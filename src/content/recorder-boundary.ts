import type {
  ProviderObservation,
  ProviderTurnObservation,
  RecorderCommand,
  RecorderState
} from '../shared/types';

export function shouldFlushRecorderBoundary(
  recordingState: RecorderState,
  command: RecorderCommand
): boolean {
  return recordingState === 'recording' && (command === 'pause' || command === 'stop');
}

export function buildRecorderBoundarySnapshot(
  recordingState: RecorderState,
  command: RecorderCommand,
  turns: ProviderTurnObservation[],
  observedAt: string
): ProviderObservation | null {
  if (!shouldFlushRecorderBoundary(recordingState, command) || turns.length === 0) return null;
  return {
    type: 'turn-snapshot',
    turns,
    observedAt
  };
}
