import { exportFilename, renderJsonExport, renderMarkdownExport } from '../export/export';
import { ArchiveRepository } from '../storage/archive';
import { openArchiveDb } from '../storage/db';
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

let repository: ArchiveRepository;
let records: LibraryRecord[] = [];
let selectedConversationId: string | null = null;

function selectedRecord(): LibraryRecord | undefined {
  return records.find((record) => record.conversation.id === selectedConversationId);
}

function setEmptyTranscript(message: string): void {
  transcript.replaceChildren();
  const empty = document.createElement('div');
  empty.className = 'empty';
  empty.textContent = message;
  transcript.append(empty);
}

function renderTranscript(record: LibraryRecord): void {
  const conversation = record.conversation;
  title.textContent = conversation.title || 'Untitled conversation';
  meta.textContent = `${conversation.providerId} · ${conversation.messageCount} messages · ${conversation.recordingState} · Last captured ${humanDate(conversation.lastObservedAt)}`;
  downloadMarkdown.disabled = false;
  downloadJson.disabled = false;
  transcript.replaceChildren();

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

function selectConversation(id: string): void {
  selectedConversationId = id;
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
  name.textContent = conversation.title || 'Untitled conversation';

  const details = document.createElement('span');
  details.className = 'conversation-meta';
  details.textContent = `${conversation.messageCount} messages · ${conversation.recordingState} · ${humanDate(conversation.updatedAt)}`;

  button.append(name, details);
  button.addEventListener('click', () => selectConversation(conversation.id));
  return button;
}

function renderConversationList(): void {
  const visible = filterLibraryRecords(records, searchInput.value);
  count.textContent = searchInput.value.trim()
    ? `${visible.length} of ${records.length} conversations`
    : `${records.length} conversations`;
  list.replaceChildren(...visible.map((record) => conversationButton(record.conversation)));

  if (visible.length === 0 && records.length > 0) {
    const empty = document.createElement('div');
    empty.className = 'count';
    empty.textContent = 'No local archive matches this search.';
    list.append(empty);
  }
}

async function loadRecords(): Promise<void> {
  const conversations = await repository.listConversations();
  records = await Promise.all(
    conversations.map(async (conversation) => ({
      conversation,
      messages: await repository.listMessages(conversation.id)
    }))
  );

  renderConversationList();
  if (!selectedConversationId && records[0]) selectConversation(records[0].conversation.id);
  if (records.length === 0) {
    count.textContent = '0 conversations';
    title.textContent = 'Local archive';
    meta.textContent = 'No conversations have been captured yet.';
    downloadMarkdown.disabled = true;
    downloadJson.disabled = true;
    setEmptyTranscript('Your locally recorded conversations will appear here.');
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

searchInput.addEventListener('input', renderConversationList);

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

void openArchiveDb()
  .then((db) => {
    repository = new ArchiveRepository(db);
    return loadRecords();
  })
  .catch((error: unknown) => {
    console.error('[LLM Chat History] unable to load local archive', error);
    count.textContent = 'Archive unavailable';
    title.textContent = 'Unable to open local archive';
    meta.textContent = error instanceof Error ? error.message : String(error);
    setEmptyTranscript('The local archive could not be opened. Reload this page after resolving the storage error.');
  });
