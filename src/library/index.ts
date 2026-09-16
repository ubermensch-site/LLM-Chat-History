import { exportFilename, renderJsonExport, renderMarkdownExport } from '../export/export';
import { parseJsonArchiveExport } from '../import/json-import';
import { ArchiveRepository } from '../storage/archive';
import { conversationDisplayTitle } from '../storage/conversation';
import { openArchiveDb } from '../storage/db';
import { importArchiveBundle } from '../storage/import';
import {
  deleteConversationCascade,
  renameConversation,
  setConversationArchived
} from '../storage/library-management';
import type { ArchiveConversation, ArchiveMessage } from '../storage/schema';
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

const searchInput = byId<HTMLInputElement>('search');
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

let database: IDBDatabase;
let repository: ArchiveRepository;
let records: LibraryRecord[] = [];
let selectedConversationId: string | null = null;
let showingArchived = false;
let deleteDeadlineMs: number | null = null;
let deleteResetTimer: ReturnType<typeof setTimeout> | null = null;

function selectedRecord(): LibraryRecord | undefined {
  return records.find((record) => record.conversation.id === selectedConversationId);
}

function recordBelongsInCurrentView(record: LibraryRecord): boolean {
  return showingArchived ? Boolean(record.conversation.archivedAt) : !record.conversation.archivedAt;
}

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
}

function renderTranscript(record: LibraryRecord): void {
  const conversation = record.conversation;
  title.textContent = conversationDisplayTitle(conversation);
  const archived = conversation.archivedAt ? ` · Archived ${humanDate(conversation.archivedAt)}` : '';
  meta.textContent = `${conversation.providerId} · ${conversation.messageCount} messages · ${conversation.recordingState} · Last captured ${humanDate(conversation.lastObservedAt)}${archived}`;
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
  title.textContent = showingArchived ? 'Archived conversations' : 'Local archive';
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

function conversationButton(conversation: ArchiveConversation): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `conversation${conversation.id === selectedConversationId ? ' selected' : ''}`;
  button.dataset.conversationId = conversation.id;

  const name = document.createElement('span');
  name.className = 'conversation-title';
  name.textContent = conversationDisplayTitle(conversation);

  const details = document.createElement('span');
  details.className = 'conversation-meta';
  details.textContent = `${conversation.messageCount} messages · ${conversation.recordingState} · ${humanDate(conversation.updatedAt)}`;

  button.append(name, details);
  button.addEventListener('click', () => selectConversation(conversation.id));
  return button;
}

function renderConversationList(): void {
  const inView = recordsInCurrentView();
  const visible = filterLibraryRecords(inView, searchInput.value);
  count.textContent = searchInput.value.trim()
    ? `${visible.length} of ${inView.length} ${showingArchived ? 'archived' : 'active'} conversations`
    : `${inView.length} ${showingArchived ? 'archived' : 'active'} conversations`;
  list.replaceChildren(...visible.map((record) => conversationButton(record.conversation)));

  viewActive.classList.toggle('selected', !showingArchived);
  viewArchived.classList.toggle('selected', showingArchived);
  viewActive.setAttribute('aria-pressed', String(!showingArchived));
  viewArchived.setAttribute('aria-pressed', String(showingArchived));

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'count';
    empty.textContent = inView.length
      ? 'No conversations in this view match the search.'
      : showingArchived
        ? 'No archived conversations.'
        : 'No active conversations.';
    list.append(empty);
  }
}

async function loadRecords(preferredSelectionId: string | null = selectedConversationId): Promise<void> {
  const conversations = await repository.listConversations();
  records = await Promise.all(
    conversations.map(async (conversation) => ({
      conversation,
      messages: await repository.listMessages(conversation.id)
    }))
  );

  const inView = recordsInCurrentView();
  const preferred = preferredSelectionId
    ? inView.find((record) => record.conversation.id === preferredSelectionId)
    : undefined;
  const next = preferred ?? inView[0];
  selectedConversationId = next?.conversation.id ?? null;
  renderConversationList();

  if (next) renderTranscript(next);
  else {
    clearSelection(
      showingArchived
        ? 'Archived conversations will appear here.'
        : records.length
          ? 'All saved conversations are currently archived.'
          : 'Your locally recorded conversations will appear here.'
    );
  }
}

async function currentBundle(): Promise<{
  conversation: ArchiveConversation;
  messages: ArchiveMessage[];
  events: Awaited<ReturnType<ArchiveRepository['listEvents']>>;
}> {
  const record = selectedRecord();
  if (!record) throw new Error('No conversation selected');
  return {
    conversation: record.conversation,
    messages: await repository.listMessages(record.conversation.id),
    events: await repository.listEvents(record.conversation.id)
  };
}

async function importSelectedFile(file: File): Promise<void> {
  importJson.disabled = true;
  setLibraryStatus(`Validating ${file.name}…`);
  try {
    const parsed = parseJsonArchiveExport(await file.text());
    const result = await importArchiveBundle(database, parsed);
    showingArchived = Boolean(parsed.conversation.archivedAt);
    await loadRecords(result.conversationId);
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
  await setConversationArchived(database, record.conversation.id, shouldArchive);
  selectedConversationId = null;
  await loadRecords(null);
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

searchInput.addEventListener('input', renderConversationList);
viewActive.addEventListener('click', () => {
  showingArchived = false;
  resetDeleteConfirmation();
  void loadRecords(null);
});
viewArchived.addEventListener('click', () => {
  showingArchived = true;
  resetDeleteConfirmation();
  void loadRecords(null);
});
renameButton.addEventListener('click', () => {
  void renameSelectedConversation().catch((error: unknown) => {
    setLibraryStatus(error instanceof Error ? error.message : String(error), true);
  });
});
archiveButton.addEventListener('click', () => {
  void toggleArchiveSelectedConversation().catch((error: unknown) => {
    setLibraryStatus(error instanceof Error ? error.message : String(error), true);
  });
});
deleteButton.addEventListener('click', () => {
  void deleteSelectedConversation().catch((error: unknown) => {
    resetDeleteConfirmation();
    setLibraryStatus(error instanceof Error ? error.message : String(error), true);
  });
});

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
    importJson.disabled = false;
    return loadRecords();
  })
  .catch((error: unknown) => {
    console.error('[LLM Chat History] unable to load local archive', error);
    count.textContent = 'Archive unavailable';
    title.textContent = 'Unable to open local archive';
    meta.textContent = error instanceof Error ? error.message : String(error);
    importJson.disabled = true;
    renameButton.disabled = true;
    archiveButton.disabled = true;
    deleteButton.disabled = true;
    setLibraryStatus('Library actions are unavailable while local storage is inaccessible.', true);
    setEmptyTranscript(
      'The local archive could not be opened. Reload this page after resolving the storage error.'
    );
  });
