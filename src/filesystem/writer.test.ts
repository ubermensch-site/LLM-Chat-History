import { describe, expect, it } from 'vitest';
import type { ArchiveExportBundle } from '../export/export';
import type { ArchiveConversation, ArchiveProject } from '../storage/schema';
import { mirrorPath } from './layout';
import type { StoredMirrorLocation } from './mirror-state';
import {
  CoalescingMirrorQueue,
  queryMirrorWritePermission,
  writeConversationMirror
} from './writer';

interface FileNode {
  contents: string;
  failWrite: boolean;
}

class MemoryFs {
  readonly operations: string[] = [];
  readonly files = new Map<string, FileNode>();
  readonly directories = new Set<string>(['']);
  readonly cleanupFailures = new Set<string>();

  directory(path: string[] = []): FileSystemDirectoryHandle {
    return new MemoryDirectoryHandle(this, path) as unknown as FileSystemDirectoryHandle;
  }

  key(path: readonly string[]): string {
    return path.join('/');
  }

  seed(path: readonly string[], contents: string): void {
    for (let index = 1; index < path.length; index += 1) {
      this.directories.add(this.key(path.slice(0, index)));
    }
    this.files.set(this.key(path), { contents, failWrite: false });
  }

  text(path: readonly string[]): string | undefined {
    return this.files.get(this.key(path))?.contents;
  }
}

class MemoryDirectoryHandle {
  readonly kind = 'directory';
  readonly name: string;

  constructor(
    private readonly fs: MemoryFs,
    private readonly path: string[]
  ) {
    this.name = path.at(-1) ?? 'root';
  }

  async queryPermission(): Promise<'granted'> {
    return 'granted';
  }

  async requestPermission(): Promise<'granted'> {
    throw new Error('requestPermission must not be used by background mirror writes');
  }

  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<FileSystemDirectoryHandle> {
    const child = [...this.path, name];
    const key = this.fs.key(child);
    if (!this.fs.directories.has(key)) {
      if (!options?.create) throw new DOMException('Missing directory', 'NotFoundError');
      this.fs.directories.add(key);
      this.fs.operations.push(`mkdir:${key}`);
    }
    return new MemoryDirectoryHandle(this.fs, child) as unknown as FileSystemDirectoryHandle;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle> {
    const path = [...this.path, name];
    const key = this.fs.key(path);
    if (!this.fs.files.has(key)) {
      if (!options?.create) throw new DOMException('Missing file', 'NotFoundError');
      this.fs.files.set(key, { contents: '', failWrite: false });
      this.fs.operations.push(`create:${key}`);
    }
    return new MemoryFileHandle(this.fs, path) as unknown as FileSystemFileHandle;
  }

  async removeEntry(name: string): Promise<void> {
    const key = this.fs.key([...this.path, name]);
    this.fs.operations.push(`remove:${key}`);
    if (this.fs.cleanupFailures.has(key)) throw new Error('simulated cleanup failure');
    if (!this.fs.files.delete(key)) throw new DOMException('Missing file', 'NotFoundError');
  }
}

class MemoryFileHandle {
  readonly kind = 'file';
  readonly name: string;

  constructor(
    private readonly fs: MemoryFs,
    private readonly path: string[]
  ) {
    this.name = path.at(-1) ?? 'file';
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    const key = this.fs.key(this.path);
    const node = this.fs.files.get(key);
    if (!node) throw new DOMException('Missing file', 'NotFoundError');
    this.fs.operations.push(`open:${key}`);
    let draft = '';
    let closed = false;
    const stream = {
      write: async (data: string) => {
        this.fs.operations.push(`write:${key}`);
        if (node.failWrite) throw new Error('simulated write failure');
        draft = data;
      },
      close: async () => {
        this.fs.operations.push(`close:${key}`);
        node.contents = draft;
        closed = true;
      },
      abort: async () => {
        this.fs.operations.push(`abort:${key}`);
      },
      get locked() {
        return closed;
      }
    };
    return stream as unknown as FileSystemWritableFileStream;
  }
}

function conversation(overrides: Partial<ArchiveConversation> = {}): ArchiveConversation {
  return {
    id: 'conv:chatgpt:mirror-writer-test',
    providerId: 'chatgpt',
    providerConversationId: 'mirror-writer-test',
    providerKey: 'chatgpt:mirror-writer-test',
    provisional: false,
    sourceUrl: 'https://chatgpt.com/c/mirror-writer-test',
    title: 'Initial mirror title',
    createdAt: '2026-09-16T10:00:00.000Z',
    updatedAt: '2026-09-16T10:05:00.000Z',
    lastObservedAt: '2026-09-16T10:05:00.000Z',
    messageCount: 0,
    recordingState: 'recording',
    recordingStateUpdatedAt: '2026-09-16T10:00:00.000Z',
    ...overrides
  };
}

function project(name = 'Research'): ArchiveProject {
  return {
    id: 'project:research',
    name,
    folders: [],
    createdAt: '2026-09-16T09:00:00.000Z',
    updatedAt: '2026-09-16T09:00:00.000Z'
  };
}

function bundle(chat = conversation(), assignedProject: ArchiveProject | null = project()): ArchiveExportBundle {
  return {
    conversation: chat,
    messages: [],
    events: [],
    project: assignedProject,
    exportedAt: '2026-09-16T10:06:00.000Z'
  };
}

function locationFor(chat: ArchiveConversation, assignedProject: ArchiveProject | null): StoredMirrorLocation {
  return {
    conversationId: chat.id,
    current: mirrorPath(chat, assignedProject).segments,
    stale: [],
    mirroredAt: '2026-09-16T10:06:00.000Z'
  };
}

describe('safe filesystem mirror writer', () => {
  it('writes Markdown to the deterministic mirror path', async () => {
    const fs = new MemoryFs();
    const input = bundle();
    const result = await writeConversationMirror(
      fs.directory(),
      input,
      null,
      '2026-09-16T10:07:00.000Z'
    );

    expect(result.state).toBe('written');
    expect(fs.text(result.location.current)).toContain('# Initial mirror title');
    expect(result.location.current).toEqual(mirrorPath(input.conversation, input.project).segments);
    expect(result.location.stale).toEqual([]);
  });

  it('closes the replacement before removing the prior title path', async () => {
    const fs = new MemoryFs();
    const before = conversation({ customTitle: 'Old title' });
    const previous = locationFor(before, project());
    fs.seed(previous.current, 'old mirror');

    const after = conversation({ customTitle: 'New title' });
    const result = await writeConversationMirror(fs.directory(), bundle(after), previous);
    const replacement = result.location.current;
    const closeIndex = fs.operations.indexOf(`close:${fs.key(replacement)}`);
    const removeIndex = fs.operations.indexOf(`remove:${fs.key(previous.current)}`);

    expect(closeIndex).toBeGreaterThanOrEqual(0);
    expect(removeIndex).toBeGreaterThan(closeIndex);
    expect(fs.text(previous.current)).toBeUndefined();
    expect(fs.text(replacement)).toContain('# New title');
  });

  it('keeps the prior mirror when replacement writing fails', async () => {
    const fs = new MemoryFs();
    const before = conversation({ customTitle: 'Old title' });
    const previous = locationFor(before, project());
    fs.seed(previous.current, 'old mirror');

    const after = conversation({ customTitle: 'New title' });
    const nextPath = mirrorPath(after, project()).segments;
    fs.seed(nextPath, 'placeholder');
    fs.files.get(fs.key(nextPath))!.failWrite = true;

    await expect(writeConversationMirror(fs.directory(), bundle(after), previous)).rejects.toThrow(
      'simulated write failure'
    );
    expect(fs.text(previous.current)).toBe('old mirror');
    expect(fs.operations).not.toContain(`remove:${fs.key(previous.current)}`);
  });

  it('retains failed stale cleanup paths for a later retry', async () => {
    const fs = new MemoryFs();
    const before = conversation({ customTitle: 'Old title' });
    const previous = locationFor(before, project('Old Project'));
    fs.seed(previous.current, 'old mirror');
    fs.cleanupFailures.add(fs.key(previous.current));

    const after = conversation({ customTitle: 'New title' });
    const result = await writeConversationMirror(fs.directory(), bundle(after, project('New Project')), previous);

    expect(result.state).toBe('degraded');
    expect(result.location.stale).toEqual([previous.current]);
    expect(fs.text(result.location.current)).toContain('# New title');
    expect(fs.text(previous.current)).toBe('old mirror');
  });

  it('queries permission without ever requesting it', async () => {
    let requested = 0;
    const handle = {
      queryPermission: async () => 'prompt',
      requestPermission: async () => {
        requested += 1;
        return 'granted';
      }
    } as unknown as FileSystemDirectoryHandle;
    expect(await queryMirrorWritePermission(handle)).toBe('prompt');
    expect(requested).toBe(0);
  });
});

describe('coalescing mirror queue', () => {
  it('coalesces a burst to only the newest pending snapshot', async () => {
    const queue = new CoalescingMirrorQueue();
    const calls: string[] = [];
    const first = queue.enqueue('conv', async () => {
      calls.push('first');
    });
    const second = queue.enqueue('conv', async () => {
      calls.push('second');
    });
    const third = queue.enqueue('conv', async () => {
      calls.push('third');
    });
    await Promise.all([first, second, third]);
    expect(calls).toEqual(['third']);
  });

  it('keeps the current write and coalesces updates arriving while it is running', async () => {
    const queue = new CoalescingMirrorQueue();
    const calls: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const running = queue.enqueue('conv', async () => {
      calls.push('first');
      await gate;
    });
    await Promise.resolve();
    const second = queue.enqueue('conv', async () => {
      calls.push('second');
    });
    const third = queue.enqueue('conv', async () => {
      calls.push('third');
    });
    release();
    await Promise.all([running, second, third]);
    expect(calls).toEqual(['first', 'third']);
  });
});
