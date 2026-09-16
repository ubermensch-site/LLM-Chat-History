import { describe, expect, it } from 'vitest';
import {
  runHistoricalScrollHarvest,
  type HarvestViewport,
  type HarvestViewportState
} from './historical-harvest';

class FakeViewport implements HarvestViewport {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;

  constructor(state: HarvestViewportState) {
    this.scrollTop = state.scrollTop;
    this.scrollHeight = state.scrollHeight;
    this.clientHeight = state.clientHeight;
  }

  read(): HarvestViewportState {
    return {
      scrollTop: this.scrollTop,
      scrollHeight: this.scrollHeight,
      clientHeight: this.clientHeight
    };
  }

  scrollTo(top: number): void {
    this.scrollTop = Math.max(0, Math.min(top, this.scrollHeight - this.clientHeight));
  }
}

function visibleTurnIds(viewport: FakeViewport, total: number, rowHeight = 10): string[] {
  const first = Math.max(0, Math.floor(viewport.scrollTop / rowHeight));
  const visible = Math.ceil(viewport.clientHeight / rowHeight) + 2;
  const ids: string[] = [];
  for (let index = first; index < Math.min(total, first + visible); index += 1) {
    ids.push(`turn-${index}`);
  }
  return ids;
}

describe('historical scroll harvest', () => {
  it('walks overlapping virtualized windows across more than 1,000 turns and restores bottom position', async () => {
    const total = 1_002;
    const rowHeight = 10;
    const clientHeight = 120;
    const scrollHeight = total * rowHeight;
    const viewport = new FakeViewport({
      scrollTop: scrollHeight - clientHeight,
      scrollHeight,
      clientHeight
    });

    const result = await runHistoricalScrollHarvest({
      viewport,
      captureWindow: () => visibleTurnIds(viewport, total, rowHeight),
      settle: async () => undefined,
      maxWindows: 400,
      stepRatio: 0.75
    });

    expect(result.truncated).toBe(false);
    expect(result.reachedTop).toBe(true);
    expect(result.reachedBottom).toBe(true);
    expect(result.uniqueTurnsSeen).toBe(total);
    expect(viewport.scrollTop).toBe(scrollHeight - clientHeight);
  });

  it('waits for lazy older-history expansion at the top before traversing forward', async () => {
    const rowHeight = 10;
    let total = 100;
    const viewport = new FakeViewport({
      scrollTop: 700,
      scrollHeight: total * rowHeight,
      clientHeight: 100
    });
    let expanded = false;

    const result = await runHistoricalScrollHarvest({
      viewport,
      captureWindow: () => visibleTurnIds(viewport, total, rowHeight),
      settle: async () => {
        if (!expanded && viewport.scrollTop === 0) {
          expanded = true;
          total = 150;
          viewport.scrollHeight = total * rowHeight;
        }
      },
      maxWindows: 100
    });

    expect(expanded).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.reachedTop).toBe(true);
    expect(result.reachedBottom).toBe(true);
    expect(result.uniqueTurnsSeen).toBe(150);
  });

  it('restores the viewport even when a capture window fails', async () => {
    const viewport = new FakeViewport({ scrollTop: 700, scrollHeight: 1_000, clientHeight: 100 });
    const originalBottomOffset = 1_000 - 100 - 700;
    let calls = 0;

    await expect(
      runHistoricalScrollHarvest({
        viewport,
        captureWindow: () => {
          calls += 1;
          if (calls === 3) throw new Error('capture failed');
          return visibleTurnIds(viewport, 100);
        },
        settle: async () => undefined
      })
    ).rejects.toThrow('capture failed');

    expect(1_000 - 100 - viewport.scrollTop).toBe(originalBottomOffset);
  });

  it('reports truncation instead of looping forever when the window cap is reached', async () => {
    const viewport = new FakeViewport({ scrollTop: 9_900, scrollHeight: 10_000, clientHeight: 100 });

    const result = await runHistoricalScrollHarvest({
      viewport,
      captureWindow: () => visibleTurnIds(viewport, 1_000),
      settle: async () => undefined,
      maxWindows: 5
    });

    expect(result.truncated).toBe(true);
    expect(result.reachedTop).toBe(false);
    expect(result.windowsScanned).toBe(5);
  });
});
