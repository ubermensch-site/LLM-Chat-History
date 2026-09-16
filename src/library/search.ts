import type { ArchiveCheckpoint } from '../storage/checkpoints';
import { conversationDisplayTitle } from '../storage/conversation';
import type { ArchiveConversation, ArchiveMessage, ArchiveProject } from '../storage/schema';

export interface LibraryRecord {
  conversation: ArchiveConversation;
  messages: ArchiveMessage[];
  project: ArchiveProject | undefined;
  checkpoints?: ArchiveCheckpoint[];
}

function normalized(value: string): string {
  return value.toLocaleLowerCase();
}

function messageSearchText(message: ArchiveMessage): string {
  return [
    message.plainText,
    message.modelLabel ?? '',
    ...(message.visibleActivities?.map((activity) => activity.text) ?? [])
  ].join('\n');
}

export function matchesLibraryQuery(record: LibraryRecord, query: string): boolean {
  const needle = normalized(query.trim());
  if (!needle) return true;

  const conversation = record.conversation;
  const folder = record.project?.folders.find((entry) => entry.id === conversation.folderId);
  const metadata = [
    conversationDisplayTitle(conversation),
    conversation.title ?? '',
    conversation.providerId,
    conversation.providerConversationId ?? '',
    conversation.sourceUrl,
    conversation.recordingState,
    conversation.archivedAt ? 'archived' : 'active',
    record.project?.name ?? 'Unsorted',
    folder?.name ?? '',
    ...(conversation.tags ?? [])
  ]
    .join('\n')
    .toLocaleLowerCase();

  if (metadata.includes(needle)) return true;
  if (record.messages.some((message) => normalized(messageSearchText(message)).includes(needle))) {
    return true;
  }
  return (record.checkpoints ?? []).some((checkpoint) =>
    normalized(`${checkpoint.name}\n${checkpoint.note ?? ''}`).includes(needle)
  );
}

export function filterLibraryRecords(records: LibraryRecord[], query: string): LibraryRecord[] {
  return records.filter((record) => matchesLibraryQuery(record, query));
}
