import type { ArchiveConversation, ArchiveMessage } from '../storage/schema';
import { conversationPreviewText } from './conversation-preview';

export interface ConversationPreview {
  role: 'You' | 'Assistant' | null;
  text: string;
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function conversationPreview(
  messages: readonly ArchiveMessage[],
  maxLength = 160
): ConversationPreview {
  const latest = [...messages]
    .reverse()
    .find((message) =>
      compactWhitespace(message.markdown?.trim() || message.plainText).length > 0
    );

  if (!latest) {
    return { role: null, text: 'No captured message text yet.' };
  }

  return {
    role: latest.role === 'user' ? 'You' : 'Assistant',
    text: conversationPreviewText(latest.markdown, latest.plainText, maxLength)
  };
}

export function relativeConversationTime(iso: string, nowMs = Date.now()): string {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return 'Unknown date';

  const elapsedMs = Math.max(0, nowMs - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (elapsedMs < minute) return 'Now';
  if (elapsedMs < hour) return `${Math.floor(elapsedMs / minute)}m ago`;
  if (elapsedMs < day) return `${Math.floor(elapsedMs / hour)}h ago`;
  if (elapsedMs < 7 * day) return `${Math.floor(elapsedMs / day)}d ago`;

  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: new Date(timestamp).getFullYear() === new Date(nowMs).getFullYear() ? undefined : 'numeric'
  });
}

export function conversationStatusLabel(conversation: ArchiveConversation): string | null {
  if (conversation.provisional) return 'Capturing';
  if (conversation.recordingState === 'recording') return 'Recording';
  if (conversation.recordingState === 'paused') return 'Paused';
  if (conversation.recordingState === 'error') return 'Recording issue';
  return null;
}

export function providerDisplayName(providerId: ArchiveConversation['providerId']): string {
  return providerId === 'chatgpt' ? 'ChatGPT' : providerId;
}
