import { renderMarkdownExport, type ArchiveExportBundle } from '../export/export';
import { mirrorPath } from './layout';
import type { StoredMirrorLocation } from './mirror-state';

export type WritePermissionState = 'granted' | 'prompt' | 'denied';

interface PermissionCapableDirectoryHandle extends FileSystemDirectoryHandle {
  queryPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<WritePermissionState>;
}

export interface MirrorWriteResult {
  state: 'written' | 'degraded';
  location: StoredMirrorLocation;
  detail: string | null;
}

function pathKey(path: readonly string[]): string {
  return JSON.stringify(path);
}

function pathLabel(path: readonly string[]): string {
  return path.join('/');
}

export async function queryMirrorWritePermission(
  handle: FileSystemDirectoryHandle
): Promise<WritePermissionState> {
  return (handle as PermissionCapableDirectoryHandle).queryPermission({ mode: 'readwrite' });
}

async function ensureDirectory(
  root: FileSystemDirectoryHandle,
  segments: readonly string[]
): Promise<FileSystemDirectoryHandle> {
  let current = root;
  for (const segment of segments) {
    current = await current.getDirectoryHandle(segment, { create: true });
  }
  return current;
}

async function existingDirectory(
  root: FileSystemDirectoryHandle,
  segments: readonly string[]
): Promise<FileSystemDirectoryHandle | null> {
  let current = root;
  try {
    for (const segment of segments) {
      current = await current.getDirectoryHandle(segment);
    }
    return current;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null;
    throw error;
  }
}

async function writeFileSafely(
  directory: FileSystemDirectoryHandle,
  filename: string,
  contents: string
): Promise<void> {
  const file = await directory.getFileHandle(filename, { create: true });
  const writable = await file.createWritable();
  try {
    await writable.write(contents);
    await writable.close();
  } catch (error) {
    try {
      await writable.abort(error);
    } catch {
      // The stream may already be closed/errored. Preserve the original write failure.
    }
    throw error;
  }
}

async function removeMirrorFile(
  root: FileSystemDirectoryHandle,
  path: readonly [string, string, string, string]
): Promise<void> {
  const directory = await existingDirectory(root, path.slice(0, 3));
  if (!directory) return;
  try {
    await directory.removeEntry(path[3]);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return;
    throw error;
  }
}

export async function writeConversationMirror(
  root: FileSystemDirectoryHandle,
  bundle: ArchiveExportBundle,
  previous: StoredMirrorLocation | null,
  mirroredAt = new Date().toISOString()
): Promise<MirrorWriteResult> {
  const target = mirrorPath(bundle.conversation, bundle.project ?? undefined, 'md');
  const nextPath = target.segments;
  const directory = await ensureDirectory(root, nextPath.slice(0, 3));
  const markdown = renderMarkdownExport(bundle);

  // createWritable() writes through the browser's swap/temporary-file path and only
  // replaces the destination after close(), so never delete the prior mirror first.
  await writeFileSafely(directory, nextPath[3], markdown);

  const cleanup = new Map<string, [string, string, string, string]>();
  if (previous && pathKey(previous.current) !== pathKey(nextPath)) {
    cleanup.set(pathKey(previous.current), previous.current);
  }
  for (const stale of previous?.stale ?? []) {
    if (pathKey(stale) !== pathKey(nextPath)) cleanup.set(pathKey(stale), stale);
  }

  const failedCleanup: Array<[string, string, string, string]> = [];
  const failures: string[] = [];
  for (const stale of cleanup.values()) {
    try {
      await removeMirrorFile(root, stale);
    } catch (error) {
      failedCleanup.push(stale);
      failures.push(
        `${pathLabel(stale)}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const location: StoredMirrorLocation = {
    conversationId: bundle.conversation.id,
    current: nextPath,
    stale: failedCleanup,
    mirroredAt
  };

  return failures.length
    ? {
        state: 'degraded',
        location,
        detail: `Mirror updated, but stale file cleanup failed: ${failures.join('; ')}`
      }
    : { state: 'written', location, detail: null };
}

export class CoalescingMirrorQueue {
  private readonly entries = new Map<
    string,
    {
      pending: (() => Promise<void>) | null;
      running: Promise<void>;
    }
  >();

  enqueue(key: string, task: () => Promise<void>): Promise<void> {
    const existing = this.entries.get(key);
    if (existing) {
      existing.pending = task;
      return existing.running;
    }

    const entry: {
      pending: (() => Promise<void>) | null;
      running: Promise<void>;
    } = {
      pending: task,
      running: Promise.resolve()
    };

    entry.running = Promise.resolve()
      .then(async () => {
        let lastError: unknown = null;
        while (entry.pending) {
          const current = entry.pending;
          entry.pending = null;
          try {
            await current();
            lastError = null;
          } catch (error) {
            lastError = error;
          }
        }
        if (lastError) throw lastError;
      })
      .finally(() => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
      });

    this.entries.set(key, entry);
    return entry.running;
  }
}
