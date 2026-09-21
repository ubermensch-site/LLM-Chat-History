import { ArchiveRepository } from '../storage/archive';
import { openArchiveDb } from '../storage/db';
import type { ArchiveVisibleActivity } from '../storage/schema';

const style = document.createElement('style');
style.textContent = `
  .visible-activity {
    margin-top: 0.7rem;
    padding: 0.08rem 0 0.08rem 0.78rem;
    border: 0;
    border-left: 2px solid color-mix(
      in srgb,
      var(--accent, var(--primary)) 34%,
      var(--border, var(--outline-variant))
    );
    border-radius: 0;
    background: transparent;
  }
  .visible-activity > summary {
    padding: 0.34rem 0;
    cursor: pointer;
    font-size: 0.68rem;
    font-weight: 650;
    color: var(--ink, var(--on-surface));
  }
  .visible-activity > summary:hover {
    color: var(--accent-strong, var(--primary));
  }
  .visible-activity > summary:focus-visible {
    outline: 2px solid color-mix(
      in srgb,
      var(--focus, var(--primary)) 48%,
      transparent
    );
    outline-offset: 3px;
    border-radius: 0.25rem;
  }
  .visible-activity-help {
    margin: 0.16rem 0 0;
    padding: 0 0 0.52rem;
    max-width: 72ch;
    font-size: 0.64rem;
    line-height: 1.5;
    color: var(--ink-muted, var(--on-surface-variant));
  }
  .visible-activity-body {
    display: grid;
    gap: 0.48rem;
    padding: 0.1rem 0 0.35rem;
  }
  .visible-activity-row {
    padding: 0.62rem 0.72rem;
    border-radius: 0.62rem;
    background: var(--surface-quiet, var(--surface));
    border: 1px solid var(--border, var(--outline-variant));
  }
  .visible-activity-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.65rem;
    font-size: 0.64rem;
    color: var(--accent-strong, var(--primary));
  }
  .visible-activity-heading time {
    flex: 0 0 auto;
    font-size: 0.6rem;
    color: var(--ink-subtle, var(--on-surface-variant));
  }
  .visible-activity-text {
    margin-top: 0.36rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 0.72rem;
    line-height: 1.55;
    color: var(--ink, var(--on-surface));
  }
`;

document.head.append(style);

function humanDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function visibleActivityLabel(activity: ArchiveVisibleActivity): string {
  switch (activity.kind) {
    case 'reasoning-summary':
      return 'Visible reasoning summary';
    case 'tool':
      return 'Work step';
    case 'status':
      return 'Status';
    case 'other':
      return 'Visible activity';
  }
}

function selectedConversationId(): string | null {
  return document.querySelector<HTMLButtonElement>('button.conversation.selected')
    ?.dataset.conversationId ?? null;
}

function activitySignature(activities: readonly ArchiveVisibleActivity[]): string {
  return activities
    .map((activity) => [
      activity.providerActivityId,
      activity.kind,
      activity.text,
      activity.firstObservedAt,
      activity.lastObservedAt
    ].join('\u001f'))
    .join('\u001e');
}

function makeActivityRow(activity: ArchiveVisibleActivity): HTMLElement {
  const row = document.createElement('div');
  row.className = 'visible-activity-row';

  const heading = document.createElement('div');
  heading.className = 'visible-activity-heading';

  const label = document.createElement('strong');
  label.textContent = visibleActivityLabel(activity);

  const time = document.createElement('time');
  time.dateTime = activity.firstObservedAt;
  time.textContent = humanDate(activity.firstObservedAt);

  heading.append(label, time);

  const text = document.createElement('div');
  text.className = 'visible-activity-text';
  text.textContent = activity.text;

  row.append(heading, text);
  return row;
}

function renderActivitySection(
  card: HTMLElement,
  activities: readonly ArchiveVisibleActivity[]
): void {
  const existing = card.querySelector<HTMLDetailsElement>('.visible-activity');
  if (!activities.length) {
    existing?.remove();
    return;
  }

  const signature = activitySignature(activities);
  if (existing?.dataset.signature === signature) return;

  const details = existing ?? document.createElement('details');
  details.className = 'visible-activity';
  details.dataset.signature = signature;

  const summary = document.createElement('summary');
  summary.textContent = `What ChatGPT showed while working (${activities.length})`;

  const help = document.createElement('p');
  help.className = 'visible-activity-help';
  help.textContent =
    'These are only the reasoning summaries, work steps and status messages ChatGPT showed on screen. Hidden private reasoning is not available to this extension.';

  const body = document.createElement('div');
  body.className = 'visible-activity-body';
  body.append(...activities.map(makeActivityRow));

  details.replaceChildren(summary, help, body);

  if (!existing) {
    const content = card.querySelector('.content');
    card.insertBefore(details, content ?? null);
  }
}

let databasePromise: Promise<IDBDatabase> | null = null;
let scheduled = false;
let destroyed = false;

async function database(): Promise<IDBDatabase> {
  databasePromise ??= openArchiveDb();
  return databasePromise;
}

async function refreshVisibleActivity(): Promise<void> {
  const conversationId = selectedConversationId();
  const cards = [...document.querySelectorAll<HTMLElement>('#transcript .message')];
  if (!conversationId || cards.length === 0) return;

  try {
    const repository = new ArchiveRepository(await database());
    const messages = await repository.listMessages(conversationId);
    cards.forEach((card, index) => {
      const message = messages[index];
      if (!message || message.role !== 'assistant') {
        card.querySelector('.visible-activity')?.remove();
        return;
      }
      renderActivitySection(card, message.visibleActivities ?? []);
    });
  } catch (error) {
    console.debug('[LLM Chat History] visible activity unavailable in Library', error);
  }
}

function scheduleRefresh(): void {
  if (scheduled || destroyed) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    void refreshVisibleActivity();
  });
}

const observer = new MutationObserver((mutations) => {
  if (
    mutations.every((mutation) =>
      mutation.target instanceof Element && Boolean(mutation.target.closest('.visible-activity'))
    )
  ) {
    return;
  }
  scheduleRefresh();
});
observer.observe(document.body, { childList: true, subtree: true });
scheduleRefresh();

window.addEventListener('pagehide', () => {
  destroyed = true;
  observer.disconnect();
  void databasePromise?.then((db) => db.close());
}, { once: true });
