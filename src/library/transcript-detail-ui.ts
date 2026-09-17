import { ArchiveRepository } from '../storage/archive';
import { openArchiveDb } from '../storage/db';
import { listProjects } from '../storage/projects';
import type { ArchiveConversation, ArchiveProject } from '../storage/schema';
import {
  conversationStatusLabel,
  providerDisplayName,
  relativeConversationTime
} from './conversation-card';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing transcript detail element: ${id}`);
  return element as T;
}

const conversationList = byId<HTMLDivElement>('conversation-list');
const transcript = byId<HTMLElement>('transcript');
const meta = byId<HTMLParagraphElement>('meta');
const organizerShell = document.querySelector<HTMLElement>('.organizer-shell');
if (!organizerShell) throw new Error('Missing organizer shell for transcript context');

const contextShell = document.createElement('div');
contextShell.className = 'conversation-context-shell';
const context = document.createElement('section');
context.className = 'conversation-context';
context.hidden = true;
context.setAttribute('aria-label', 'Conversation details');
contextShell.append(context);
organizerShell.before(contextShell);

const dbPromise = openArchiveDb();
let destroyed = false;
let contextScheduled = false;
let turnScheduled = false;

function selectedConversationId(): string | null {
  return (
    conversationList.querySelector<HTMLButtonElement>('button.conversation.selected[data-conversation-id]')
      ?.dataset.conversationId ?? null
  );
}

function folderName(project: ArchiveProject | undefined, folderId: string | undefined): string | null {
  if (!project || !folderId) return null;
  return project.folders.find((folder) => folder.id === folderId)?.name ?? null;
}

function fullDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function chip(text: string, className = '', title?: string): HTMLSpanElement {
  const element = document.createElement('span');
  element.className = `context-chip${className ? ` ${className}` : ''}`;
  element.textContent = text;
  if (title) element.title = title;
  return element;
}

function separator(): HTMLSpanElement {
  const element = document.createElement('span');
  element.className = 'context-separator';
  element.setAttribute('aria-hidden', 'true');
  return element;
}

function locationLabel(
  conversation: ArchiveConversation,
  project: ArchiveProject | undefined
): string | null {
  if (!project) return null;
  const folder = folderName(project, conversation.folderId);
  return folder ? `${project.name} / ${folder}` : project.name;
}

async function renderConversationContext(): Promise<void> {
  const conversationId = selectedConversationId();
  if (!conversationId || destroyed) {
    context.hidden = true;
    context.replaceChildren();
    return;
  }

  const database = await dbPromise;
  if (destroyed || selectedConversationId() !== conversationId) return;
  const repository = new ArchiveRepository(database);
  const [conversations, projects] = await Promise.all([
    repository.listConversations(),
    listProjects(database)
  ]);
  if (destroyed || selectedConversationId() !== conversationId) return;

  const conversation = conversations.find((entry) => entry.id === conversationId);
  if (!conversation) {
    context.hidden = true;
    context.replaceChildren();
    return;
  }

  const project = conversation.projectId
    ? projects.find((entry) => entry.id === conversation.projectId)
    : undefined;
  const status = conversationStatusLabel(conversation);
  const location = locationLabel(conversation, project);
  const updatedLabel = relativeConversationTime(conversation.lastObservedAt);
  const messageLabel = `${conversation.messageCount} ${conversation.messageCount === 1 ? 'message' : 'messages'}`;

  meta.textContent = `${providerDisplayName(conversation.providerId)} · ${messageLabel} · Updated ${updatedLabel}`;

  const items: HTMLElement[] = [
    chip(providerDisplayName(conversation.providerId), 'primary'),
    chip(messageLabel),
    chip(`Updated ${updatedLabel}`, '', fullDate(conversation.lastObservedAt))
  ];

  if (status) items.push(separator(), chip(status, 'status'));
  if (location) items.push(separator(), chip(location));
  if (conversation.archivedAt) {
    items.push(chip('Archived', 'status', `Archived ${fullDate(conversation.archivedAt)}`));
  }
  for (const tag of (conversation.tags ?? []).slice(0, 4)) items.push(chip(`#${tag}`, 'tag'));
  items.push(separator(), chip('Local copy'));

  context.replaceChildren(...items);
  context.hidden = false;
}

function enhanceTurnHeaders(): void {
  const messages = [...transcript.querySelectorAll<HTMLElement>('.message')];
  messages.forEach((message, index) => {
    if (message.dataset.detailEnhanced) return;
    message.dataset.detailEnhanced = 'true';
    const role = message.querySelector<HTMLElement>('.role');
    if (!role) return;
    const turn = document.createElement('span');
    turn.className = 'turn-index';
    turn.textContent = `Turn ${index + 1}`;
    role.insertAdjacentElement('afterend', turn);
  });
}

function scheduleContext(): void {
  if (contextScheduled || destroyed) return;
  contextScheduled = true;
  queueMicrotask(() => {
    contextScheduled = false;
    void renderConversationContext().catch((error: unknown) => {
      console.debug('[LLM Chat History] transcript context unavailable', error);
    });
  });
}

function scheduleTurns(): void {
  if (turnScheduled || destroyed) return;
  turnScheduled = true;
  queueMicrotask(() => {
    turnScheduled = false;
    enhanceTurnHeaders();
  });
}

conversationList.addEventListener('click', scheduleContext, true);
const listObserver = new MutationObserver(scheduleContext);
listObserver.observe(conversationList, { childList: true });

const transcriptObserver = new MutationObserver(() => {
  if (transcript.querySelector('.message:not([data-detail-enhanced])')) scheduleTurns();
});
transcriptObserver.observe(transcript, { childList: true, subtree: true });

scheduleContext();
scheduleTurns();

window.addEventListener(
  'pagehide',
  () => {
    destroyed = true;
    listObserver.disconnect();
    transcriptObserver.disconnect();
    void dbPromise.then((database) => database.close());
  },
  { once: true }
);
