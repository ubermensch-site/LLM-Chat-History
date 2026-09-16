import type { ArchiveConversation } from './schema';

export function conversationDisplayTitle(
  conversation: Pick<ArchiveConversation, 'customTitle' | 'title'>,
  fallback = 'Untitled conversation'
): string {
  return conversation.customTitle?.trim() || conversation.title?.trim() || fallback;
}
