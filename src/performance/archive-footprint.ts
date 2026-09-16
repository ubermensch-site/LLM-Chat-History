import type {
  ArchiveConversation,
  ArchiveEvent,
  ArchiveMessage,
  ArchiveProject
} from '../storage/schema';

export interface ArchiveStoreFootprint {
  count: number;
  estimatedJsonBytes: number;
}

export interface ArchiveFootprint {
  conversations: ArchiveStoreFootprint;
  messages: ArchiveStoreFootprint;
  events: ArchiveStoreFootprint;
  projects: ArchiveStoreFootprint;
  totalRecords: number;
  estimatedJsonBytes: number;
  messageTextBytes: number;
}

const encoder = new TextEncoder();

function utf8Bytes(value: string): number {
  return encoder.encode(value).byteLength;
}

function estimatedJsonBytes(records: readonly unknown[]): number {
  let total = 0;
  for (const record of records) total += utf8Bytes(JSON.stringify(record));
  return total;
}

function storeFootprint(records: readonly unknown[]): ArchiveStoreFootprint {
  return {
    count: records.length,
    estimatedJsonBytes: estimatedJsonBytes(records)
  };
}

export function calculateArchiveFootprint(input: {
  conversations: readonly ArchiveConversation[];
  messages: readonly ArchiveMessage[];
  events: readonly ArchiveEvent[];
  projects: readonly ArchiveProject[];
}): ArchiveFootprint {
  const conversations = storeFootprint(input.conversations);
  const messages = storeFootprint(input.messages);
  const events = storeFootprint(input.events);
  const projects = storeFootprint(input.projects);
  const messageTextBytes = input.messages.reduce(
    (sum, message) => sum + utf8Bytes(message.plainText) + utf8Bytes(message.markdown ?? ''),
    0
  );

  return {
    conversations,
    messages,
    events,
    projects,
    totalRecords: conversations.count + messages.count + events.count + projects.count,
    estimatedJsonBytes:
      conversations.estimatedJsonBytes +
      messages.estimatedJsonBytes +
      events.estimatedJsonBytes +
      projects.estimatedJsonBytes,
    messageTextBytes
  };
}
