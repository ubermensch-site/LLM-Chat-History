import { ArchiveRepository } from '../storage/archive';
import { listCheckpoints } from '../storage/checkpoints';
import { openArchiveDb } from '../storage/db';
import { listProjects } from '../storage/projects';
import type { ArchiveProject } from '../storage/schema';
import {
  buildNavigationFacets,
  getLibraryNavigationScope,
  navigationSection,
  setLibraryNavigationScope,
  subscribeLibraryNavigation,
  type LibraryNavigationFacets,
  type LibraryNavigationScope,
  type LibraryNavigationSection,
  type NavigationCountItem
} from './library-navigation-state';
import type { LibraryRecord } from './search';

function element<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing Library navigation element: ${selector}`);
  return node;
}

const sidebarControls = element<HTMLElement>('.sidebar-controls');
const conversationList = element<HTMLElement>('#conversation-list');

const nav = document.createElement('nav');
nav.className = 'library-nav';
nav.setAttribute('aria-label', 'Browse saved conversations');

const browseLabel = document.createElement('div');
browseLabel.className = 'library-nav-label';
browseLabel.textContent = 'Browse';

const organizeLabel = document.createElement('div');
organizeLabel.className = 'library-nav-label';
organizeLabel.textContent = 'Organize';

const detail = document.createElement('section');
detail.className = 'library-nav-detail';
detail.hidden = true;
detail.setAttribute('aria-live', 'polite');

type NavigationButton = HTMLButtonElement & { dataset: DOMStringMap & { section?: string } };
const buttons = new Map<LibraryNavigationSection, NavigationButton>();

function navButton(section: LibraryNavigationSection, label: string): NavigationButton {
  const button = document.createElement('button') as NavigationButton;
  button.type = 'button';
  button.className = 'library-nav-item';
  button.dataset.section = section;

  const text = document.createElement('span');
  text.className = 'library-nav-item-label';
  text.textContent = label;

  const count = document.createElement('span');
  count.className = 'library-nav-count';
  count.setAttribute('aria-hidden', 'true');

  button.append(text, count);
  buttons.set(section, button);
  return button;
}

const libraryButton = navButton('library', 'Library');
const recentButton = navButton('recent', 'Recent');
const projectsButton = navButton('projects', 'Projects');
const foldersButton = navButton('folders', 'Folders');
const tagsButton = navButton('tags', 'Tags');
const checkpointsButton = navButton('checkpoints', 'Checkpoints');
const archivedButton = navButton('archived', 'Archived');

nav.append(
  browseLabel,
  libraryButton,
  recentButton,
  organizeLabel,
  projectsButton,
  foldersButton,
  tagsButton,
  checkpointsButton,
  archivedButton,
  detail
);
sidebarControls.before(nav);

const dbPromise = openArchiveDb();
let destroyed = false;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let activeSection: LibraryNavigationSection = navigationSection(getLibraryNavigationScope());
let facets: LibraryNavigationFacets = {
  projects: [],
  unsortedCount: 0,
  folders: [],
  tags: [],
  checkpointCount: 0
};
let projects: ArchiveProject[] = [];
let activeConversationCount = 0;
let archivedConversationCount = 0;

function countElement(section: LibraryNavigationSection): HTMLElement | null {
  return buttons.get(section)?.querySelector<HTMLElement>('.library-nav-count') ?? null;
}

function setCount(section: LibraryNavigationSection, value: number | null): void {
  const target = countElement(section);
  if (!target) return;
  target.textContent = value === null ? '' : String(value);
}

function selectedButton(section: LibraryNavigationSection): void {
  for (const [key, button] of buttons) {
    const selected = key === section;
    button.classList.toggle('selected', selected);
    if (selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}

function setScope(scope: LibraryNavigationScope): void {
  setLibraryNavigationScope(scope);
  activeSection = navigationSection(scope);
  selectedButton(activeSection);
  renderDetail();
}

function detailItem(
  item: NavigationCountItem,
  action: () => void,
  selected = false
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `library-nav-detail-item${selected ? ' selected' : ''}`;

  const name = document.createElement('span');
  name.className = 'library-nav-detail-name';
  name.textContent = item.name;

  const count = document.createElement('span');
  count.className = 'library-nav-detail-count';
  count.textContent = String(item.count);

  button.append(name, count);
  button.addEventListener('click', action);
  return button;
}

function emptyDetail(message: string): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'library-nav-detail-empty';
  empty.textContent = message;
  return empty;
}

function renderDetail(): void {
  detail.replaceChildren();

  if (!['projects', 'folders', 'tags'].includes(activeSection)) {
    detail.hidden = true;
    return;
  }

  detail.hidden = false;
  const heading = document.createElement('div');
  heading.className = 'library-nav-detail-title';
  heading.textContent =
    activeSection === 'projects'
      ? 'Choose a project'
      : activeSection === 'folders'
        ? 'Choose a folder'
        : 'Choose a tag';
  detail.append(heading);

  const current = getLibraryNavigationScope();

  if (activeSection === 'projects') {
    detail.append(
      detailItem(
        { id: 'unsorted', name: 'Unsorted', count: facets.unsortedCount },
        () => setScope({ kind: 'unsorted' }),
        current.kind === 'unsorted'
      )
    );
    for (const project of facets.projects) {
      detail.append(
        detailItem(
          project,
          () => setScope({ kind: 'project', projectId: project.id }),
          current.kind === 'project' && current.projectId === project.id
        )
      );
    }
    if (!facets.projects.length && facets.unsortedCount === 0) {
      detail.append(emptyDetail('No projects yet.'));
    }
    return;
  }

  if (activeSection === 'folders') {
    if (!facets.folders.length) {
      detail.append(emptyDetail('No folders yet.'));
      return;
    }
    for (const folder of facets.folders) {
      const projectId = folder.projectId;
      if (!projectId) continue;
      detail.append(
        detailItem(
          folder,
          () => setScope({ kind: 'folder', projectId, folderId: folder.id }),
          current.kind === 'folder' &&
            current.projectId === projectId &&
            current.folderId === folder.id
        )
      );
    }
    return;
  }

  if (!facets.tags.length) {
    detail.append(emptyDetail('No tags yet.'));
    return;
  }
  for (const tag of facets.tags) {
    detail.append(
      detailItem(
        tag,
        () => setScope({ kind: 'tag', tag: tag.name }),
        current.kind === 'tag' && current.tag.toLocaleLowerCase() === tag.name.toLocaleLowerCase()
      )
    );
  }
}

function updateCounts(): void {
  setCount('library', activeConversationCount);
  setCount('recent', activeConversationCount);
  setCount('projects', facets.projects.length + (facets.unsortedCount ? 1 : 0));
  setCount('folders', facets.folders.length);
  setCount('tags', facets.tags.length);
  setCount('checkpoints', facets.checkpointCount);
  setCount('archived', archivedConversationCount);
}

async function loadNavigationData(): Promise<void> {
  const database = await dbPromise;
  if (destroyed) return;

  const repository = new ArchiveRepository(database);
  const [conversations, loadedProjects] = await Promise.all([
    repository.listConversations(),
    listProjects(database)
  ]);
  if (destroyed) return;

  const projectMap = new Map(loadedProjects.map((project) => [project.id, project] as const));
  const records = await Promise.all(
    conversations.map(async (conversation): Promise<LibraryRecord> => ({
      conversation,
      messages: [],
      project: conversation.projectId ? projectMap.get(conversation.projectId) : undefined,
      checkpoints: await listCheckpoints(database, conversation.id)
    }))
  );
  if (destroyed) return;

  projects = loadedProjects;
  facets = buildNavigationFacets(records, projects);
  activeConversationCount = records.filter((record) => !record.conversation.archivedAt).length;
  archivedConversationCount = records.length - activeConversationCount;
  updateCounts();
  renderDetail();
}

function scheduleRefresh(delay = 80): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void loadNavigationData().catch((error: unknown) => {
      console.debug('[LLM Chat History] navigation facets unavailable', error);
    });
  }, delay);
}

function openSection(section: LibraryNavigationSection): void {
  activeSection = section;
  selectedButton(section);

  if (section === 'library') {
    setScope({ kind: 'library' });
    return;
  }
  if (section === 'recent') {
    setScope({ kind: 'recent' });
    return;
  }
  if (section === 'archived') {
    setScope({ kind: 'archived' });
    return;
  }
  if (section === 'checkpoints') {
    setScope({ kind: 'checkpoints' });
    return;
  }

  renderDetail();
}

for (const [section, button] of buttons) {
  button.addEventListener('click', () => openSection(section));
}

const unsubscribe = subscribeLibraryNavigation((scope) => {
  activeSection = navigationSection(scope);
  selectedButton(activeSection);
  renderDetail();
});

const listObserver = new MutationObserver(() => scheduleRefresh());
listObserver.observe(conversationList, { childList: true });

selectedButton(activeSection);
scheduleRefresh(0);

window.addEventListener(
  'pagehide',
  () => {
    destroyed = true;
    unsubscribe();
    listObserver.disconnect();
    if (refreshTimer) clearTimeout(refreshTimer);
    void dbPromise.then((database) => database.close());
  },
  { once: true }
);
