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
  const firstIndex = tokens
    .map((token) => normalizedValue.indexOf(token))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, firstIndex - radius);
  const end = Math.min(compact.length, firstIndex + radius);
  return `${start > 0 ? '…' : ''}${compact.slice(start, end)}${end < compact.length ? '…' : ''}`;
}

function metadataResult(record: LibraryRecord, query: string): LibrarySearchResult | null {
  const tokens = queryTokens(query);
  if (!tokens.length) return null;

  const conversation = record.conversation;
  const project = record.project;
  const folder = project?.folders.find((entry) => entry.id === conversation.folderId);
  const title = conversationDisplayTitle(conversation);
  const candidates: Array<{ field: LibrarySearchField; value: string; score: number }> = [
    { field: 'title', value: title, score: 100 },
    { field: 'provider', value: conversation.providerId, score: 90 },
    { field: 'provider', value: conversation.providerConversationId ?? '', score: 88 },
    { field: 'project', value: project?.name ?? 'Unsorted', score: 80 },
    { field: 'folder', value: folder?.name ?? '', score: 75 },
    ...(conversation.tags ?? []).map((tag) => ({ field: 'tag' as const, value: tag, score: 70 }))
  ];

  const match = candidates.find((candidate) => containsEveryToken(candidate.value, tokens));
  if (!match) return null;

  return {
    kind: 'conversation',
    conversationId: conversation.id,
    field: match.field,
    score: match.score,
    title,
    snippet: match.value,
    updatedAt: conversation.updatedAt,
    orderHint: -1
  };
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
