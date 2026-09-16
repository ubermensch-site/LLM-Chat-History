import type { ArchiveRepository } from '../storage/archive';
import { listProjects } from '../storage/projects';
import { getStoredDirectoryHandle } from './connection';
import { getStoredMirrorLocation, storeMirrorLocation } from './mirror-state';
import type { MirrorRuntimeStatus } from './status';
import { queryMirrorWritePermission, writeConversationMirror } from './writer';

export interface MirrorConversationOptions {
  repository: ArchiveRepository;
  archiveDb: IDBDatabase;
  settingsDb: IDBDatabase;
  conversationId: string;
  now?: () => string;
}

export async function mirrorConversationLatest(
  options: MirrorConversationOptions
): Promise<MirrorRuntimeStatus> {
  const now = options.now ?? (() => new Date().toISOString());
  const updatedAt = now();
  let handle: FileSystemDirectoryHandle | null = null;

  try {
    handle = await getStoredDirectoryHandle(options.settingsDb);
    if (!handle) {
      return {
        state: 'disconnected',
        folderName: null,
        conversationId: options.conversationId,
        path: null,
        detail: 'No computer folder is connected.',
        updatedAt
      };
    }

    const permission = await queryMirrorWritePermission(handle);
    if (permission === 'prompt') {
      return {
        state: 'permission-needed',
        folderName: handle.name,
        conversationId: options.conversationId,
        path: null,
        detail: 'Folder access needs to be granted again from the Library.',
        updatedAt
      };
    }
    if (permission === 'denied') {
      return {
        state: 'denied',
        folderName: handle.name,
        conversationId: options.conversationId,
        path: null,
        detail: 'Folder access is denied. Reconnect from the Library.',
        updatedAt
      };
    }

    const conversations = await options.repository.listConversations();
    const conversation = conversations.find((entry) => entry.id === options.conversationId);
    if (!conversation) {
      return {
        state: 'error',
        folderName: handle.name,
        conversationId: options.conversationId,
        path: null,
        detail: 'Conversation disappeared before mirror generation.',
        updatedAt
      };
    }

    const [messages, events, projects, previous] = await Promise.all([
      options.repository.listMessages(conversation.id),
      options.repository.listEvents(conversation.id),
      listProjects(options.archiveDb),
      getStoredMirrorLocation(options.settingsDb, conversation.id)
    ]);
    const project = conversation.projectId
      ? projects.find((entry) => entry.id === conversation.projectId)
      : undefined;

    const result = await writeConversationMirror(
      handle,
      {
        conversation,
        messages,
        events,
        ...(project ? { project } : {}),
        exportedAt: updatedAt
      },
      previous,
      updatedAt
    );

    try {
      await storeMirrorLocation(options.settingsDb, result.location);
    } catch (error) {
      return {
        state: 'degraded',
        folderName: handle.name,
        conversationId: conversation.id,
        path: result.location.current.join('/'),
        detail: `Mirror file updated, but location tracking failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        updatedAt
      };
    }

    return {
      state: result.state === 'written' ? 'healthy' : 'degraded',
      folderName: handle.name,
      conversationId: conversation.id,
      path: result.location.current.join('/'),
      detail: result.detail,
      updatedAt
    };
  } catch (error) {
    return {
      state: 'error',
      folderName: handle?.name ?? null,
      conversationId: options.conversationId,
      path: null,
      detail: error instanceof Error ? error.message : String(error),
      updatedAt
    };
  }
}
