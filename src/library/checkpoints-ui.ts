import {
  createCheckpoint,
  deleteCheckpoint,
  listCheckpoints,
  updateCheckpoint,
  type ArchiveCheckpoint
} from '../storage/checkpoints';
import { openArchiveDb } from '../storage/db';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing Library checkpoint element: ${id}`);
  return element as T;
}

const conversationList = byId<HTMLDivElement>('conversation-list');
const transcript = byId<HTMLElement>('transcript');
const libraryStatus = byId<HTMLParagraphElement>('library-status');
const actions = document.querySelector<HTMLElement>('.actions');
if (!actions) throw new Error('Missing Library actions container');

const addCheckpointButton = document.createElement('button');
addCheckpointButton.id = 'add-checkpoint';
addCheckpointButton.className = 'button';
addCheckpointButton.type = 'button';
addCheckpointButton.textContent = 'Add checkpoint';
addCheckpointButton.disabled = true;
actions.prepend(addCheckpointButton);

const style = document.createElement('style');
style.textContent = `
  .checkpoint-marker { margin: 0 0 18px; padding: 12px 14px; border: 1px solid color-mix(in srgb, var(--primary) 45%, var(--outline-variant)); border-radius: 14px; background: color-mix(in srgb, var(--primary) 8%, var(--surface)); }
  .checkpoint-marker-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .checkpoint-marker-name { font-weight: 750; color: var(--primary); }
  .checkpoint-marker-time { font-size: 11px; color: var(--on-surface-variant); }
  .checkpoint-marker-note { margin-top: 6px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--on-surface-variant); line-height: 1.45; }
  .checkpoint-marker-actions { margin-left: auto; display: flex; gap: 4px; }
  .checkpoint-mini { border: 0; background: transparent; color: var(--on-surface-variant); cursor: pointer; font: inherit; font-size: 11px; padding: 4px 6px; border-radius: 8px; }
  .checkpoint-mini:hover { background: var(--surface-container-high); }
  .checkpoint-mini.danger { color: var(--error); }
`;
document.head.append(style);

const dbPromise = openArchiveDb();
let renderTimer: ReturnType<typeof setTimeout> | null = null;
let renderSequence = 0;

function selectedConversationId(): string | null {
  return (
    conversationList.querySelector<HTMLButtonElement>('button.conversation.selected[data-conversation-id]')
      ?.dataset.conversationId ?? null
  );
}

function setStatus(message: string, error = false): void {
  libraryStatus.textContent = message;
  libraryStatus.classList.toggle('error', error);
}

function humanDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

async function editCheckpoint(checkpoint: ArchiveCheckpoint): Promise<void> {
  const nextName = window.prompt('Checkpoint name', checkpoint.name);
  if (nextName === null) return;
  const nextNote = window.prompt('Optional checkpoint note', checkpoint.note ?? '');
  if (nextNote === null) return;
  try {
    const db = await dbPromise;
    await updateCheckpoint(db, checkpoint.id, nextName, nextNote || null);
    setStatus(`Updated checkpoint “${nextName.trim()}”.`);
    scheduleRender();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
}

async function removeCheckpoint(checkpoint: ArchiveCheckpoint): Promise<void> {
  if (!window.confirm(`Delete checkpoint “${checkpoint.name}”? The chat itself will not be changed.`)) {
    return;
  }
  try {
    const db = await dbPromise;
    await deleteCheckpoint(db, checkpoint.id);
    setStatus(`Deleted checkpoint “${checkpoint.name}”.`);
    scheduleRender();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
}

function marker(checkpoint: ArchiveCheckpoint): HTMLElement {
  const article = document.createElement('article');
  article.className = 'checkpoint-marker';
  article.dataset.checkpointId = checkpoint.id;

  const head = document.createElement('div');
  head.className = 'checkpoint-marker-head';

  const name = document.createElement('span');
  name.className = 'checkpoint-marker-name';
  name.textContent = `Checkpoint · ${checkpoint.name}`;

  const time = document.createElement('time');
  time.className = 'checkpoint-marker-time';
  time.dateTime = checkpoint.createdAt;
  time.textContent = humanDate(checkpoint.createdAt);

  const markerActions = document.createElement('span');
  markerActions.className = 'checkpoint-marker-actions';
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'checkpoint-mini';
  edit.textContent = 'Edit';
  edit.addEventListener('click', () => void editCheckpoint(checkpoint));
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'checkpoint-mini danger';
  remove.textContent = 'Delete';
  remove.addEventListener('click', () => void removeCheckpoint(checkpoint));
  markerActions.append(edit, remove);
  head.append(name, time, markerActions);
  article.append(head);

  if (checkpoint.note) {
    const note = document.createElement('div');
    note.className = 'checkpoint-marker-note';
    note.textContent = checkpoint.note;
    article.append(note);
  }
  return article;
}

function placeMarker(checkpoint: ArchiveCheckpoint, element: HTMLElement): void {
  const messageCards = [...transcript.querySelectorAll<HTMLElement>('.message')];
  const nextMessage = messageCards.find((card) => {
    const time = card.querySelector<HTMLTimeElement>('time[datetime]')?.dateTime;
    return Boolean(time && time >= checkpoint.createdAt);
  });
  if (nextMessage) transcript.insertBefore(element, nextMessage);
  else transcript.append(element);
}

async function renderCheckpoints(): Promise<void> {
  const sequence = ++renderSequence;
  const conversationId = selectedConversationId();
  addCheckpointButton.disabled = !conversationId;
  for (const existing of transcript.querySelectorAll('.checkpoint-marker')) existing.remove();
  if (!conversationId) return;

  try {
    const db = await dbPromise;
    const checkpoints = await listCheckpoints(db, conversationId);
    if (sequence !== renderSequence || selectedConversationId() !== conversationId) return;
    for (const checkpoint of checkpoints) placeMarker(checkpoint, marker(checkpoint));
  } catch (error) {
    console.error('[LLM Chat History] checkpoint timeline failed', error);
  }
}

function scheduleRender(delay = 0): void {
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    renderTimer = null;
    void renderCheckpoints();
  }, delay);
}

addCheckpointButton.addEventListener('click', () => {
  const conversationId = selectedConversationId();
  if (!conversationId) return;
  const name = window.prompt('Checkpoint name');
  if (name === null) return;
  const note = window.prompt('Optional checkpoint note');
  if (note === null) return;
  void dbPromise
    .then((db) => createCheckpoint(db, conversationId, name, note || null))
    .then((checkpoint) => {
      setStatus(`Created checkpoint “${checkpoint.name}”.`);
      scheduleRender();
    })
    .catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : String(error), true);
    });
});

conversationList.addEventListener('click', () => scheduleRender(30), true);
const listObserver = new MutationObserver(() => scheduleRender(30));
listObserver.observe(conversationList, { childList: true });
scheduleRender(100);
