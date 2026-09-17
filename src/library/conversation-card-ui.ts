import { ArchiveRepository } from '../storage/archive';
import { conversationDisplayTitle } from '../storage/conversation';
import { openArchiveDb } from '../storage/db';
import { listProjects } from '../storage/projects';
import type { ArchiveConversation, ArchiveProject } from '../storage/schema';
import {
  conversationPreview,
  conversationStatusLabel,
  providerDisplayName,
  relativeConversationTime
} from './conversation-card';

const list = document.getElementById('conversation-list');
const dbPromise = openArchiveDb();
let scheduled = false;
let destroyed = false;

function folderName(project: ArchiveProject | undefined, folderId: string | undefined): string | null {
  if (!project || !folderId) return null;
  return project.folders.find((folder) => folder.id === folderId)?.name ?? null;
}

function conversationLocation(
  conversation: ArchiveConversation,
  project: ArchiveProject | undefined
): string | null {
  const folder = folderName(project, conversation.folderId);
  if (project && folder) return `${project.name} / ${folder}`;
  return project?.name ?? null;
}

function appendTextSpan(parent: HTMLElement, className: string, text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  parent.append(span);
  return span;
}

async function enrichVisibleCards(): Promise<void> {
  if (!list || destroyed) return;
  const buttons = [...list.querySelectorAll<HTMLButtonElement>('button.conversation[data-conversation-id]')]
    .filter((button) => !button.dataset.cardEnhanced);
  if (!buttons.length) return;

  const database = await dbPromise;
  if (destroyed) return;
  const repository = new ArchiveRepository(database);
  const [conversations, projects] = await Promise.all([
    repository.listConversations(),
    listProjects(database)
  ]);
  const conversationMap = new Map(conversations.map((conversation) => [conversation.id, conversation] as const));
  const projectMap = new Map(projects.map((project) => [project.id, project] as const));

  await Promise.all(
    buttons.map(async (button) => {
      const conversationId = button.dataset.conversationId;
      if (!conversationId) return;
      const conversation = conversationMap.get(conversationId);
      if (!conversation) return;

      const messages = await repository.listMessages(conversationId);
      if (destroyed || !button.isConnected || button.dataset.cardEnhanced) return;

      const project = conversation.projectId ? projectMap.get(conversation.projectId) : undefined;
      const preview = conversationPreview(messages);
      const status = conversationStatusLabel(conversation);
      const location = conversationLocation(conversation, project);
      const tags = (conversation.tags ?? []).slice(0, 2);

      // Set the marker before replacing children so our own DOM work does not schedule itself again.
      button.dataset.cardEnhanced = conversation.updatedAt;
      button.setAttribute(
        'aria-label',
        `${conversationDisplayTitle(conversation)}, ${conversation.messageCount} ${conversation.messageCount === 1 ? 'message' : 'messages'}, updated ${relativeConversationTime(conversation.updatedAt)}`
      );
      button.replaceChildren();

      const kicker = document.createElement('span');
      kicker.className = 'conversation-kicker';
      const provider = appendTextSpan(kicker, 'provider-pill', providerDisplayName(conversation.providerId));
      if (status) provider.textContent = `${provider.textContent} · ${status}`;
      appendTextSpan(kicker, 'conversation-time', relativeConversationTime(conversation.updatedAt));

      appendTextSpan(button, 'conversation-title', conversationDisplayTitle(conversation));

      const previewElement = document.createElement('span');
      previewElement.className = 'conversation-preview';
      if (preview.role) {
        const role = document.createElement('strong');
        role.textContent = `${preview.role}: `;
        previewElement.append(role, document.createTextNode(preview.text));
      } else {
        previewElement.textContent = preview.text;
      }
      button.append(previewElement);

      const metaRow = document.createElement('span');
      metaRow.className = 'conversation-meta-row';
      const metadata = [
        `${conversation.messageCount} ${conversation.messageCount === 1 ? 'message' : 'messages'}`,
        location
      ].filter(Boolean).join(' · ');
      appendTextSpan(metaRow, 'conversation-meta', metadata);

      if (tags.length) {
        const tagsElement = document.createElement('span');
        tagsElement.className = 'conversation-tags';
        for (const tag of tags) appendTextSpan(tagsElement, 'conversation-tag', `#${tag}`);
        metaRow.append(tagsElement);
      }

      button.append(kicker, metaRow);
    })
  );
}

function scheduleEnhancement(): void {
  if (scheduled || destroyed) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    void enrichVisibleCards().catch((error: unknown) => {
      console.debug('[LLM Chat History] conversation card metadata unavailable', error);
    });
  });
}

const observer = list
  ? new MutationObserver(() => {
      if (list.querySelector('button.conversation[data-conversation-id]:not([data-card-enhanced])')) {
        scheduleEnhancement();
      }
    })
  : null;

if (list && observer) {
  observer.observe(list, { childList: true, subtree: true });
  scheduleEnhancement();
}

window.addEventListener(
  'pagehide',
  () => {
    destroyed = true;
    observer?.disconnect();
    void dbPromise.then((database) => database.close());
  },
  { once: true }
);
