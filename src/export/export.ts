import type { ArchiveConversation, ArchiveEvent, ArchiveMessage } from '../storage/schema';

export interface ArchiveExportBundle {
  conversation: ArchiveConversation;
  messages: ArchiveMessage[];
  events: ArchiveEvent[];
  exportedAt: string;
}

function providerLabel(providerId: ArchiveConversation['providerId']): string {
  return providerId === 'chatgpt' ? 'ChatGPT' : providerId;
}

function roleLabel(role: ArchiveMessage['role']): string {
  return role === 'user' ? 'User' : 'Assistant';
}

function escapeMetadata(value: string): string {
  return value.replace(/\r?\n/g, ' ').trim();
}

function stateEventLabel(event: ArchiveEvent): string | null {
  switch (event.type) {
    case 'recording-paused':
      return 'Recording paused';
    case 'recording-resumed':
      return 'Recording resumed';
    case 'recording-stopped':
      return 'Recording stopped';
    case 'recording-started':
      return 'Recording started';
    default:
      return null;
  }
}

export function renderMarkdownExport(bundle: ArchiveExportBundle): string {
  const { conversation, messages, events, exportedAt } = bundle;
  const title = escapeMetadata(conversation.title || 'Untitled conversation');
  const lines: string[] = [
    `# ${title}`,
    '',
    `- **Provider:** ${providerLabel(conversation.providerId)}`,
    `- **Source:** ${conversation.sourceUrl}`,
    `- **Conversation ID:** ${conversation.providerConversationId ?? 'provisional'}`,
    `- **First captured:** ${conversation.createdAt}`,
    `- **Last captured:** ${conversation.lastObservedAt}`,
    `- **Recording state at export:** ${conversation.recordingState}`,
    `- **Exported:** ${exportedAt}`,
    `- **Messages:** ${messages.length}`,
    '',
    '---',
    ''
  ];

  const timeline: Array<
    | { kind: 'message'; at: string; order: number; message: ArchiveMessage }
    | { kind: 'state'; at: string; order: number; label: string }
  > = [];

  for (const message of messages) {
    timeline.push({
      kind: 'message',
      at: message.firstObservedAt,
      order: message.orderHint * 10 + 5,
      message
    });
  }

  for (const event of events) {
    const label = stateEventLabel(event);
    if (!label) continue;
    timeline.push({ kind: 'state', at: event.createdAt, order: 0, label });
  }

  timeline.sort((a, b) => a.at.localeCompare(b.at) || a.order - b.order);

  for (const item of timeline) {
    if (item.kind === 'state') {
      lines.push(`> **${item.label}** — ${item.at}`, '', '---', '');
      continue;
    }

    const message = item.message;
    const content = (message.markdown || message.plainText).trim();
    lines.push(`## ${roleLabel(message.role)}`, '');
    if (message.partial) lines.push('> **Partial capture**', '');
    lines.push(content || '_Empty rendered message_', '', '---', '');
  }

  return `${lines.join('\n').trim()}\n`;
}

export function renderJsonExport(bundle: ArchiveExportBundle): string {
  return `${JSON.stringify(
    {
      schema: 'llm-chat-history/archive-export',
      schemaVersion: 1,
      exportedAt: bundle.exportedAt,
      conversation: bundle.conversation,
      messages: bundle.messages,
      events: bundle.events
    },
    null,
    2
  )}\n`;
}

export function filesystemSafeSlug(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || 'untitled-conversation';
}

export function exportFilename(
  conversation: ArchiveConversation,
  extension: 'md' | 'json'
): string {
  const timestamp = conversation.createdAt.replace(/[:.]/g, '-');
  return `${timestamp}__${conversation.providerId}__${filesystemSafeSlug(
    conversation.title || 'untitled-conversation'
  )}.${extension}`;
}
