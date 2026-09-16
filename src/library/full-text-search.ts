import { conversationDisplayTitle } from '../storage/conversation';
import type { ArchiveMessage } from '../storage/schema';
import type { LibraryRecord } from './search';

export type LibrarySearchField =
  | 'title'
  | 'provider'
  | 'project'
  | 'folder'
  | 'tag'
  | 'message';

export interface LibrarySearchResult {
  kind: 'conversation' | 'message';
  conversationId: string;
  messageId?: string;
  field: LibrarySearchField;
  score: number;
  title: string;
  snippet: string;
  updatedAt: string;
  orderHint: number;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

function queryTokens(query: string): string[] {
  return normalize(query).split(' ').filter(Boolean);
}

function containsEveryToken(value: string, tokens: string[]): boolean {
  const haystack = normalize(value);
  return tokens.every((token) => haystack.includes(token));
}

function snippet(value: string, query: string, radius = 72): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  const normalizedValue = compact.toLocaleLowerCase();
  const tokens = queryTokens(query);
  const firstIndex =
    tokens
      .map((token) => normalizedValue.indexOf(token))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, firstIndex - radius);
  const end = Math.min(compact.length, firstIndex + radius);
  return `${start > 0 ? '…' : ''}${compact.slice(start, end)}${end < compact.length ? '…' : ''}`;
}

function conversationResult(
  record: LibraryRecord,
  field: Exclude<LibrarySearchField, 'message'>,
  score: number,
  matchedValue: string
): LibrarySearchResult {
  const conversation = record.conversation;
  return {
    kind: 'conversation',
    conversationId: conversation.id,
    field,
    score,
    title: conversationDisplayTitle(conversation),
    snippet: matchedValue,
    updatedAt: conversation.updatedAt,
    orderHint: -1
  };
}

function metadataResult(record: LibraryRecord, query: string): LibrarySearchResult | null {
  const tokens = queryTokens(query);
  if (!tokens.length) return null;

  const conversation = record.conversation;
  const project = record.project;
  const folder = project?.folders.find((entry) => entry.id === conversation.folderId);
  const title = conversationDisplayTitle(conversation);

  if (containsEveryToken(title, tokens)) {
    return conversationResult(record, 'title', 100, title);
  }
  if (containsEveryToken(conversation.providerId, tokens)) {
    return conversationResult(record, 'provider', 90, conversation.providerId);
  }
  if (
    conversation.providerConversationId &&
    containsEveryToken(conversation.providerConversationId, tokens)
  ) {
    return conversationResult(record, 'provider', 88, conversation.providerConversationId);
  }

  const projectLabel = project?.name ?? 'Unsorted';
  if (containsEveryToken(projectLabel, tokens)) {
    return conversationResult(record, 'project', 80, projectLabel);
  }
  if (folder && containsEveryToken(folder.name, tokens)) {
    return conversationResult(record, 'folder', 75, folder.name);
  }
  for (const tag of conversation.tags ?? []) {
    if (containsEveryToken(tag, tokens)) {
      return conversationResult(record, 'tag', 70, tag);
    }
  }

  return null;
}

function messageResult(
  record: LibraryRecord,
  message: ArchiveMessage,
  query: string
): LibrarySearchResult | null {
  const tokens = queryTokens(query);
  if (!tokens.length || !containsEveryToken(message.plainText, tokens)) return null;
  return {
    kind: 'message',
    conversationId: record.conversation.id,
    messageId: message.id,
    field: 'message',
    score: 50,
    title: conversationDisplayTitle(record.conversation),
    snippet: snippet(message.plainText, query),
    updatedAt: record.conversation.updatedAt,
    orderHint: message.orderHint
  };
}

export function searchLibraryRecords(
  records: LibraryRecord[],
  query: string
): LibrarySearchResult[] {
  const tokens = queryTokens(query);
  if (!tokens.length) return [];

  const results: LibrarySearchResult[] = [];
  for (const record of records) {
    const metadata = metadataResult(record, query);
    if (metadata) results.push(metadata);
    for (const message of record.messages) {
      const result = messageResult(record, message, query);
      if (result) results.push(result);
    }
  }

  return results.sort(
    (a, b) =>
      b.score - a.score ||
      b.updatedAt.localeCompare(a.updatedAt) ||
      a.conversationId.localeCompare(b.conversationId) ||
      a.orderHint - b.orderHint ||
      (a.messageId ?? '').localeCompare(b.messageId ?? '')
  );
}
