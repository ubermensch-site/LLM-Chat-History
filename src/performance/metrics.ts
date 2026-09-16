export type PerformanceMetricName = 'adapter-snapshot-ms' | 'library-search-ms';

export interface PerformanceSample {
  metric: PerformanceMetricName;
  durationMs: number;
  at: string;
  itemCount?: number;
}

export interface PerformanceSummary {
  count: number;
  minMs: number | null;
  maxMs: number | null;
  meanMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  latestAt: string | null;
  latestItemCount: number | null;
}

export const MAX_PERFORMANCE_SAMPLES = 200;
const STORAGE_PREFIX = 'performanceSamples:';

export interface PerformanceStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export function performanceStorageKey(metric: PerformanceMetricName): string {
  return `${STORAGE_PREFIX}${metric}`;
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function sanitizeSample(sample: PerformanceSample): PerformanceSample | null {
  if (!Number.isFinite(sample.durationMs) || sample.durationMs < 0) return null;
  const result: PerformanceSample = {
    metric: sample.metric,
    durationMs: rounded(sample.durationMs),
    at: sample.at
  };
  if (sample.itemCount !== undefined && Number.isFinite(sample.itemCount) && sample.itemCount >= 0) {
    result.itemCount = Math.floor(sample.itemCount);
  }
  return result;
}

export function appendBoundedSample(
  existing: readonly PerformanceSample[],
  sample: PerformanceSample,
  limit = MAX_PERFORMANCE_SAMPLES
): PerformanceSample[] {
  const clean = sanitizeSample(sample);
  if (!clean || limit <= 0) return existing.slice(-Math.max(0, limit));
  return [...existing, clean].slice(-Math.floor(limit));
}

export async function recordPerformanceSample(
  storage: PerformanceStorageArea,
  sample: PerformanceSample
): Promise<void> {
  const key = performanceStorageKey(sample.metric);
  const current = await storage.get(key);
  const existing = Array.isArray(current[key]) ? (current[key] as PerformanceSample[]) : [];
  await storage.set({ [key]: appendBoundedSample(existing, sample) });
}

export async function loadPerformanceSamples(
  storage: PerformanceStorageArea,
  metric: PerformanceMetricName
): Promise<PerformanceSample[]> {
  const key = performanceStorageKey(metric);
  const current = await storage.get(key);
  const raw = Array.isArray(current[key]) ? (current[key] as PerformanceSample[]) : [];
  return raw.flatMap((sample) => {
    const clean = sanitizeSample(sample);
    return clean && clean.metric === metric ? [clean] : [];
  });
}

function percentile(sorted: readonly number[], fraction: number): number | null {
  if (!sorted.length) return null;
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return rounded(sorted[Math.min(index, sorted.length - 1)]!);
}

export function summarizePerformance(samples: readonly PerformanceSample[]): PerformanceSummary {
  const clean = samples.flatMap((sample) => {
    const sanitized = sanitizeSample(sample);
    return sanitized ? [sanitized] : [];
  });
  if (!clean.length) {
    return {
      count: 0,
      minMs: null,
      maxMs: null,
      meanMs: null,
      p50Ms: null,
      p95Ms: null,
      latestAt: null,
      latestItemCount: null
    };
  }

  const durations = clean.map((sample) => sample.durationMs).sort((a, b) => a - b);
  const total = durations.reduce((sum, value) => sum + value, 0);
  const latest = clean.reduce((current, sample) =>
    sample.at.localeCompare(current.at) >= 0 ? sample : current
  );

  return {
    count: durations.length,
    minMs: rounded(durations[0]!),
    maxMs: rounded(durations[durations.length - 1]!),
    meanMs: rounded(total / durations.length),
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    latestAt: latest.at,
    latestItemCount: latest.itemCount ?? null
  };
}
