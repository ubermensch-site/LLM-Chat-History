import type { AdapterHealthState, ProviderId } from '../shared/types';
import type { ArchiveEvent } from '../storage/schema';

export const ADAPTER_DIAGNOSTICS_SCHEMA = 'llm-chat-history/adapter-diagnostics';
export const ADAPTER_DIAGNOSTICS_SCHEMA_VERSION = 1;
export const DEFAULT_RECENT_HEALTH_EVENT_LIMIT = 100;

export interface AdapterDiagnosticsHealthEvent {
  createdAt: string;
  providerId: ProviderId | 'unknown';
  state: AdapterHealthState | 'unknown';
  code: string;
}

export interface AdapterDiagnosticsReport {
  schema: typeof ADAPTER_DIAGNOSTICS_SCHEMA;
  schemaVersion: typeof ADAPTER_DIAGNOSTICS_SCHEMA_VERSION;
  generatedAt: string;
  extensionVersion: string;
  totalHealthEvents: number;
  countsByState: Record<string, number>;
  countsByCode: Record<string, number>;
  recentHealthEvents: AdapterDiagnosticsHealthEvent[];
}

function safeToken(value: unknown, fallback = 'unknown'): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized.slice(0, 80) || fallback;
}

function safeState(value: unknown): AdapterHealthState | 'unknown' {
  return value === 'healthy' || value === 'degraded' || value === 'error' ? value : 'unknown';
}

function safeProvider(value: unknown): ProviderId | 'unknown' {
  return value === 'chatgpt' ? value : 'unknown';
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

export function buildAdapterDiagnosticsReport(
  events: readonly ArchiveEvent[],
  options: {
    generatedAt?: string;
    extensionVersion?: string;
    recentLimit?: number;
  } = {}
): AdapterDiagnosticsReport {
  const healthEvents = events
    .filter((event) => event.type === 'adapter-health')
    .map<AdapterDiagnosticsHealthEvent>((event) => ({
      createdAt: event.createdAt,
      providerId: safeProvider(event.data.providerId),
      state: safeState(event.data.state),
      code: safeToken(event.data.code)
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const countsByState: Record<string, number> = {};
  const countsByCode: Record<string, number> = {};
  for (const event of healthEvents) {
    increment(countsByState, event.state);
    increment(countsByCode, event.code);
  }

  const requestedLimit = options.recentLimit ?? DEFAULT_RECENT_HEALTH_EVENT_LIMIT;
  const recentLimit = Number.isFinite(requestedLimit)
    ? Math.max(0, Math.min(500, Math.floor(requestedLimit)))
    : DEFAULT_RECENT_HEALTH_EVENT_LIMIT;

  return {
    schema: ADAPTER_DIAGNOSTICS_SCHEMA,
    schemaVersion: ADAPTER_DIAGNOSTICS_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    extensionVersion: safeToken(options.extensionVersion ?? 'unknown'),
    totalHealthEvents: healthEvents.length,
    countsByState,
    countsByCode,
    recentHealthEvents: recentLimit === 0 ? [] : healthEvents.slice(-recentLimit)
  };
}

export function renderAdapterDiagnosticsJson(report: AdapterDiagnosticsReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function adapterDiagnosticsFilename(generatedAt: string): string {
  const safeTimestamp = generatedAt.replace(/[:.]/g, '-');
  return `llm-chat-history-diagnostics__${safeTimestamp}.json`;
}
