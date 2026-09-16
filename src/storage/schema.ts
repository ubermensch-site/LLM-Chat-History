import type { ProviderId, TurnRole } from '../shared/types';

export const ARCHIVE_DB_NAME = 'llm-chat-history';
export const ARCHIVE_DB_VERSION = 1;

export const STORES = {
  conversations: 'conversations',
  messages: 'messages',
  events: 'events'
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
  createdAt: string;
  updatedAt: string;
  lastObservedAt: string;
  messageCount: number;
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
  | 'adapter-health';

export interface ArchiveEvent {
  id: string;
  conversationId: string | null;
  type: ArchiveEventType;
  createdAt: string;
  data: Record<string, string | number | boolean | null>;
}
