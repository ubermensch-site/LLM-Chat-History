import { conversationDisplayTitle } from '../storage/conversation';
import type { ArchiveConversation, ArchiveProject } from '../storage/schema';

export const MIRROR_ROOT_DIRECTORY = 'LLM Chat History';
export const MIRROR_UNSORTED_DIRECTORY = 'Unsorted';
export const MAX_DIRECTORY_SEGMENT_LENGTH = 80;
export const MAX_TITLE_SLUG_LENGTH = 72;
export const MAX_MIRROR_FILENAME_LENGTH = 180;

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function asciiWords(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/[. ]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function safeDirectorySegment(value: string, fallback = 'Untitled'): string {
  let result = asciiWords(value)
    .replace(/[^A-Za-z0-9 _.-]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .trim();

  if (!result || result === '.' || result === '..') result = fallback;
  if (WINDOWS_RESERVED_NAMES.test(result)) result = `_${result}`;
  result = result.slice(0, MAX_DIRECTORY_SEGMENT_LENGTH).replace(/[. ]+$/g, '').trim();
  return result || fallback;
}

export function safeFilenameSlug(value: string, fallback = 'untitled-conversation'): string {
  let result = asciiWords(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_TITLE_SLUG_LENGTH)
    .replace(/-+$/g, '');

  if (!result) result = fallback;
  if (WINDOWS_RESERVED_NAMES.test(result)) result = `_${result}`;
  return result;
}

export function stableConversationToken(conversation: Pick<ArchiveConversation, 'id'>): string {
  const readable = conversation.id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-24)
    .replace(/^-+|-+$/g, '');
  const hash = fnv1a32(conversation.id);
  return `c-${readable || 'conversation'}-${hash}`;
}

export function conversationCreationMonth(createdAt: string): string {
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid conversation creation timestamp: ${createdAt}`);
  return date.toISOString().slice(0, 7);
}

export function mirrorTimestamp(createdAt: string): string {
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid conversation creation timestamp: ${createdAt}`);
  return date.toISOString().replace(/[:.]/g, '-');
}

export function mirrorProjectDirectory(project: ArchiveProject | null | undefined): string {
  return project ? safeDirectorySegment(project.name, 'Project') : MIRROR_UNSORTED_DIRECTORY;
}

export function mirrorFilename(
  conversation: ArchiveConversation,
  extension: 'md' | 'json' = 'md'
): string {
  const timestamp = mirrorTimestamp(conversation.createdAt);
  const provider = safeFilenameSlug(conversation.providerId, 'provider');
  const title = safeFilenameSlug(
    conversationDisplayTitle(conversation, 'untitled-conversation'),
    'untitled-conversation'
  );
  const token = stableConversationToken(conversation);
  const suffix = `--${token}.${extension}`;
  const prefix = `${timestamp}__${provider}__`;
  const maxTitleLength = Math.max(1, MAX_MIRROR_FILENAME_LENGTH - prefix.length - suffix.length);
  const boundedTitle = title.slice(0, maxTitleLength).replace(/-+$/g, '') || 'untitled';
  return `${prefix}${boundedTitle}${suffix}`;
}

export interface MirrorPath {
  root: typeof MIRROR_ROOT_DIRECTORY;
  project: string;
  month: string;
  filename: string;
  segments: [typeof MIRROR_ROOT_DIRECTORY, string, string, string];
}

export function mirrorPath(
  conversation: ArchiveConversation,
  project: ArchiveProject | null | undefined,
  extension: 'md' | 'json' = 'md'
): MirrorPath {
  const projectDirectory = mirrorProjectDirectory(project);
  const month = conversationCreationMonth(conversation.createdAt);
  const filename = mirrorFilename(conversation, extension);
  return {
    root: MIRROR_ROOT_DIRECTORY,
    project: projectDirectory,
    month,
    filename,
    segments: [MIRROR_ROOT_DIRECTORY, projectDirectory, month, filename]
  };
}

export function filenameBelongsToConversation(
  filename: string,
  conversation: Pick<ArchiveConversation, 'id'>
): boolean {
  const token = stableConversationToken(conversation);
  return filename.endsWith(`--${token}.md`) || filename.endsWith(`--${token}.json`);
}
