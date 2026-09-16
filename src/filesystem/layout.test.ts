import { describe, expect, it } from 'vitest';
import type { ArchiveConversation, ArchiveProject } from '../storage/schema';
import {
  MAX_DIRECTORY_SEGMENT_LENGTH,
  MAX_MIRROR_FILENAME_LENGTH,
  MIRROR_ROOT_DIRECTORY,
  MIRROR_UNSORTED_DIRECTORY,
  conversationCreationMonth,
  filenameBelongsToConversation,
  mirrorFilename,
  mirrorPath,
  safeDirectorySegment,
  safeFilenameSlug,
  stableConversationToken
} from './layout';

function conversation(overrides: Partial<ArchiveConversation> = {}): ArchiveConversation {
  return {
    id: 'conv:chatgpt:12345678-1234-1234-1234-123456789abc',
    providerId: 'chatgpt',
    providerConversationId: 'provider-layout',
    providerKey: 'chatgpt:provider-layout',
    provisional: false,
    sourceUrl: 'https://chatgpt.com/c/provider-layout',
    title: 'Sabpuja Shopify Rebuild',
    createdAt: '2026-09-16T23:59:58.123Z',
    updatedAt: '2026-09-16T23:59:58.123Z',
    lastObservedAt: '2026-09-16T23:59:58.123Z',
    messageCount: 0,
    recordingState: 'recording',
    recordingStateUpdatedAt: '2026-09-16T23:59:58.123Z',
    ...overrides
  };
}

const project: ArchiveProject = {
  id: 'project:sabpuja',
  name: 'Sab Puja / Store: Launch',
  folders: [],
  createdAt: '2026-09-16T00:00:00.000Z',
  updatedAt: '2026-09-16T00:00:00.000Z'
};

describe('deterministic filesystem layout', () => {
  it('builds a deterministic root/project/month/filename path', () => {
    const chat = conversation();
    const first = mirrorPath(chat, project);
    const second = mirrorPath(chat, project);

    expect(first).toEqual(second);
    expect(first.root).toBe(MIRROR_ROOT_DIRECTORY);
    expect(first.project).toBe('Sab Puja Store- Launch');
    expect(first.month).toBe('2026-09');
    expect(first.filename).toMatch(
      /^2026-09-16T23-59-58-123Z__chatgpt__sabpuja-shopify-rebuild--c-[a-z0-9-]+-[0-9a-f]{8}\.md$/
    );
    expect(first.segments).toEqual([
      'LLM Chat History',
      'Sab Puja Store- Launch',
      '2026-09',
      first.filename
    ]);
  });

  it('uses Unsorted when no project is assigned', () => {
    expect(mirrorPath(conversation(), undefined).project).toBe(MIRROR_UNSORTED_DIRECTORY);
    expect(mirrorPath(conversation(), null).segments[1]).toBe('Unsorted');
  });

  it('keeps identity matching stable when only the title changes', () => {
    const before = conversation({ customTitle: 'Sabpuja Shopify Rebuild' });
    const after = conversation({ customTitle: 'Sabpuja Production Launch' });
    const beforeName = mirrorFilename(before);
    const afterName = mirrorFilename(after);

    expect(beforeName).not.toBe(afterName);
    expect(stableConversationToken(before)).toBe(stableConversationToken(after));
    expect(filenameBelongsToConversation(beforeName, after)).toBe(true);
    expect(filenameBelongsToConversation(afterName, before)).toBe(true);
  });

  it('does not match a different conversation that shares title and timestamp', () => {
    const first = conversation();
    const second = conversation({ id: 'conv:chatgpt:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });
    expect(filenameBelongsToConversation(mirrorFilename(first), second)).toBe(false);
  });

  it('normalizes path separators, control characters and Windows reserved names', () => {
    expect(safeDirectorySegment('  CON  ')).toBe('_CON');
    expect(safeDirectorySegment('Project/Alpha\\Beta:*?')).toBe('Project Alpha Beta-');
    expect(safeFilenameSlug('NUL')).toBe('_nul');
    expect(safeFilenameSlug('A/B\\C:*?<>|')).toBe('a-b-c');

    const long = safeDirectorySegment('x'.repeat(200));
    expect(long).toHaveLength(MAX_DIRECTORY_SEGMENT_LENGTH);
    expect(long).not.toMatch(/[\\/]/);
  });

  it('bounds the complete filename while retaining its stable identity suffix', () => {
    const chat = conversation({ customTitle: 'Very long title '.repeat(80) });
    const filename = mirrorFilename(chat);
    expect(filename.length).toBeLessThanOrEqual(MAX_MIRROR_FILENAME_LENGTH);
    expect(filenameBelongsToConversation(filename, chat)).toBe(true);
  });

  it('derives month and filename timestamp from UTC rather than local timezone', () => {
    const chat = conversation({ createdAt: '2026-10-01T00:15:00+05:30' });
    expect(conversationCreationMonth(chat.createdAt)).toBe('2026-09');
    expect(mirrorFilename(chat)).toMatch(/^2026-09-30T18-45-00-000Z__/);
  });

  it('rejects invalid creation timestamps rather than producing unstable paths', () => {
    expect(() => conversationCreationMonth('not-a-date')).toThrow(/Invalid conversation creation timestamp/);
    expect(() => mirrorFilename(conversation({ createdAt: 'not-a-date' }))).toThrow(
      /Invalid conversation creation timestamp/
    );
  });
});
