import {
  adapterDiagnosticsFilename,
  buildAdapterDiagnosticsReport,
  renderAdapterDiagnosticsJson
} from '../diagnostics/adapter-diagnostics';
import { ArchiveRepository } from '../storage/archive';
import { openArchiveDb } from '../storage/db';

const sidebar = document.querySelector<HTMLElement>('.sidebar');
if (!sidebar) throw new Error('Missing Library sidebar for diagnostics controls');

const style = document.createElement('style');
style.textContent = `
  .diagnostics-card { margin: 12px 2px 0; padding: 12px; border: 1px solid var(--outline-variant); border-radius: 16px; background: var(--surface); }
  .diagnostics-title { font-size: 13px; font-weight: 750; }
  .diagnostics-copy { margin: 6px 0 0; font-size: 10px; line-height: 1.4; color: var(--on-surface-variant); }
  .diagnostics-button { margin-top: 10px; min-height: 32px; border: 1px solid var(--outline); border-radius: 18px; padding: 0 10px; background: var(--surface); color: var(--on-surface); cursor: pointer; font: inherit; font-size: 11px; font-weight: 650; }
  .diagnostics-button:disabled { opacity: .45; cursor: default; }
  .diagnostics-status { margin-top: 7px; min-height: 15px; font-size: 10px; line-height: 1.35; color: var(--on-surface-variant); }
  .diagnostics-status.error { color: var(--error); }
`;
document.head.append(style);

const card = document.createElement('section');
card.className = 'diagnostics-card';
card.setAttribute('aria-label', 'Adapter diagnostics');

const title = document.createElement('div');
title.className = 'diagnostics-title';
title.textContent = 'Adapter diagnostics';

const copy = document.createElement('p');
copy.className = 'diagnostics-copy';
copy.textContent = 'Download provider health metadata only. Chat titles, URLs, prompts, answers, checkpoint notes and message bodies are excluded.';

const button = document.createElement('button');
button.type = 'button';
button.className = 'diagnostics-button';
button.textContent = 'Download diagnostics';

const status = document.createElement('div');
status.className = 'diagnostics-status';
status.setAttribute('aria-live', 'polite');

card.append(title, copy, button, status);
sidebar.append(card);

function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

button.addEventListener('click', () => {
  button.disabled = true;
  status.classList.remove('error');
  status.textContent = 'Preparing privacy-safe health report…';

  void openArchiveDb()
    .then(async (db) => {
      try {
        const repository = new ArchiveRepository(db);
        // Intentionally load only events. Diagnostics must not read conversation,
        // message, project or checkpoint content surfaces.
        const events = await repository.listEvents();
        const generatedAt = new Date().toISOString();
        const report = buildAdapterDiagnosticsReport(events, {
          generatedAt,
          extensionVersion: chrome.runtime.getManifest().version
        });
        downloadText(adapterDiagnosticsFilename(generatedAt), renderAdapterDiagnosticsJson(report));
        status.textContent = `Downloaded ${report.totalHealthEvents} adapter health event(s).`;
      } finally {
        db.close();
      }
    })
    .catch((error: unknown) => {
      status.classList.add('error');
      status.textContent = error instanceof Error ? error.message : String(error);
    })
    .finally(() => {
      button.disabled = false;
    });
});
