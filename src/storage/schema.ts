import type { ProviderId, RecorderState, TurnRole } from '../shared/types';

export const ARCHIVE_DB_NAME = 'llm-chat-history';
export const ARCHIVE_DB_VERSION = 2;

export const STORES = {
  conversations: 'conversations',
  messages: 'messages',
  events: 'events',
  projects: 'projects'
} as const;

export const INDEXES = {
  conversations: {
    providerKey: 'by_provider_key',
    provisionalKey: 'by_provisional_key',
    updatedAt: 'by_updated_at'
  },
  messages: {
    conversationOrder: 'by_conversation_order',
    providerTurn: 'by_provider_turn',
    conversationUpdatedAt: 'by_conversation_updated_at'
  },
  events: {
    conversationTime: 'by_conversation_time',
    typeTime: 'by_type_time'
  },
  projects: {
    name: 'by_name'
  }
} as const;

export interface ArchiveConversation {
  id: string;
  providerId: ProviderId;
  providerConversationId: string | null;
  providerKey?: string;
  provisionalKey?: string;
  provisional: boolean;
  sourceUrl: string;
  title: string | null;
  customTitle?: string;
  archivedAt?: string;
  projectId?: string;
  folderId?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  lastObservedAt: string;
  messageCount: number;
  recordingState: RecorderState;
  recordingStateUpdatedAt: string;
}

export interface ArchiveProjectFolder {
  id: string;
  name: string;
}

export interface ArchiveProject {
  id: string;
  name: string;
  folders: ArchiveProjectFolder[];
  createdAt: string;
  updatedAt: string;
}

export interface ArchiveMessage {
  id: string;
  conversationId: string;
  providerId: ProviderId;
  providerTurnId: string;
  providerMessageId: string | null;
  role: TurnRole;
  orderHint: number;
  plainText: string;
  markdown: string | null;
  partial: boolean;
  /** Provider model label only when that label was visibly rendered in the provider UI. */
  modelLabel?: string | null;
  contentHash: string;
  firstObservedAt: string;
  lastObservedAt: string;
  updatedAt: string;
}

export type ArchiveEventType =
  | 'conversation-created'
  | 'conversation-identified'
  | 'title-changed'
  | 'message-added'
  | 'message-updated'
  | 'message-finalized'
  | 'recording-started'
  | 'recording-paused'
  | 'recording-resumed'
  | 'recording-stopped'
  | 'turn-suppressed'
  | 'checkpoint'
  | 'adapter-health';

export interface ArchiveEvent {
  id: string;
  conversationId: string | null;
  type: ArchiveEventType;
  createdAt: string;
  data: Record<string, string | number | boolean | null>;
}
