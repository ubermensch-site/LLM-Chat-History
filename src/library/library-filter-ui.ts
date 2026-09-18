import { ArchiveRepository } from '../storage/archive';
import { openArchiveDb } from '../storage/db';
import { listProjects } from '../storage/projects';
import type { ArchiveConversation, ArchiveProject } from '../storage/schema';
import {
  activeLibraryFilterCount,
  filterFolderLabel,
  filterProjectLabel,
  getLibraryFilters,
  resetLibraryFilters,
  setLibraryFilters,
  subscribeLibraryFilters,
  type LibraryDateFilter,
  type LibraryFilterState,
  type LibrarySort
} from './library-filter-state';
import { providerDisplayName } from './conversation-card';

const MOBILE_BREAKPOINT = '(max-width: 760px)';

function element<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing Library filter element: ${selector}`);
  return node;
}

function option(value: string, label: string): HTMLOptionElement {
  const entry = document.createElement('option');
  entry.value = value;
  entry.textContent = label;
  return entry;
}

const sidebarControls = element<HTMLElement>('.sidebar-controls');
const searchHelp = element<HTMLElement>('.sidebar-search-help');
const media = window.matchMedia(MOBILE_BREAKPOINT);
const dbPromise = openArchiveDb();

let projects: ArchiveProject[] = [];
let conversations: ArchiveConversation[] = [];
let panelOpen = false;
let destroyed = false;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

const toolbar = document.createElement('div');
toolbar.className = 'filter-toolbar';

const toggle = document.createElement('button');
toggle.type = 'button';
toggle.className = 'filter-toggle';
toggle.setAttribute('aria-expanded', 'false');
toggle.setAttribute('aria-controls', 'library-filter-panel');

const toggleLabel = document.createElement('span');
toggleLabel.textContent = 'Filters';

const toggleCount = document.createElement('span');
toggleCount.className = 'filter-toggle-count';
toggleCount.hidden = true;

toggle.append(toggleLabel, toggleCount);

const chips = document.createElement('div');
chips.className = 'filter-chips';
chips.setAttribute('aria-label', 'Active filters');

toolbar.append(toggle, chips);
searchHelp.after(toolbar);

const scrim = document.createElement('button');
scrim.type = 'button';
scrim.className = 'filter-sheet-scrim';
scrim.tabIndex = -1;
scrim.setAttribute('aria-hidden', 'true');
scrim.setAttribute('aria-label', 'Close filters');

const panel = document.createElement('section');
panel.id = 'library-filter-panel';
panel.className = 'filter-panel';
panel.hidden = true;
panel.setAttribute('aria-label', 'Conversation filters');

const panelHeader = document.createElement('div');
panelHeader.className = 'filter-panel-header';

const panelTitle = document.createElement('div');
panelTitle.className = 'filter-panel-title';
panelTitle.textContent = 'Filter conversations';

const closeButton = document.createElement('button');
closeButton.type = 'button';
closeButton.className = 'filter-close';
closeButton.setAttribute('aria-label', 'Close filters');
closeButton.textContent = 'Close';

panelHeader.append(panelTitle, closeButton);

const fields = document.createElement('div');
fields.className = 'filter-fields';

function selectField(labelText: string, id: string): { field: HTMLElement; select: HTMLSelectElement } {
  const field = document.createElement('label');
  field.className = 'filter-field';

  const label = document.createElement('span');
  label.className = 'filter-field-label';
  label.textContent = labelText;

  const select = document.createElement('select');
  select.id = id;
  select.className = 'filter-select';

  field.append(label, select);
  return { field, select };
}

const providerField = selectField('Provider', 'filter-provider');
const dateField = selectField('Updated', 'filter-date');
const projectField = selectField('Project', 'filter-project');
const folderField = selectField('Folder', 'filter-folder');
const tagField = selectField('Tag', 'filter-tag');
const sortField = selectField('Sort', 'filter-sort');

dateField.select.append(
  option('any', 'Any time'),
  option('today', 'Today'),
  option('7d', 'Last 7 days'),
  option('30d', 'Last 30 days'),
  option('90d', 'Last 90 days')
);

sortField.select.append(
  option('relevance', 'Relevance / newest'),
  option('newest', 'Newest first'),
  option('oldest', 'Oldest first'),
  option('title', 'Title A–Z')
);

fields.append(
  providerField.field,
  dateField.field,
  projectField.field,
  folderField.field,
  tagField.field,
  sortField.field
);

const panelActions = document.createElement('div');
panelActions.className = 'filter-panel-actions';

const clearButton = document.createElement('button');
clearButton.type = 'button';
clearButton.className = 'button filter-clear';
clearButton.textContent = 'Clear all';

const doneButton = document.createElement('button');
doneButton.type = 'button';
doneButton.className = 'button primary filter-done';
doneButton.textContent = 'Done';

panelActions.append(clearButton, doneButton);
panel.append(panelHeader, fields, panelActions);
document.body.append(scrim, panel);

const focusableSelector = [
  'button:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

function uniqueTags(): string[] {
  const tags = new Map<string, string>();
  for (const conversation of conversations) {
    for (const raw of conversation.tags ?? []) {
      const tag = raw.trim();
      if (!tag) continue;
      const key = tag.toLocaleLowerCase();
      if (!tags.has(key)) tags.set(key, tag);
    }
  }
  return [...tags.values()].sort((a, b) => a.localeCompare(b));
}

function providerIds(): string[] {
  return [...new Set(conversations.map((conversation) => conversation.providerId))].sort();
}

function compatibleFolders(state: LibraryFilterState): Array<{ id: string; label: string }> {
  const source =
    state.projectId !== 'all' && state.projectId !== 'unsorted'
      ? projects.filter((project) => project.id === state.projectId)
      : projects;

  return source.flatMap((project) =>
    project.folders.map((folder) => ({
      id: folder.id,
      label: source.length === 1 ? folder.name : `${project.name} / ${folder.name}`
    }))
  );
}

function syncSelectOptions(): void {
  const state = getLibraryFilters();

  providerField.select.replaceChildren(
    option('all', 'All providers'),
    ...providerIds().map((providerId) => option(providerId, providerDisplayName(providerId as ArchiveConversation['providerId'])))
  );

  projectField.select.replaceChildren(
    option('all', 'All projects'),
    option('unsorted', 'Unsorted'),
    ...projects.map((project) => option(project.id, project.name))
  );

  const folders = compatibleFolders(state);
  folderField.select.replaceChildren(
    option('all', 'All folders'),
    ...folders.map((folder) => option(folder.id, folder.label))
  );
  folderField.select.disabled = state.projectId === 'unsorted' || folders.length === 0;

  tagField.select.replaceChildren(
    option('all', 'All tags'),
    ...uniqueTags().map((tag) => option(tag, tag))
  );

  providerField.select.value = providerIds().includes(state.providerId) ? state.providerId : 'all';
  dateField.select.value = state.date;
  projectField.select.value =
    state.projectId === 'all' ||
    state.projectId === 'unsorted' ||
    projects.some((project) => project.id === state.projectId)
      ? state.projectId
      : 'all';

  const folderExists = folders.some((folder) => folder.id === state.folderId);
  folderField.select.value = folderExists ? state.folderId : 'all';
  tagField.select.value = uniqueTags().some((tag) => tag.toLocaleLowerCase() === state.tag.toLocaleLowerCase())
    ? state.tag
    : 'all';
  sortField.select.value = state.sort;

  if (state.providerId !== 'all' && providerField.select.value === 'all') {
    setLibraryFilters({ providerId: 'all' });
  }
  if (state.projectId !== 'all' && projectField.select.value === 'all') {
    setLibraryFilters({ projectId: 'all', folderId: 'all' });
  } else if (state.folderId !== 'all' && folderField.select.value === 'all') {
    setLibraryFilters({ folderId: 'all' });
  }
  if (state.tag !== 'all' && tagField.select.value === 'all') {
    setLibraryFilters({ tag: 'all' });
  }
}

function dateLabel(value: LibraryDateFilter): string {
  if (value === 'today') return 'Today';
  if (value === '7d') return 'Last 7 days';
  if (value === '30d') return 'Last 30 days';
  if (value === '90d') return 'Last 90 days';
  return 'Any time';
}

function sortLabel(value: LibrarySort): string {
  if (value === 'newest') return 'Newest first';
  if (value === 'oldest') return 'Oldest first';
  if (value === 'title') return 'Title A–Z';
  return 'Relevance';
}

function chip(text: string, clear: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'filter-chip';
  button.setAttribute('aria-label', `Remove filter: ${text}`);
  button.textContent = `${text} ×`;
  button.addEventListener('click', clear);
  return button;
}

function renderChips(): void {
  const state = getLibraryFilters();
  const nodes: HTMLButtonElement[] = [];

  if (state.providerId !== 'all') {
    nodes.push(
      chip(providerDisplayName(state.providerId as ArchiveConversation['providerId']), () =>
        setLibraryFilters({ providerId: 'all' })
      )
    );
  }
  if (state.date !== 'any') {
    nodes.push(chip(dateLabel(state.date), () => setLibraryFilters({ date: 'any' })));
  }
  if (state.projectId !== 'all') {
    nodes.push(
      chip(filterProjectLabel(state.projectId, projects), () =>
        setLibraryFilters({ projectId: 'all', folderId: 'all' })
      )
    );
  }
  if (state.folderId !== 'all') {
    nodes.push(
      chip(filterFolderLabel(state.folderId, projects), () => setLibraryFilters({ folderId: 'all' }))
    );
  }
  if (state.tag !== 'all') {
    nodes.push(chip(`#${state.tag}`, () => setLibraryFilters({ tag: 'all' })));
  }
  if (state.sort !== 'relevance') {
    nodes.push(chip(sortLabel(state.sort), () => setLibraryFilters({ sort: 'relevance' })));
  }

  chips.replaceChildren(...nodes);
  chips.hidden = nodes.length === 0;

  const activeCount = activeLibraryFilterCount(state);
  toggleCount.textContent = String(activeCount);
  toggleCount.hidden = activeCount === 0;
  toggle.classList.toggle('has-filters', activeCount > 0);
  clearButton.disabled = activeCount === 0 && state.sort === 'relevance';
}

function positionPanel(): void {
  if (media.matches || !panelOpen) {
    panel.style.removeProperty('left');
    panel.style.removeProperty('top');
    return;
  }

  const rect = toggle.getBoundingClientRect();
  const width = Math.min(360, Math.max(300, rect.width + 130));
  const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left));
  const top = Math.min(window.innerHeight - 24, rect.bottom + 8);
  panel.style.width = `${width}px`;
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

function panelFocusableElements(): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(focusableSelector)].filter(
    (node) => !node.hasAttribute('disabled') && node.getClientRects().length > 0
  );
}

function setPanelOpen(open: boolean, restoreFocus = false): void {
  if (open && media.matches) {
    window.dispatchEvent(new Event('llm-library-filter-opening'));
  }
  panelOpen = open;
  panel.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
  scrim.classList.toggle('is-visible', open && media.matches);
  document.body.classList.toggle('mobile-filter-open', open && media.matches);

  if (media.matches) {
    if (open) {
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
    } else {
      panel.removeAttribute('role');
      panel.removeAttribute('aria-modal');
    }
  } else {
    panel.removeAttribute('role');
    panel.removeAttribute('aria-modal');
  }

  if (open) {
    syncSelectOptions();
    renderChips();
    positionPanel();
    window.requestAnimationFrame(() => {
      const target = media.matches ? closeButton : providerField.select;
      target.focus();
    });
  } else {
    panel.style.removeProperty('width');
    panel.style.removeProperty('left');
    panel.style.removeProperty('top');
    if (restoreFocus) {
      if (media.matches) {
        document.querySelector<HTMLButtonElement>('.mobile-nav-button')?.focus();
      } else {
        toggle.focus();
      }
    }
  }
}

async function refreshFilterFacets(): Promise<void> {
  const db = await dbPromise;
  if (destroyed) return;
  const repository = new ArchiveRepository(db);
  [conversations, projects] = await Promise.all([
    repository.listConversations(),
    listProjects(db)
  ]);
  if (destroyed) return;
  syncSelectOptions();
  renderChips();
}

function scheduleRefresh(delay = 80): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refreshFilterFacets().catch((error: unknown) => {
      console.debug('[LLM Chat History] filter facets unavailable', error);
    });
  }, delay);
}

function applySelectChange(): void {
  const projectId = projectField.select.value;
  const folders = compatibleFolders({ ...getLibraryFilters(), projectId });
  const currentFolder = folderField.select.value;
  const folderId =
    projectId === 'unsorted' || !folders.some((folder) => folder.id === currentFolder)
      ? 'all'
      : currentFolder;

  setLibraryFilters({
    providerId: providerField.select.value,
    date: dateField.select.value as LibraryDateFilter,
    projectId,
    folderId,
    tag: tagField.select.value,
    sort: sortField.select.value as LibrarySort
  });
}

toggle.addEventListener('click', () => setPanelOpen(!panelOpen));
closeButton.addEventListener('click', () => setPanelOpen(false, true));
doneButton.addEventListener('click', () => setPanelOpen(false, true));
scrim.addEventListener('click', () => setPanelOpen(false, true));
clearButton.addEventListener('click', () => resetLibraryFilters());

for (const select of [
  providerField.select,
  dateField.select,
  projectField.select,
  folderField.select,
  tagField.select,
  sortField.select
]) {
  select.addEventListener('change', () => {
    applySelectChange();
    syncSelectOptions();
  });
}

const unsubscribe = subscribeLibraryFilters(() => {
  syncSelectOptions();
  renderChips();
});

const onKeydown = (event: KeyboardEvent) => {
  if (!panelOpen) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    setPanelOpen(false, true);
    return;
  }

  if (!media.matches || event.key !== 'Tab') return;
  const focusable = panelFocusableElements();
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;

  if (event.shiftKey && active === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first?.focus();
  }
};

const onPointerDown = (event: PointerEvent) => {
  if (!panelOpen || media.matches) return;
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (!panel.contains(target) && !toggle.contains(target)) setPanelOpen(false);
};

const onViewportChange = () => {
  if (!panelOpen) return;
  setPanelOpen(false);
};

const onMediaChange = () => {
  if (panelOpen) {
    panel.removeAttribute('role');
    panel.removeAttribute('aria-modal');
    scrim.classList.remove('is-visible');
    document.body.classList.remove('mobile-filter-open');
    setPanelOpen(false);
  }
};

const listObserver = new MutationObserver(() => scheduleRefresh());
const conversationList = document.getElementById('conversation-list');
if (conversationList) listObserver.observe(conversationList, { childList: true });

window.addEventListener('keydown', onKeydown, true);
window.addEventListener('pointerdown', onPointerDown, true);
window.addEventListener('resize', onViewportChange);
media.addEventListener('change', onMediaChange);

renderChips();
scheduleRefresh(0);

window.addEventListener(
  'pagehide',
  () => {
    destroyed = true;
    unsubscribe();
    listObserver.disconnect();
    if (refreshTimer) clearTimeout(refreshTimer);
    window.removeEventListener('keydown', onKeydown, true);
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('resize', onViewportChange);
    media.removeEventListener('change', onMediaChange);
    void dbPromise.then((db) => db.close());
  },
  { once: true }
);
