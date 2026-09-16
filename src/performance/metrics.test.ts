import { describe, expect, it } from 'vitest';
import {
  MAX_PERFORMANCE_SAMPLES,
  appendBoundedSample,
  loadPerformanceSamples,
  performanceStorageKey,
  recordPerformanceSample,
  summarizePerformance,
  type PerformanceSample,
  type PerformanceStorageArea
} from './metrics';

class MemoryStorage implements PerformanceStorageArea {
  data: Record<string, unknown> = {};

  async get(key: string): Promise<Record<string, unknown>> {
    return { [key]: this.data[key] };
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.data, items);
  }
}

function sample(index: number): PerformanceSample {
  return {
    metric: 'adapter-snapshot-ms',
    durationMs: index + 0.12345,
    at: `2026-09-16T11:${String(index % 60).padStart(2, '0')}:00.000Z`,
    itemCount: index
  };
}

describe('performance metrics', () => {
  it('retains only the most recent bounded samples', () => {
    let samples: PerformanceSample[] = [];
    for (let index = 0; index < MAX_PERFORMANCE_SAMPLES + 25; index += 1) {
      samples = appendBoundedSample(samples, sample(index));
    }
    expect(samples).toHaveLength(MAX_PERFORMANCE_SAMPLES);
    expect(samples[0]?.itemCount).toBe(25);
    expect(samples.at(-1)?.itemCount).toBe(MAX_PERFORMANCE_SAMPLES + 24);
  });

  it('ignores invalid negative/non-finite duration samples', () => {
    const existing = [sample(1)];
    expect(
      appendBoundedSample(existing, {
        metric: 'adapter-snapshot-ms',
        durationMs: -1,
        at: '2026-09-16T11:00:00.000Z'
      })
    ).toEqual(existing);
    expect(
      appendBoundedSample(existing, {
        metric: 'adapter-snapshot-ms',
        durationMs: Number.NaN,
        at: '2026-09-16T11:00:00.000Z'
      })
    ).toEqual(existing);
  });

  it('summarizes count, extrema, mean and percentiles deterministically', () => {
    const samples: PerformanceSample[] = [1, 2, 3, 4, 100].map((durationMs, index) => ({
      metric: 'library-search-ms',
      durationMs,
      at: `2026-09-16T11:0${index}:00.000Z`,
      itemCount: index * 10
    }));
    expect(summarizePerformance(samples)).toEqual({
      count: 5,
      minMs: 1,
      maxMs: 100,
      meanMs: 22,
      p50Ms: 3,
      p95Ms: 100,
      latestAt: '2026-09-16T11:04:00.000Z',
      latestItemCount: 40
    });
  });

  it('persists and reloads content-free samples under metric-specific keys', async () => {
    const storage = new MemoryStorage();
    await recordPerformanceSample(storage, {
      metric: 'library-search-ms',
      durationMs: 12.34567,
      at: '2026-09-16T11:00:00.000Z',
      itemCount: 9
    });
    const loaded = await loadPerformanceSamples(storage, 'library-search-ms');
    expect(loaded).toEqual([
      {
        metric: 'library-search-ms',
        durationMs: 12.346,
        at: '2026-09-16T11:00:00.000Z',
        itemCount: 9
      }
    ]);
    expect(storage.data[performanceStorageKey('adapter-snapshot-ms')]).toBeUndefined();
  });
});
