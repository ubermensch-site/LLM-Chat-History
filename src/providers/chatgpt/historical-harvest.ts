export interface HarvestViewportState {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface HarvestViewport {
  read(): HarvestViewportState;
  scrollTo(top: number): void;
}

export type HarvestPhase = 'up' | 'down' | 'restore';

export interface HistoricalHarvestProgress {
  phase: HarvestPhase;
  windowsScanned: number;
  uniqueTurnsSeen: number;
  scrollTop: number;
  scrollHeight: number;
}

export interface HistoricalHarvestOptions {
  viewport: HarvestViewport;
  captureWindow: () => Promise<readonly string[]> | readonly string[];
  settle: () => Promise<void>;
  onProgress?: (progress: HistoricalHarvestProgress) => void;
  maxWindows?: number;
  stableEdgePasses?: number;
  stepRatio?: number;
  edgeEpsilonPx?: number;
}

export interface HistoricalHarvestResult {
  windowsScanned: number;
  uniqueTurnsSeen: number;
  reachedTop: boolean;
  reachedBottom: boolean;
  truncated: boolean;
}

const DEFAULT_MAX_WINDOWS = 500;
const DEFAULT_STABLE_EDGE_PASSES = 2;
const DEFAULT_STEP_RATIO = 0.75;
const DEFAULT_EDGE_EPSILON_PX = 2;

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function normalizedState(viewport: HarvestViewport): HarvestViewportState {
  const state = viewport.read();
  const clientHeight = finiteNonNegative(state.clientHeight);
  const scrollHeight = Math.max(clientHeight, finiteNonNegative(state.scrollHeight));
  const maxTop = Math.max(0, scrollHeight - clientHeight);
  return {
    scrollTop: Math.min(maxTop, Math.max(0, finiteNonNegative(state.scrollTop))),
    scrollHeight,
    clientHeight
  };
}

function maxScrollTop(state: HarvestViewportState): number {
  return Math.max(0, state.scrollHeight - state.clientHeight);
}

function traversalStep(state: HarvestViewportState, stepRatio: number): number {
  // Never advance by a full viewport or more. The overlap is intentional: a
  // virtualized provider can replace most/all DOM nodes between scroll steps,
  // and overlapping windows are what let the archive reconcile ordering safely.
  return Math.max(1, state.clientHeight * stepRatio);
}

export async function runHistoricalScrollHarvest(
  options: HistoricalHarvestOptions
): Promise<HistoricalHarvestResult> {
  const maxWindows = Math.max(1, Math.floor(options.maxWindows ?? DEFAULT_MAX_WINDOWS));
  const stableEdgePasses = Math.max(
    1,
    Math.floor(options.stableEdgePasses ?? DEFAULT_STABLE_EDGE_PASSES)
  );
  const stepRatio = Math.min(0.95, Math.max(0.2, options.stepRatio ?? DEFAULT_STEP_RATIO));
  const epsilon = Math.max(0, options.edgeEpsilonPx ?? DEFAULT_EDGE_EPSILON_PX);

  const original = normalizedState(options.viewport);
  const originalBottomOffset = Math.max(
    0,
    original.scrollHeight - original.clientHeight - original.scrollTop
  );
  const seen = new Set<string>();
  let windowsScanned = 0;
  let reachedTop = false;
  let reachedBottom = false;
  let truncated = false;

  const capture = async (phase: HarvestPhase): Promise<number> => {
    if (windowsScanned >= maxWindows) {
      truncated = true;
      return 0;
    }
    const before = seen.size;
    const ids = await options.captureWindow();
    for (const id of ids) {
      if (id) seen.add(id);
    }
    windowsScanned += 1;
    const state = normalizedState(options.viewport);
    options.onProgress?.({
      phase,
      windowsScanned,
      uniqueTurnsSeen: seen.size,
      scrollTop: state.scrollTop,
      scrollHeight: state.scrollHeight
    });
    return seen.size - before;
  };

  try {
    await capture('up');

    let stableTop = 0;
    while (!truncated && !reachedTop) {
      const state = normalizedState(options.viewport);
      if (state.scrollTop > epsilon) {
        const step = traversalStep(state, stepRatio);
        options.viewport.scrollTo(Math.max(0, state.scrollTop - step));
        await options.settle();
        await capture('up');
        continue;
      }

      const beforeHeight = state.scrollHeight;
      await options.settle();
      const added = await capture('up');
      const after = normalizedState(options.viewport);
      const stableHeight = Math.abs(after.scrollHeight - beforeHeight) <= epsilon;
      const stillAtTop = after.scrollTop <= epsilon;
      stableTop = stillAtTop && stableHeight && added === 0 ? stableTop + 1 : 0;
      if (stableTop >= stableEdgePasses) {
        reachedTop = true;
        break;
      }
      options.viewport.scrollTo(0);
    }

    if (!truncated) {
      options.viewport.scrollTo(0);
      await options.settle();
      await capture('down');
    }

    let stableBottom = 0;
    while (!truncated && !reachedBottom) {
      const state = normalizedState(options.viewport);
      const maxTop = maxScrollTop(state);
      if (state.scrollTop < maxTop - epsilon) {
        const step = traversalStep(state, stepRatio);
        options.viewport.scrollTo(Math.min(maxTop, state.scrollTop + step));
        await options.settle();
        await capture('down');
        continue;
      }

      const beforeHeight = state.scrollHeight;
      await options.settle();
      const added = await capture('down');
      const after = normalizedState(options.viewport);
      const afterMaxTop = maxScrollTop(after);
      const stableHeight = Math.abs(after.scrollHeight - beforeHeight) <= epsilon;
      const stillAtBottom = after.scrollTop >= afterMaxTop - epsilon;
      stableBottom = stillAtBottom && stableHeight && added === 0 ? stableBottom + 1 : 0;
      if (stableBottom >= stableEdgePasses) {
        reachedBottom = true;
        break;
      }
      options.viewport.scrollTo(afterMaxTop);
    }
  } finally {
    const finalState = normalizedState(options.viewport);
    const restoreTop = Math.max(
      0,
      finalState.scrollHeight - finalState.clientHeight - originalBottomOffset
    );
    options.viewport.scrollTo(Math.min(maxScrollTop(finalState), restoreTop));
    options.onProgress?.({
      phase: 'restore',
      windowsScanned,
      uniqueTurnsSeen: seen.size,
      scrollTop: restoreTop,
      scrollHeight: finalState.scrollHeight
    });
  }

  return {
    windowsScanned,
    uniqueTurnsSeen: seen.size,
    reachedTop,
    reachedBottom,
    truncated
  };
}
