export type RecorderVisibility = 'expanded' | 'collapsed' | 'hidden';
export type RecorderVisibilityAction = 'toggle' | 'minimize' | 'hide' | 'show';

export function transitionRecorderVisibility(
  current: RecorderVisibility,
  action: RecorderVisibilityAction
): RecorderVisibility {
  switch (action) {
    case 'show':
      return 'expanded';
    case 'hide':
      return 'hidden';
    case 'minimize':
      return current === 'hidden' ? 'hidden' : 'collapsed';
    case 'toggle':
      if (current === 'expanded') return 'collapsed';
      return 'expanded';
  }
}

export interface StopConfirmationState {
  deadlineMs: number | null;
}

export interface StopConfirmationResult {
  confirmed: boolean;
  state: StopConfirmationState;
}

export function advanceStopConfirmation(
  state: StopConfirmationState,
  nowMs: number,
  windowMs = 5_000
): StopConfirmationResult {
  if (state.deadlineMs !== null && nowMs <= state.deadlineMs) {
    return { confirmed: true, state: { deadlineMs: null } };
  }

  return {
    confirmed: false,
    state: { deadlineMs: nowMs + windowMs }
  };
}

export function isStopConfirmationArmed(
  state: StopConfirmationState,
  nowMs: number
): boolean {
  return state.deadlineMs !== null && nowMs <= state.deadlineMs;
}
