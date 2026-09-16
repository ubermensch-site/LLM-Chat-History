import type { AdapterHealth } from '../../shared/types';

export const SELECTOR_FAILURE_THRESHOLD = 3;

export class ChatGptHealthMonitor {
  private scopeKey: string | null = null;
  private noTurnStreak = 0;

  assess(base: AdapterHealth, scopeKey: string): AdapterHealth {
    if (scopeKey !== this.scopeKey) {
      this.scopeKey = scopeKey;
      this.noTurnStreak = 0;
    }

    if (base.code !== 'conversation-has-no-rendered-turns') {
      // Any semantic-turn or non-selector diagnostic proves the adapter is seeing
      // enough structure to reset the no-turn selector-failure streak.
      this.noTurnStreak = 0;
      return base;
    }

    this.noTurnStreak += 1;
    if (this.noTurnStreak < SELECTOR_FAILURE_THRESHOLD) return base;

    return {
      state: 'error',
      code: 'selector-failure-suspected',
      detail: `No semantic ChatGPT turns were detected for ${this.noTurnStreak} consecutive snapshots. The provider DOM may have changed.`,
      observedAt: base.observedAt
    };
  }

  reset(): void {
    this.scopeKey = null;
    this.noTurnStreak = 0;
  }
}
