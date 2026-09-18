import { exportFilename, renderJsonExport, renderMarkdownExport } from '../export/export';
import { parseJsonArchiveExport } from '../import/json-import';
import { ArchiveRepository } from '../storage/archive';
import { listCheckpoints } from '../storage/checkpoints';
import { conversationDisplayTitle } from '../storage/conversation';
import { openArchiveDb } from '../storage/db';
import { importArchiveBundle } from '../storage/import';
import {
  deleteConversationCascade,
  renameConversation,
  setConversationArchived
} from '../storage/library-management';
import {
  addProjectFolder,
  assignConversationOrganization,
  createProject,
  deleteProject,
  deleteProjectFolder,
  listProjects,
  renameProject,
  renameProjectFolder,
  setConversationTags
} from '../storage/projects';
import type {
  ArchiveConversation,
  ArchiveMessage,
  ArchiveProject,
  ArchiveProjectFolder
} from '../storage/schema';
import {
  getLibraryNavigationScope,
  navigationScopeProjectId,
  navigationScopeTitle,
  recordMatchesNavigationScope,
  setLibraryNavigationScope,
  subscribeLibraryNavigation,
  type LibraryNavigationScope
} from './library-navigation-state';
import { requestMirrorRefresh, requestMirrorRefreshes } from './mirror-refresh';
import { filterLibraryRecords, type LibraryRecord } from './search';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing library element: ${id}`);
  return element as T;
}

function humanDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function downloadText(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function option(value: string, label: string): HTMLOptionElement {
  const entry = document.createElement('option');
  entry.value = value;
  entry.textContent = label;
  return entry;
}

const searchInput = byId<HTMLInputElement>('search');
const projectFilter = byId<HTMLSelectElement>('project-filter');
const count = byId<HTMLDivElement>('count');
const list = byId<HTMLDivElement>('conversation-list');
const title = byId<HTMLHeadingElement>('title');
const meta = byId<HTMLParagraphElement>('meta');
const transcript = byId<HTMLElement>('transcript');
const downloadMarkdown = byId<HTMLButtonElement>('download-md');
const downloadJson = byId<HTMLButtonElement>('download-json');
const importJson = byId<HTMLButtonElement>('import-json');
const importFile = byId<HTMLInputElement>('import-file');
const libraryStatus = byId<HTMLParagraphElement>('library-status');
const viewActive = byId<HTMLButtonElement>('view-active');
const viewArchived = byId<HTMLButtonElement>('view-archived');
const renameButton = byId<HTMLButtonElement>('rename-chat');
const archiveButton = byId<HTMLButtonElement>('archive-chat');
const deleteButton = byId<HTMLButtonElement>('delete-chat');
const projectSelect = byId<HTMLSelectElement>('project-select');
const folderSelect = byId<HTMLSelectElement>('folder-select');
const tagsInput = byId<HTMLInputElement>('tags-input');
const saveTagsButton = byId<HTMLButtonElement>('save-tags');
const newProjectButton = byId<HTMLButtonElement>('new-project');
const renameProjectButton = byId<HTMLButtonElement>('rename-project');
const deleteProjectButton = byId<HTMLButtonElement>('delete-project');
const newFolderButton = byId<HTMLButtonElement>('new-folder');
const renameFolderButton = byId<HTMLButtonElement>('rename-folder');
const deleteFolderButton = byId<HTMLButtonElement>('delete-folder');

let database: IDBDatabase;
let repository: ArchiveRepository;
let records: LibraryRecord[] = [];
let projects: ArchiveProject[] = [];
let selectedConversationId: string | null = null;
let showingArchived = false;
let projectFilterId = 'all';
let libraryReady = false;
let suppressNavigationReload = false;
let deleteDeadlineMs: number | null = null;
let deleteResetTimer: ReturnType<typeof setTimeout> | null = null;

function selectedRecord(): LibraryRecord | undefined {
  return records.find((record) => record.conversation.id === selectedConversationId);
}

function projectById(projectId: string | undefined): ArchiveProject | undefined {
  return projectId ? projects.find((project) => project.id === projectId) : undefined;
}

function folderById(
  project: ArchiveProject | undefined,
  folderId: string | undefined
): ArchiveProjectFolder | undefined {
  return folderId ? project?.folders.find((folder) => folder.id === folderId) : undefined;
}

function applyNavigationScope(scope: LibraryNavigationScope): void {
  showingArchived = scope.kind === 'archived';
  projectFilterId = navigationScopeProjectId(scope);
}

function setNavigationScopeWithoutReload(scope: LibraryNavigationScope): void {
  suppressNavigationReload = true;
  try {
    const changed = setLibraryNavigationScope(scope);
    if (!changed) applyNavigationScope(scope);
  } finally {
    suppressNavigationReload = false;
  }
}

function recordBelongsInCurrentView(record: LibraryRecord): boolean {
  return recordMatchesNavigationScope(record, getLibraryNavigationScope());
}

applyNavigationScope(getLibraryNavigationScope());

const unsubscribeNavigation = subscribeLibraryNavigation((scope) => {
  applyNavigationScope(scope);
  resetDeleteConfirmation();
  if (libraryReady && !suppressNavigationReload) void loadRecords(null);
});

function recordsInCurrentView(): LibraryRecord[] {
  return records.filter(recordBelongsInCurrentView);
}

function setLibraryStatus(message: string, error = false): void {
  libraryStatus.textContent = message;
  libraryStatus.classList.toggle('error', error);
}

function resetDeleteConfirmation(): void {
  deleteDeadlineMs = null;
  if (deleteResetTimer) clearTimeout(deleteResetTimer);
  deleteResetTimer = null;
  renderManagementActions();
}

function deleteIsArmed(now = Date.now()): boolean {
  return deleteDeadlineMs !== null && now <= deleteDeadlineMs;
}

function setEmptyTranscript(message: string): void {
  transcript.replaceChildren();
  const empty = document.createElement('div');
  empty.className = 'empty';
  empty.textContent = message;
  transcript.append(empty);
}

function renderProjectFilter(): void {
  const validProject = projects.some((project) => project.id === projectFilterId);
  if (projectFilterId !== 'all' && projectFilterId !== 'unsorted' && !validProject) {
    projectFilterId = 'all';
  }
  projectFilter.replaceChildren(
    option('all', 'All projects'),
    option('unsorted', 'Unsorted'),
    ...projects.map((project) => option(project.id, project.name))
  );
  projectFilter.value = projectFilterId;
}

function renderOrganizationControls(): void {
  const record = selectedRecord();
  const conversation = record?.conversation;
  const selectedProject = projectById(conversation?.projectId);
  const selectedFolder = folderById(selectedProject, conversation?.folderId);

  projectSelect.replaceChildren(
    option('', 'Unsorted'),
    ...projects.map((project) => option(project.id, project.name))
  );
  projectSelect.value = selectedProject?.id ?? '';
  projectSelect.disabled = !record;

  folderSelect.replaceChildren(
    option('', 'No folder'),
    ...(selectedProject?.folders.map((folder) => option(folder.id, folder.name)) ?? [])
  );
  folderSelect.value = selectedFolder?.id ?? '';
  folderSelect.disabled = !record || !selectedProject;

  tagsInput.value = conversation?.tags?.join(', ') ?? '';
  tagsInput.disabled = !record;
  saveTagsButton.disabled = !record;

  newProjectButton.disabled = !libraryReady;
  renameProjectButton.disabled = !selectedProject;
  deleteProjectButton.disabled = !selectedProject;
  newFolderButton.disabled = !selectedProject;
  renameFolderButton.disabled = !selectedProject || !selectedFolder;
  deleteFolderButton.disabled = !selectedProject || !selectedFolder;
}

function renderManagementActions(): void {
  const record = selectedRecord();
  const disabled = !record;
  renameButton.disabled = disabled;
  archiveButton.disabled = disabled;
  deleteButton.disabled = disabled;
  downloadMarkdown.disabled = disabled;
  downloadJson.disabled = disabled;
  archiveButton.textContent = record?.conversation.archivedAt ? 'Unarchive' : 'Archive';
  deleteButton.textContent = deleteIsArmed() ? 'Confirm delete' : 'Delete';
  deleteButton.classList.toggle('danger-armed', deleteIsArmed());
  renderOrganizationControls();
}

function renderTranscript(record: LibraryRecord): void {
  const conversation = record.conversation;
  const project = record.project;
  const folder = folderById(project, conversation.folderId);
  const organization = [
    project?.name ?? 'Unsorted',
    folder?.name,
    ...(conversation.tags ?? []).map((tag) => `#${tag}`)
  ]
    .filter(Boolean)
    .join(' · ');
  title.textContent = conversationDisplayTitle(conversation);
  const archived = conversation.archivedAt ? ` · Archived ${humanDate(conversation.archivedAt)}` : '';
  meta.textContent = `${conversation.providerId} · ${conversation.messageCount} messages · ${conversation.recordingState} · ${organization} · Last captured ${humanDate(conversation.lastObservedAt)}${archived}`;
  transcript.replaceChildren();
  renderManagementActions();

  if (record.messages.length === 0) {
    setEmptyTranscript('No captured turns are stored for this conversation yet.');
    return;
  }

  for (const message of record.messages) {
    const card = document.createElement('article');
    card.className = `message ${message.role}`;

    const role = document.createElement('span');
    role.className = 'role';
    role.textContent = message.role === 'user' ? 'User' : 'Assistant';

    const time = document.createElement('time');
    time.className = 'time';
    time.dateTime = message.firstObservedAt;
    time.textContent = humanDate(message.firstObservedAt);

    const content = document.createElement('div');
    content.className = 'content';
    content.textContent = message.plainText || '(empty rendered message)';

    card.append(role, time, content);

    if (message.partial) {
      const partial = document.createElement('div');
      partial.className = 'partial';
      partial.textContent = 'Partial capture';
      card.append(partial);
    }

    transcript.append(card);
  }
}

function clearSelection(message: string): void {
  selectedConversationId = null;
  title.textContent = navigationScopeTitle(getLibraryNavigationScope(), projects);
  meta.textContent = message;
  renderManagementActions();
  setEmptyTranscript(message);
}

function selectConversation(id: string): void {
  selectedConversationId = id;
  resetDeleteConfirmation();
  renderConversationList();
  const record = selectedRecord();
  if (record) renderTranscript(record);
}

function conversationButton(record: LibraryRecord): HTMLButtonElement {
  const conversation = record.conversation;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `conversation${conversation.id === selectedConversationId ? ' selected' : ''}`;
  button.dataset.conversationId = conversation.id;

  const name = document.createElement('span');
  name.className = 'conversation-title';
  name.textContent = conversationDisplayTitle(conversation);

  const folder = folderById(record.project, conversation.folderId);
  const location = folder ? `${record.project?.name} / ${folder.name}` : record.project?.name ?? 'Unsorted';
  const details = document.createElement('span');
  details.className = 'conversation-meta';
  details.textContent = `${location} · ${conversation.messageCount} messages · ${humanDate(conversation.updatedAt)}`;

  button.append(name, details);
  button.addEventListener('click', () => selectConversation(conversation.id));
  return button;
}

function renderConversationList(): void {
  const inView = recordsInCurrentView();
  const visible = filterLibraryRecords(inView, searchInput.value);
  const scopeTitle = navigationScopeTitle(getLibraryNavigationScope(), projects);
  count.textContent = searchInput.value.trim()
    ? `${visible.length} of ${inView.length} in ${scopeTitle}`
    : `${inView.length} ${inView.length === 1 ? 'conversation' : 'conversations'} · ${scopeTitle}`;
  list.replaceChildren(...visible.map(conversationButton));

  viewActive.classList.toggle('selected', !showingArchived);
  viewArchived.classList.toggle('selected', showingArchived);
  viewActive.setAttribute('aria-pressed', String(!showingArchived));
  viewArchived.setAttribute('aria-pressed', String(showingArchived));
  renderProjectFilter();

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'count';
    empty.textContent = inView.length
      ? `No conversations in ${scopeTitle} match this search.`
      : `No conversations in ${scopeTitle}.`;
    list.append(empty);
  }
}

async function loadRecords(preferredSelectionId: string | null = selectedConversationId): Promise<void> {
  const [conversations, loadedProjects] = await Promise.all([
    repository.listConversations(),
    listProjects(database)
  ]);
  projects = loadedProjects;
  const projectMap = new Map(projects.map((project) => [project.id, project] as const));
  records = await Promise.all(
    conversations.map(async (conversation): Promise<LibraryRecord> => ({
      conversation,
      messages: await repository.listMessages(conversation.id),
      project: conversation.projectId ? projectMap.get(conversation.projectId) : undefined,
      checkpoints: await listCheckpoints(database, conversation.id)
    }))
  );

  const scope = getLibraryNavigationScope();
  if (scope.kind === 'project' || scope.kind === 'folder') {
    const project = projects.find((entry) => entry.id === scope.projectId);
    const folderExists =
      scope.kind !== 'folder' || Boolean(project?.folders.some((folder) => folder.id === scope.folderId));
    if (!project || !folderExists) setNavigationScopeWithoutReload({ kind: 'library' });
  }

  const inView = recordsInCurrentView();
  const preferred = preferredSelectionId
    ? inView.find((record) => record.conversation.id === preferredSelectionId)
    : undefined;
  const next = preferred ?? inView[0];
  selectedConversationId = next?.conversation.id ?? null;
  renderConversationList();

  if (next) renderTranscript(next);
  else {
    const scopeTitle = navigationScopeTitle(getLibraryNavigationScope(), projects);
    clearSelection(
      records.length
        ? `No conversations are available in ${scopeTitle}.`
        : 'Your locally recorded conversations will appear here.'
    );
  }
}

async function currentBundle(): Promise<{
  conversation: ArchiveConversation;
  messages: ArchiveMessage[];
  events: Awaited<ReturnType<ArchiveRepository['listEvents']>>;
  project: ArchiveProject | null;
}> {
  const record = selectedRecord();
  if (!record) throw new Error('No conversation selected');
  return {
    conversation: record.conversation,
    messages: await repository.listMessages(record.conversation.id),
    events: await repository.listEvents(record.conversation.id),
    project: record.project ?? null
  };
}

async function importSelectedFile(file: File): Promise<void> {
  importJson.disabled = true;
  setLibraryStatus(`Validating ${file.name}…`);
  try {
    const parsed = parseJsonArchiveExport(await file.text());
    const result = await importArchiveBundle(database, parsed);
    setNavigationScopeWithoutReload(
      parsed.conversation.archivedAt ? { kind: 'archived' } : { kind: 'library' }
    );
    await loadRecords(result.conversationId);
    void requestMirrorRefresh(result.conversationId);
    const action = result.created ? 'Imported' : 'Merged';
    setLibraryStatus(
      `${action} ${conversationDisplayTitle(parsed.conversation)} · ${result.messagesAdded} messages added${
        result.messagesUpdated ? ` · ${result.messagesUpdated} updated` : ''
      }`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[LLM Chat History] JSON import failed', error);
    setLibraryStatus(`Import failed: ${message}`, true);
  } finally {
    importJson.disabled = false;
  }
}

async function renameSelectedConversation(): Promise<void> {
  const record = selectedRecord();
  if (!record) return;
  const current = conversationDisplayTitle(record.conversation);
  const next = window.prompt(
    'Rename this conversation. Leave blank to use the provider title again.',
    current
  );
  if (next === null) return;

  const updated = await renameConversation(database, record.conversation.id, next || null);
  await loadRecords(updated.id);
  void requestMirrorRefresh(updated.id);
  setLibraryStatus(
    updated.customTitle
      ? `Renamed to “${updated.customTitle}”.`
      : 'Custom name cleared; provider title restored.'
  );
}

async function toggleArchiveSelectedConversation(): Promise<void> {
  const record = selectedRecord();
  if (!record) return;
  const shouldArchive = !record.conversation.archivedAt;
  const name = conversationDisplayTitle(record.conversation);
  const updated = await setConversationArchived(database, record.conversation.id, shouldArchive);
  selectedConversationId = null;
  await loadRecords(null);
  void requestMirrorRefresh(updated.id);
  setLibraryStatus(`${shouldArchive ? 'Archived' : 'Unarchived'} “${name}”.`);
}

async function deleteSelectedConversation(): Promise<void> {
  const record = selectedRecord();
  if (!record) return;

  if (!deleteIsArmed()) {
    deleteDeadlineMs = Date.now() + 5_000;
    renderManagementActions();
    setLibraryStatus('Press Confirm delete within 5 seconds to permanently remove this local copy.');
    if (deleteResetTimer) clearTimeout(deleteResetTimer);
    deleteResetTimer = setTimeout(() => {
      resetDeleteConfirmation();
      setLibraryStatus('Delete confirmation expired.');
    }, 5_100);
    return;
  }

  const name = conversationDisplayTitle(record.conversation);
  resetDeleteConfirmation();
  await deleteConversationCascade(database, record.conversation.id);
  selectedConversationId = null;
  await loadRecords(null);
  setLibraryStatus(`Deleted “${name}” and its local messages/events.`);
}

async function changeSelectedProject(projectId: string): Promise<void> {
  const record = selectedRecord();
  if (!record) return;
  const updated = await assignConversationOrganization(
    database,
    record.conversation.id,
    projectId || null,
    null
  );
  await loadRecords(updated.id);
  void requestMirrorRefresh(updated.id);
  setLibraryStatus(projectId ? 'Conversation moved to project.' : 'Conversation moved to Unsorted.');
}

async function changeSelectedFolder(folderId: string): Promise<void> {
  const record = selectedRecord();
  if (!record?.conversation.projectId) return;
  const updated = await assignConversationOrganization(
    database,
    record.conversation.id,
    record.conversation.projectId,
    folderId || null
  );
  await loadRecords(updated.id);
  void requestMirrorRefresh(updated.id);
  setLibraryStatus(folderId ? 'Folder assignment updated.' : 'Folder assignment cleared.');
}

async function saveSelectedTags(): Promise<void> {
  const record = selectedRecord();
  if (!record) return;
  const tags = tagsInput.value.split(',');
  const updated = await setConversationTags(database, record.conversation.id, tags);
  await loadRecords(updated.id);
  void requestMirrorRefresh(updated.id);
  setLibraryStatus(updated.tags?.length ? `Saved ${updated.tags.length} tag(s).` : 'Tags cleared.');
}

async function createProjectFromUi(): Promise<void> {
  const name = window.prompt('New project name');
  if (name === null) return;
  const project = await createProject(database, name);
  const record = selectedRecord();
  if (record) {
    await assignConversationOrganization(database, record.conversation.id, project.id, null);
  }
  setNavigationScopeWithoutReload({ kind: 'library' });
  await loadRecords(record?.conversation.id ?? null);
  if (record) void requestMirrorRefresh(record.conversation.id);
  setLibraryStatus(`Created project “${project.name}”.`);
}

async function renameSelectedProjectFromUi(): Promise<void> {
  const record = selectedRecord();
  const project = projectById(record?.conversation.projectId);
  if (!project) return;
  const name = window.prompt('Rename project', project.name);
  if (name === null) return;
  const affected = records
    .filter((entry) => entry.conversation.projectId === project.id)
    .map((entry) => entry.conversation.id);
  const updated = await renameProject(database, project.id, name);
  await loadRecords(record?.conversation.id ?? null);
  requestMirrorRefreshes(affected);
  setLibraryStatus(`Renamed project to “${updated.name}”.`);
}

async function deleteSelectedProjectFromUi(): Promise<void> {
  const record = selectedRecord();
  const project = projectById(record?.conversation.projectId);
  if (!project) return;
  if (!window.confirm(`Delete project “${project.name}”? Conversations will return to Unsorted and will not be deleted.`)) {
    return;
  }
  const affected = records
    .filter((entry) => entry.conversation.projectId === project.id)
    .map((entry) => entry.conversation.id);
  await deleteProject(database, project.id);
  const scope = getLibraryNavigationScope();
  if (
    (scope.kind === 'project' || scope.kind === 'folder') &&
    scope.projectId === project.id
  ) {
    setNavigationScopeWithoutReload({ kind: 'library' });
  }
  await loadRecords(record?.conversation.id ?? null);
  requestMirrorRefreshes(affected);
  setLibraryStatus(`Deleted project “${project.name}”; its conversations are now Unsorted.`);
}

async function createFolderFromUi(): Promise<void> {
  const record = selectedRecord();
  const project = projectById(record?.conversation.projectId);
  if (!record || !project) return;
  const name = window.prompt(`New folder in “${project.name}”`);
  if (name === null) return;
  const result = await addProjectFolder(database, project.id, name);
  await assignConversationOrganization(
    database,
    record.conversation.id,
    project.id,
    result.folder.id
  );
  await loadRecords(record.conversation.id);
  void requestMirrorRefresh(record.conversation.id);
  setLibraryStatus(`Created folder “${result.folder.name}”.`);
}

async function renameSelectedFolderFromUi(): Promise<void> {
  const record = selectedRecord();
  const project = projectById(record?.conversation.projectId);
  const folder = folderById(project, record?.conversation.folderId);
  if (!record || !project || !folder) return;
  const name = window.prompt('Rename folder', folder.name);
  if (name === null) return;
  const affected = records
    .filter(
      (entry) =>
        entry.conversation.projectId === project.id && entry.conversation.folderId === folder.id
    )
    .map((entry) => entry.conversation.id);
  await renameProjectFolder(database, project.id, folder.id, name);
  await loadRecords(record.conversation.id);
  requestMirrorRefreshes(affected);
  setLibraryStatus('Folder renamed.');
}

async function deleteSelectedFolderFromUi(): Promise<void> {
  const record = selectedRecord();
  const project = projectById(record?.conversation.projectId);
  const folder = folderById(project, record?.conversation.folderId);
  if (!record || !project || !folder) return;
  if (!window.confirm(`Delete folder “${folder.name}”? Conversations stay in “${project.name}” with no folder.`)) {
    return;
  }
  const affected = records
    .filter(
      (entry) =>
        entry.conversation.projectId === project.id && entry.conversation.folderId === folder.id
    )
    .map((entry) => entry.conversation.id);
  await deleteProjectFolder(database, project.id, folder.id);
  await loadRecords(record.conversation.id);
  requestMirrorRefreshes(affected);
  setLibraryStatus(`Deleted folder “${folder.name}”; assigned conversations remain in the project.`);
}

function runAction(action: () => Promise<void>): void {
  void action().catch((error: unknown) => {
    resetDeleteConfirmation();
    setLibraryStatus(error instanceof Error ? error.message : String(error), true);
  });
}

searchInput.addEventListener('input', renderConversationList);
projectFilter.addEventListener('change', () => {
  const value = projectFilter.value;
  if (value === 'all') setLibraryNavigationScope({ kind: 'library' });
  else if (value === 'unsorted') setLibraryNavigationScope({ kind: 'unsorted' });
  else setLibraryNavigationScope({ kind: 'project', projectId: value });
});
viewActive.addEventListener('click', () => {
  setLibraryNavigationScope({ kind: 'library' });
});
viewArchived.addEventListener('click', () => {
  setLibraryNavigationScope({ kind: 'archived' });
});
renameButton.addEventListener('click', () => runAction(renameSelectedConversation));
archiveButton.addEventListener('click', () => runAction(toggleArchiveSelectedConversation));
deleteButton.addEventListener('click', () => runAction(deleteSelectedConversation));
projectSelect.addEventListener('change', () => runAction(() => changeSelectedProject(projectSelect.value)));
folderSelect.addEventListener('change', () => runAction(() => changeSelectedFolder(folderSelect.value)));
saveTagsButton.addEventListener('click', () => runAction(saveSelectedTags));
newProjectButton.addEventListener('click', () => runAction(createProjectFromUi));
renameProjectButton.addEventListener('click', () => runAction(renameSelectedProjectFromUi));
deleteProjectButton.addEventListener('click', () => runAction(deleteSelectedProjectFromUi));
newFolderButton.addEventListener('click', () => runAction(createFolderFromUi));
renameFolderButton.addEventListener('click', () => runAction(renameSelectedFolderFromUi));
deleteFolderButton.addEventListener('click', () => runAction(deleteSelectedFolderFromUi));

downloadMarkdown.addEventListener('click', () => {
  void currentBundle().then((bundle) => {
    downloadText(
      exportFilename(bundle.conversation, 'md'),
      renderMarkdownExport({ ...bundle, exportedAt: new Date().toISOString() }),
      'text/markdown;charset=utf-8'
    );
  });
});

downloadJson.addEventListener('click', () => {
  void currentBundle().then((bundle) => {
    downloadText(
      exportFilename(bundle.conversation, 'json'),
      renderJsonExport({ ...bundle, exportedAt: new Date().toISOString() }),
      'application/json;charset=utf-8'
    );
  });
});

importJson.addEventListener('click', () => importFile.click());
importFile.addEventListener('change', () => {
  const file = importFile.files?.[0];
  importFile.value = '';
  if (file) void importSelectedFile(file);
});

void openArchiveDb()
  .then((db) => {
    database = db;
    repository = new ArchiveRepository(db);
    libraryReady = true;
    applyNavigationScope(getLibraryNavigationScope());
    importJson.disabled = false;
    projectFilter.disabled = false;
    newProjectButton.disabled = false;
    return loadRecords();
  })
  .catch((error: unknown) => {
    console.error('[LLM Chat History] unable to load local archive', error);
    count.textContent = 'Archive unavailable';
    title.textContent = 'Unable to open local archive';
    meta.textContent = error instanceof Error ? error.message : String(error);
    importJson.disabled = true;
    projectFilter.disabled = true;
    renameButton.disabled = true;
    archiveButton.disabled = true;
    deleteButton.disabled = true;
    projectSelect.disabled = true;
    folderSelect.disabled = true;
    tagsInput.disabled = true;
    saveTagsButton.disabled = true;
    newProjectButton.disabled = true;
    renameProjectButton.disabled = true;
    deleteProjectButton.disabled = true;
    newFolderButton.disabled = true;
    renameFolderButton.disabled = true;
    deleteFolderButton.disabled = true;
    setLibraryStatus('Library actions are unavailable while local storage is inaccessible.', true);
    setEmptyTranscript(
      'The local archive could not be opened. Reload this page after resolving the storage error.'
    );
  });


window.addEventListener(
  'pagehide',
  () => {
    unsubscribeNavigation();
  },
  { once: true }
);
