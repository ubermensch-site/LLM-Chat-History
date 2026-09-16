import {
  ARCHIVE_EXPORT_SCHEMA,
  ARCHIVE_EXPORT_SCHEMA_VERSION,
  type ArchiveExportBundle
} from '../export/export';
import { messageId, providerConversationKey } from '../storage/ids';
import type {
  ArchiveConversation,
  ArchiveEvent,
  ArchiveEventType,
  ArchiveMessage
} from '../storage/schema';

const EVENT_TYPES = new Set<ArchiveEventType>([
  'conversation-created',
  'conversation-identified',
  'title-changed',
  'message-added',
  'message-updated',
  'message-finalized',
  'recording-started',
  'recording-paused',
  'recording-resumed',
  'recording-stopped',
  'turn-suppressed',
  'adapter-health'
]);

const RECORDER_STATES = new Set(['recording', 'paused', 'stopped', 'error']);
const ROLES = new Set(['user', 'assistant']);

export class ArchiveImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveImportValidationError';
  }
}

function fail(path: string, message: string): never {
  throw new ArchiveImportValidationError(`${path}: ${message}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'expected an object');
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(path, 'expected a non-empty string');
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  return stringValue(value, path);
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return stringValue(value, path);
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'expected a boolean');
  return value;
}

function integerValue(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail(path, 'expected a non-negative safe integer');
  }
  return value;
}

function timestamp(value: unknown, path: string): string {
  const result = stringValue(value, path);
  if (!Number.isFinite(Date.parse(result))) fail(path, 'expected a valid timestamp');
  return result;
}

function providerId(value: unknown, path: string): 'chatgpt' {
  if (value !== 'chatgpt') fail(path, 'unsupported provider');
  return value;
}

function dataRecord(value: unknown, path: string): ArchiveEvent['data'] {
  const source = record(value, path);
  const result: ArchiveEvent['data'] = {};
  for (const [key, entry] of Object.entries(source)) {
    if (
      entry !== null &&
      typeof entry !== 'string' &&
      typeof entry !== 'number' &&
      typeof entry !== 'boolean'
    ) {
      fail(`${path}.${key}`, 'event data must contain only primitive values');
    }
    result[key] = entry as string | number | boolean | null;
  }
  return result;
}

function parseConversation(value: unknown): ArchiveConversation {
  const input = record(value, 'conversation');
  const conversation: ArchiveConversation = {
    id: stringValue(input.id, 'conversation.id'),
    providerId: providerId(input.providerId, 'conversation.providerId'),
    providerConversationId: nullableString(
      input.providerConversationId,
      'conversation.providerConversationId'
    ),
    provisional: booleanValue(input.provisional, 'conversation.provisional'),
    sourceUrl: stringValue(input.sourceUrl, 'conversation.sourceUrl'),
    title: nullableString(input.title, 'conversation.title'),
    createdAt: timestamp(input.createdAt, 'conversation.createdAt'),
    updatedAt: timestamp(input.updatedAt, 'conversation.updatedAt'),
    lastObservedAt: timestamp(input.lastObservedAt, 'conversation.lastObservedAt'),
    messageCount: integerValue(input.messageCount, 'conversation.messageCount'),
    recordingState: stringValue(
      input.recordingState,
      'conversation.recordingState'
    ) as ArchiveConversation['recordingState'],
    recordingStateUpdatedAt: timestamp(
      input.recordingStateUpdatedAt,
      'conversation.recordingStateUpdatedAt'
    )
  };

  if (!RECORDER_STATES.has(conversation.recordingState)) {
    fail('conversation.recordingState', 'unsupported recorder state');
  }

  const importedProviderKey = optionalString(input.providerKey, 'conversation.providerKey');
  const importedProvisionalKey = optionalString(
    input.provisionalKey,
    'conversation.provisionalKey'
  );

  if (conversation.providerConversationId) {
    const expected = providerConversationKey(
      conversation.providerId,
      conversation.providerConversationId
    );
    if (conversation.provisional) {
      fail('conversation.provisional', 'identified conversations cannot be provisional');
    }
    if (importedProviderKey !== expected) {
      fail('conversation.providerKey', `expected ${expected}`);
    }
    if (importedProvisionalKey !== undefined) {
      fail('conversation.provisionalKey', 'identified conversations cannot have a provisional key');
    }
    conversation.providerKey = importedProviderKey;
  } else {
    if (!conversation.provisional) {
      fail('conversation.provisional', 'a conversation without a provider ID must be provisional');
    }
    if (importedProviderKey !== undefined) {
      fail('conversation.providerKey', 'provisional conversations cannot have a provider key');
    }
    if (importedProvisionalKey !== undefined) conversation.provisionalKey = importedProvisionalKey;
  }

  return conversation;
}

function parseMessage(
  value: unknown,
  index: number,
  conversation: ArchiveConversation
): ArchiveMessage {
  const path = `messages[${index}]`;
  const input = record(value, path);
  const providerTurnId = stringValue(input.providerTurnId, `${path}.providerTurnId`);
  const expectedId = messageId(conversation.id, providerTurnId);
  const id = stringValue(input.id, `${path}.id`);
  if (id !== expectedId) fail(`${path}.id`, `expected normalized ID ${expectedId}`);

  const message: ArchiveMessage = {
    id,
    conversationId: stringValue(input.conversationId, `${path}.conversationId`),
    providerId: providerId(input.providerId, `${path}.providerId`),
    providerTurnId,
    providerMessageId: nullableString(input.providerMessageId, `${path}.providerMessageId`),
    role: stringValue(input.role, `${path}.role`) as ArchiveMessage['role'],
    orderHint: integerValue(input.orderHint, `${path}.orderHint`),
    plainText:
      typeof input.plainText === 'string'
        ? input.plainText
        : fail(`${path}.plainText`, 'expected a string'),
    markdown:
      input.markdown === null
        ? null
        : typeof input.markdown === 'string'
          ? input.markdown
          : fail(`${path}.markdown`, 'expected a string or null'),
    partial: booleanValue(input.partial, `${path}.partial`),
    contentHash: stringValue(input.contentHash, `${path}.contentHash`),
    firstObservedAt: timestamp(input.firstObservedAt, `${path}.firstObservedAt`),
    lastObservedAt: timestamp(input.lastObservedAt, `${path}.lastObservedAt`),
    updatedAt: timestamp(input.updatedAt, `${path}.updatedAt`)
  };

  if (message.conversationId !== conversation.id) {
    fail(`${path}.conversationId`, 'does not match exported conversation');
  }
  if (message.providerId !== conversation.providerId) {
    fail(`${path}.providerId`, 'does not match exported conversation');
  }
  if (!ROLES.has(message.role)) fail(`${path}.role`, 'unsupported message role');
  return message;
}

function parseEvent(value: unknown, index: number, conversation: ArchiveConversation): ArchiveEvent {
  const path = `events[${index}]`;
  const input = record(value, path);
  const conversationId = input.conversationId;
  if (conversationId !== conversation.id) {
    fail(`${path}.conversationId`, 'does not match exported conversation');
  }

  const type = stringValue(input.type, `${path}.type`) as ArchiveEventType;
  if (!EVENT_TYPES.has(type)) fail(`${path}.type`, 'unsupported archive event type');

  const event: ArchiveEvent = {
    id: stringValue(input.id, `${path}.id`),
    conversationId: conversation.id,
    type,
    createdAt: timestamp(input.createdAt, `${path}.createdAt`),
    data: dataRecord(input.data, `${path}.data`)
  };

  if (event.type === 'turn-suppressed') {
    const providerTurnId = event.data.providerTurnId;
    if (typeof providerTurnId !== 'string' || providerTurnId.length === 0) {
      fail(`${path}.data.providerTurnId`, 'suppression event requires a provider turn ID');
    }
    const expectedId = `suppressed:${conversation.id}:${encodeURIComponent(providerTurnId)}`;
    if (event.id !== expectedId) {
      fail(`${path}.id`, `expected normalized suppression ID ${expectedId}`);
    }
  }

  return event;
}

function assertUnique(values: string[], path: string): void {
  if (new Set(values).size !== values.length) fail(path, 'contains duplicate identifiers');
}

export function parseJsonArchiveExport(text: string): ArchiveExportBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ArchiveImportValidationError('JSON is not valid');
  }

  const input = record(parsed, 'archive');
  if (input.schema !== ARCHIVE_EXPORT_SCHEMA) {
    fail('archive.schema', `expected ${ARCHIVE_EXPORT_SCHEMA}`);
  }
  if (input.schemaVersion !== ARCHIVE_EXPORT_SCHEMA_VERSION) {
    fail('archive.schemaVersion', `unsupported schema version ${String(input.schemaVersion)}`);
  }

  const exportedAt = timestamp(input.exportedAt, 'archive.exportedAt');
  const conversation = parseConversation(input.conversation);
  if (!Array.isArray(input.messages)) fail('archive.messages', 'expected an array');
  if (!Array.isArray(input.events)) fail('archive.events', 'expected an array');

  const messages = input.messages.map((entry, index) => parseMessage(entry, index, conversation));
  const events = input.events.map((entry, index) => parseEvent(entry, index, conversation));

  if (conversation.messageCount !== messages.length) {
    fail(
      'conversation.messageCount',
      `expected ${messages.length} to match the exported message array`
    );
  }

  assertUnique(messages.map((message) => message.id), 'archive.messages');
  assertUnique(messages.map((message) => message.providerTurnId), 'archive.messages.providerTurnId');
  assertUnique(events.map((event) => event.id), 'archive.events');

  return { conversation, messages, events, exportedAt };
}
