import { ArchiveRepository } from '../storage/archive';
import { openArchiveDb } from '../storage/db';
import { listProjects } from '../storage/projects';
import type { ArchiveProject } from '../storage/schema';
import { searchLibraryRecords, type LibrarySearchResult } from './full-text-search';
import type { LibraryRecord } from './search';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing Library search element: ${id}`);
  return element as T;
}

const searchInput = byId<HTMLInputElement>('search');
const projectFilter = byId<HTMLSelectElement>('project-filter');
const viewArchived = byId<HTMLButtonElement>('view-archived');
const list = byId<HTMLDivElement>('conversation-list');
const count = byId<HTMLDivElement>('count');
const transcript = byId<HTMLElement>('transcript');

const resultPanel = document.createElement('section');
resultPanel.id = 'search-results';
resultPanel.className = 'search-results';
resultPanel.hidden = true;
resultPanel.setAttribute('aria-live', 'polite');
resultPanel.setAttribute('aria-label', 'Search results');
list.before(resultPanel);

const style = document.createElement('style');
style.textContent = `
  .search-results { display: grid; gap: 6px; margin: 6px 0 10px; }
  .search-result { width: 100%; text-align: left; border: 1px solid var(--outline-variant); border-radius: 14px; padding: 10px 12px; background: var(--surface); color: var(--on-surface); cursor: pointer; }
  .search-result:hover { background: var(--surface-container-high); }
  .search-result:focus-visible { outline: 3px solid color-mix(in srgb, var(--primary) 45%, transparent); outline-offset: 2px; }
  .search-result-title { display: block; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .search-result-meta { display: block; margin-top: 3px; font-size: 11px; color: var(--on-surface-variant); text-transform: capitalize; }
  .search-result-snippet { display: block; margin-top: 5px; font-size: 12px; line-height: 1.35; color: var(--on-surface-variant); overflow-wrap: anywhere; }
  .search-result-empty { padding: 10px; font-size: 12px; color: var(--on-surface-variant); }
  .message.search-hit { outline: 3px solid var(--primary); outline-offset: 3px; }
`;
document.head.append(style);

let renderTimer: ReturnType<typeof setTimeout> | null = null;
const dbPromise = openArchiveDb();

function activeProjectId(): string {
  return projectFilter.value;
}

function showingArchived(): boolean {
  return viewArchived.getAttribute('aria-pressed') === 'true';
}

function belongsToCurrentFilters(record: LibraryRecord): boolean {
  const archived = Boolean(record.conversation.archivedAt);
  if (archived !== showingArchived()) return false;

  const projectId = activeProjectId();
  if (projectId === 'all') return true;
  if (projectId === 'unsorted') return !record.conversation.projectId;
  return record.conversation.projectId === projectId;
}

async function loadRecords(): Promise<LibraryRecord[]> {
  const db = await dbPromise;
  const repository = new ArchiveRepository(db);
  const [conversations, projects] = await Promise.all([
    repository.listConversations(),
    listProjects(db)
  ]);
  const projectMap = new Map<string, ArchiveProject>(
    projects.map((project) => [project.id, project] as const)
  );

  return Promise.all(
    conversations.map(async (conversation): Promise<LibraryRecord> => ({
      conversation,
      messages: await repository.listMessages(conversation.id),
      project: conversation.projectId ? projectMap.get(conversation.projectId) : undefined
    }))
  );
}

function conversationButton(conversationId: string): HTMLButtonElement | undefined {
  return [...list.querySelectorAll<HTMLButtonElement>('button[data-conversation-id]')].find(
    (button) => button.dataset.conversationId === conversationId
  );
}

async function focusMessage(conversationId: string, messageId: string): Promise<void> {
  const db = await dbPromise;
  const repository = new ArchiveRepository(db);
  const messages = await repository.listMessages(conversationId);
  const index = messages.findIndex((message) => message.id === messageId);
  if (index < 0) return;

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const cards = transcript.querySelectorAll<HTMLElement>('.message');
  const card = cards[index];
  if (!card) return;

  for (const existing of transcript.querySelectorAll<HTMLElement>('.message.search-hit')) {
    existing.classList.remove('search-hit');
  }
  card.classList.add('search-hit');
  card.tabIndex = -1;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.focus({ preventScroll: true });
  setTimeout(() => card.classList.remove('search-hit'), 4_000);
}

async function openResult(result: LibrarySearchResult): Promise<void> {
  const button = conversationButton(result.conversationId);
  if (!button) return;
  button.click();
  if (result.kind === 'message' && result.messageId) {
    await focusMessage(result.conversationId, result.messageId);
  }
}

function resultButton(result: LibrarySearchResult): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'search-result';

  const title = document.createElement('span');
  title.className = 'search-result-title';
  title.textContent = result.title;

  const meta = document.createElement('span');
  meta.className = 'search-result-meta';
  meta.textContent = result.kind === 'message' ? 'Message match' : `${result.field} match`;

  const snippet = document.createElement('span');
  snippet.className = 'search-result-snippet';
  snippet.textContent = result.snippet || '(matching archived conversation)';

  button.append(title, meta, snippet);
  button.addEventListener('click', () => {
    void openResult(result);
  });
  return button;
}

async function renderSearchResults(): Promise<void> {
  const query = searchInput.value.trim();
  if (!query) {
    resultPanel.hidden = true;
    resultPanel.replaceChildren();
    list.hidden = false;
    return;
  }

  try {
    const records = (await loadRecords()).filter(belongsToCurrentFilters);
    const results = searchLibraryRecords(records, query).slice(0, 100);
    resultPanel.hidden = false;
    list.hidden = true;

    if (!results.length) {
      const empty = document.createElement('div');
      empty.className = 'search-result-empty';
      empty.textContent = 'No matching conversations or turns in this view.';
      resultPanel.replaceChildren(empty);
      count.textContent = `0 search results · ${records.length} conversations in this view`;
      return;
    }

    resultPanel.replaceChildren(...results.map(resultButton));
    const messageCount = results.filter((result) => result.kind === 'message').length;
    count.textContent = `${results.length} search results · ${messageCount} turn matches`;
  } catch (error) {
    console.error('[LLM Chat History] full-text search failed', error);
    resultPanel.hidden = false;
    list.hidden = true;
    const empty = document.createElement('div');
    empty.className = 'search-result-empty';
    empty.textContent = error instanceof Error ? `Search unavailable: ${error.message}` : 'Search unavailable.';
    resultPanel.replaceChildren(empty);
  }
}

function scheduleRender(delay = 0): void {
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    renderTimer = null;
    void renderSearchResults();
  }, delay);
}

searchInput.addEventListener('input', () => scheduleRender(40));
projectFilter.addEventListener('change', () => scheduleRender(0));
byId<HTMLButtonElement>('view-active').addEventListener('click', () => scheduleRender(50));
viewArchived.addEventListener('click', () => scheduleRender(50));

const listObserver = new MutationObserver(() => {
  if (searchInput.value.trim()) scheduleRender(20);
});
listObserver.observe(list, { childList: true });
