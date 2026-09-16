import type { ArchiveFootprint } from './archive-footprint';
import type { PerformanceSummary } from './metrics';

export const PERFORMANCE_PROFILE_SCHEMA = 'llm-chat-history/performance-profile';
export const PERFORMANCE_PROFILE_SCHEMA_VERSION = 1;

export interface PerformanceProfileReport {
  schema: typeof PERFORMANCE_PROFILE_SCHEMA;
  schemaVersion: typeof PERFORMANCE_PROFILE_SCHEMA_VERSION;
  generatedAt: string;
  extensionVersion: string;
  archive: ArchiveFootprint;
  metrics: {
    adapterSnapshot: PerformanceSummary;
    librarySearch: PerformanceSummary;
  };
}

function safeVersion(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._+-]+/g, '-').slice(0, 80) || 'unknown';
}

export function buildPerformanceProfileReport(input: {
  generatedAt?: string;
  extensionVersion?: string;
  archive: ArchiveFootprint;
  adapterSnapshot: PerformanceSummary;
  librarySearch: PerformanceSummary;
}): PerformanceProfileReport {
  return {
    schema: PERFORMANCE_PROFILE_SCHEMA,
    schemaVersion: PERFORMANCE_PROFILE_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    extensionVersion: safeVersion(input.extensionVersion ?? 'unknown'),
    archive: input.archive,
    metrics: {
      adapterSnapshot: input.adapterSnapshot,
      librarySearch: input.librarySearch
    }
  };
}

export function renderPerformanceProfileJson(report: PerformanceProfileReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function performanceProfileFilename(generatedAt: string): string {
  return `llm-chat-history-performance__${generatedAt.replace(/[:.]/g, '-')}.json`;
}
