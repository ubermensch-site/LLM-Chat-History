import { evaluateLiveQaEvidence, renderLiveQaEvidenceMarkdown } from '../qa/live-qa-evidence';

const sidebar = document.querySelector<HTMLElement>('.sidebar');
if (!sidebar) throw new Error('Missing Library sidebar for live QA evidence controls');

const style = document.createElement('style');
style.textContent = `
  .qa-evidence-card { margin: 12px 2px 0; padding: 12px; border: 1px solid var(--outline-variant); border-radius: 16px; background: var(--surface); }
  .qa-evidence-title { font-size: 13px; font-weight: 750; }
  .qa-evidence-copy { margin: 6px 0 0; font-size: 10px; line-height: 1.4; color: var(--on-surface-variant); }
  .qa-evidence-input { display: block; width: 100%; margin-top: 10px; font: inherit; font-size: 10px; }
  .qa-evidence-status { margin-top: 8px; font-size: 10px; line-height: 1.4; color: var(--on-surface-variant); white-space: pre-wrap; }
  .qa-evidence-status.fail { color: var(--error); }
  .qa-evidence-status.pass { color: #2e7d32; }
  .qa-evidence-actions { margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap; }
  .qa-evidence-button { min-height: 30px; border: 1px solid var(--outline); border-radius: 18px; padding: 0 10px; background: var(--surface); color: var(--on-surface); cursor: pointer; font: inherit; font-size: 10px; font-weight: 650; }
  .qa-evidence-button:disabled { opacity: .45; cursor: default; }
`;
document.head.append(style);

const card = document.createElement('section');
card.className = 'qa-evidence-card';
card.setAttribute('aria-label', 'Live QA evidence validator');

const title = document.createElement('div');
title.className = 'qa-evidence-title';
title.textContent = 'Live QA evidence';

const copy = document.createElement('p');
copy.className = 'qa-evidence-copy';
copy.textContent = 'Validate a privacy-safe QA report locally. Nothing is uploaded. One report checks structural consistency only; scenario-level PASS still follows the live QA checklist.';

const input = document.createElement('input');
input.type = 'file';
input.accept = 'application/json,.json';
input.className = 'qa-evidence-input';
input.setAttribute('aria-label', 'Choose a live QA JSON report to validate locally');

const status = document.createElement('div');
status.className = 'qa-evidence-status';
status.setAttribute('aria-live', 'polite');
status.textContent = 'Choose a llm-chat-history-live-qa JSON file.';

const actions = document.createElement('div');
actions.className = 'qa-evidence-actions';
const download = document.createElement('button');
download.type = 'button';
download.className = 'qa-evidence-button';
download.textContent = 'Download summary';
download.disabled = true;
actions.append(download);

card.append(title, copy, input, status, actions);
sidebar.append(card);

let latestMarkdown: string | null = null;

function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function renderResult(result: ReturnType<typeof evaluateLiveQaEvidence>): void {
  latestMarkdown = renderLiveQaEvidenceMarkdown(result);
  download.disabled = false;
  status.className = `qa-evidence-status ${result.structuralPass ? 'pass' : 'fail'}`;
  const warnings = result.checks.filter((check) => check.status === 'warn').length;
  const failures = result.checks.filter((check) => check.status === 'fail').length;
  status.textContent = [
    `Structural result: ${result.structuralPass ? 'PASS' : 'FAIL'}`,
    `Schema valid: ${result.schemaValid ? 'yes' : 'no'}`,
    `Warnings: ${warnings} · Failures: ${failures}`,
    result.summary.generatedAt ? `Generated: ${result.summary.generatedAt}` : null,
    result.summary.routeKind ? `Route: ${result.summary.routeKind}` : null,
    result.summary.adapterState ? `Adapter: ${result.summary.adapterState}` : null,
    result.summary.recordingState ? `Recorder: ${result.summary.recordingState}` : null,
    result.summary.archiveMessageCount !== null ? `Archive messages: ${result.summary.archiveMessageCount}` : null
  ].filter(Boolean).join('\n');
}

input.addEventListener('change', () => {
  const file = input.files?.[0];
  latestMarkdown = null;
  download.disabled = true;
  status.className = 'qa-evidence-status';
  if (!file) {
    status.textContent = 'Choose a llm-chat-history-live-qa JSON file.';
    return;
  }

  status.textContent = 'Validating locally…';
  void file.text()
    .then((text) => JSON.parse(text) as unknown)
    .then((value) => evaluateLiveQaEvidence(value, {
      expectedExtensionVersion: chrome.runtime.getManifest().version
    }))
    .then(renderResult)
    .catch((error: unknown) => {
      latestMarkdown = null;
      download.disabled = true;
      status.className = 'qa-evidence-status fail';
      status.textContent = `Could not validate report: ${error instanceof Error ? error.message : String(error)}`;
    });
});

download.addEventListener('click', () => {
  if (!latestMarkdown) return;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  downloadText(`llm-chat-history-live-qa-summary__${timestamp}.md`, latestMarkdown);
});
