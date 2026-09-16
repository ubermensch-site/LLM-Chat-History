import { calculateArchiveFootprint } from '../performance/archive-footprint';
import {
  loadPerformanceSamples,
  summarizePerformance
} from '../performance/metrics';
import {
  buildPerformanceProfileReport,
  performanceProfileFilename,
  renderPerformanceProfileJson,
  type PerformanceProfileReport
} from '../performance/report';
import { ArchiveRepository } from '../storage/archive';
import { openArchiveDb } from '../storage/db';
import { listProjects } from '../storage/projects';

const sidebar = document.querySelector<HTMLElement>('.sidebar');
if (!sidebar) throw new Error('Missing Library sidebar for performance controls');

const style = document.createElement('style');
style.textContent = `
  .performance-card { margin: 12px 2px 0; padding: 12px; border: 1px solid var(--outline-variant); border-radius: 16px; background: var(--surface); }
  .performance-title { font-size: 13px; font-weight: 750; }
  .performance-copy { margin: 6px 0 0; font-size: 10px; line-height: 1.4; color: var(--on-surface-variant); }
  .performance-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .performance-button { min-height: 32px; border: 1px solid var(--outline); border-radius: 18px; padding: 0 10px; background: var(--surface); color: var(--on-surface); cursor: pointer; font: inherit; font-size: 11px; font-weight: 650; }
  .performance-button.primary { background: var(--primary); border-color: var(--primary); color: var(--on-primary); }
  .performance-button:disabled { opacity: .45; cursor: default; }
  .performance-status { margin-top: 8px; font-size: 10px; line-height: 1.45; color: var(--on-surface-variant); white-space: pre-line; }
  .performance-status.error { color: var(--error); }
`;
document.head.append(style);

const card = document.createElement('section');
card.className = 'performance-card';
card.setAttribute('aria-label', 'Performance and storage profile');

const title = document.createElement('div');
title.className = 'performance-title';
title.textContent = 'Performance & storage';

const copy = document.createElement('p');
copy.className = 'performance-copy';
copy.textContent = 'Run an on-demand local profile. The report contains counts, byte estimates and timing summaries only—not chat text, titles, URLs, notes or search queries.';

const actions = document.createElement('div');
actions.className = 'performance-actions';
const runButton = document.createElement('button');
runButton.type = 'button';
runButton.className = 'performance-button primary';
runButton.textContent = 'Run profile';
const downloadButton = document.createElement('button');
downloadButton.type = 'button';
downloadButton.className = 'performance-button';
downloadButton.textContent = 'Download profile';
downloadButton.disabled = true;
actions.append(runButton, downloadButton);

const status = document.createElement('div');
status.className = 'performance-status';
status.setAttribute('aria-live', 'polite');
status.textContent = 'No profile has been run in this Library session.';

card.append(title, copy, actions, status);
sidebar.append(card);

let latestReport: PerformanceProfileReport | null = null;
let busy = false;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  return `${(kib / 1024).toFixed(2)} MiB`;
}

function metricLine(
  label: string,
  summary: PerformanceProfileReport['metrics']['adapterSnapshot']
): string {
  if (!summary.count) return `${label}: no samples yet`;
  return `${label}: ${summary.count} samples · mean ${summary.meanMs} ms · p50 ${summary.p50Ms} ms · p95 ${summary.p95Ms} ms · max ${summary.maxMs} ms`;
}

function renderReport(report: PerformanceProfileReport): void {
  const archive = report.archive;
  status.classList.remove('error');
  status.textContent = [
    `Archive: ${archive.conversations.count} chats · ${archive.messages.count} messages · ${archive.events.count} events · ${archive.projects.count} projects`,
    `Estimated structured data: ${formatBytes(archive.estimatedJsonBytes)} · message text: ${formatBytes(archive.messageTextBytes)}`,
    metricLine('Adapter snapshots', report.metrics.adapterSnapshot),
    metricLine('Library search', report.metrics.librarySearch)
  ].join('\n');
}

function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function runProfile(): Promise<void> {
  if (busy) return;
  busy = true;
  runButton.disabled = true;
  downloadButton.disabled = true;
  status.classList.remove('error');
  status.textContent = 'Profiling local archive…';

  try {
    const db = await openArchiveDb();
    try {
      const repository = new ArchiveRepository(db);
      const [conversations, events, projects, adapterSamples, searchSamples] = await Promise.all([
        repository.listConversations(),
        repository.listEvents(),
        listProjects(db),
        loadPerformanceSamples(chrome.storage.local, 'adapter-snapshot-ms'),
        loadPerformanceSamples(chrome.storage.local, 'library-search-ms')
      ]);
      const messageGroups = await Promise.all(
        conversations.map((conversation) => repository.listMessages(conversation.id))
      );
      const messages = messageGroups.flat();
      const generatedAt = new Date().toISOString();
      latestReport = buildPerformanceProfileReport({
        generatedAt,
        extensionVersion: chrome.runtime.getManifest().version,
        archive: calculateArchiveFootprint({ conversations, messages, events, projects }),
        adapterSnapshot: summarizePerformance(adapterSamples),
        librarySearch: summarizePerformance(searchSamples)
      });
      renderReport(latestReport);
      downloadButton.disabled = false;
    } finally {
      db.close();
    }
  } catch (error) {
    latestReport = null;
    status.classList.add('error');
    status.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    busy = false;
    runButton.disabled = false;
  }
}

runButton.addEventListener('click', () => {
  void runProfile();
});

downloadButton.addEventListener('click', () => {
  if (!latestReport || busy) return;
  downloadText(
    performanceProfileFilename(latestReport.generatedAt),
    renderPerformanceProfileJson(latestReport)
  );
});
