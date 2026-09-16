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
  ArchiveMessage,
  ArchiveProject,
  ArchiveProjectFolder
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
  'checkpoint',
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

function optionalTimestamp(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return timestamp(value, path);
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

function parseTags(value: unknown, path: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) fail(path, 'expected an array');
  const tags = value.map((entry, index) => stringValue(entry, `${path}[${index}]`).trim());
  if (tags.some((tag) => !tag)) fail(path, 'tags cannot be empty');
  const keys = tags.map((tag) => tag.toLocaleLowerCase());
  if (new Set(keys).size !== keys.length) fail(path, 'contains duplicate tags');
  return tags;
}

function parseProject(value: unknown): ArchiveProject {
  const input = record(value, 'archive.project');
  if (!Array.isArray(input.folders)) fail('archive.project.folders', 'expected an array');
  const folders: ArchiveProjectFolder[] = input.folders.map((entry, index) => {
    const folder = record(entry, `archive.project.folders[${index}]`);
    return {
      id: stringValue(folder.id, `archive.project.folders[${index}].id`),
      name: stringValue(folder.name, `archive.project.folders[${index}].name`).trim()
    };
  });
  if (folders.some((folder) => !folder.name)) fail('archive.project.folders', 'folder names cannot be empty');
  if (new Set(folders.map((folder) => folder.id)).size !== folders.length) {
    fail('archive.project.folders', 'contains duplicate folder identifiers');
  }
  return {
    id: stringValue(input.id, 'archive.project.id'),
    name: stringValue(input.name, 'archive.project.name').trim(),
    folders,
    createdAt: timestamp(input.createdAt, 'archive.project.createdAt'),
    updatedAt: timestamp(input.updatedAt, 'archive.project.updatedAt')
  };
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
  const customTitle = optionalString(input.customTitle, 'conversation.customTitle');
  const archivedAt = optionalTimestamp(input.archivedAt, 'conversation.archivedAt');
  const projectId = optionalString(input.projectId, 'conversation.projectId');
  const folderId = optionalString(input.folderId, 'conversation.folderId');
  const tags = parseTags(input.tags, 'conversation.tags');
  if (customTitle) conversation.customTitle = customTitle;
  if (archivedAt) conversation.archivedAt = archivedAt;
  if (projectId) conversation.projectId = projectId;
  if (folderId) conversation.folderId = folderId;
  if (tags?.length) conversation.tags = tags;
  if (folderId && !projectId) fail('conversation.folderId', 'a folder requires a project assignment');

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

  if (event.type === 'checkpoint') {
    if (!event.id.startsWith('checkpoint:')) {
      fail(`${path}.id`, 'checkpoint ID must start with checkpoint:');
    }
    const name = event.data.name;
    if (typeof name !== 'string' || !name.trim()) {
      fail(`${path}.data.name`, 'checkpoint requires a non-empty name');
    }
    const note = event.data.note;
    if (note !== null && typeof note !== 'string') {
      fail(`${path}.data.note`, 'checkpoint note must be a string or null');
    }
    timestamp(event.data.updatedAt, `${path}.data.updatedAt`);
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
  let project: ArchiveProject | null | undefined;
  if (input.project === null) project = null;
  else if (input.project !== undefined) project = parseProject(input.project);

  if (conversation.projectId) {
    if (!project) fail('archive.project', 'organized conversation requires its project definition');
    if (project.id !== conversation.projectId) {
      fail('archive.project.id', 'does not match conversation.projectId');
    }
    if (
      conversation.folderId &&
      !project.folders.some((folder) => folder.id === conversation.folderId)
    ) {
      fail('conversation.folderId', 'does not exist in the exported project');
    }
  } else if (project) {
    fail('archive.project', 'Unsorted conversation cannot carry an assigned project definition');
  }

  if (conversation.messageCount !== messages.length) {
    fail(
      'conversation.messageCount',
      `expected ${messages.length} to match the exported message array`
    );
  }

  assertUnique(messages.map((message) => message.id), 'archive.messages');
  assertUnique(messages.map((message) => message.providerTurnId), 'archive.messages.providerTurnId');
  assertUnique(events.map((event) => event.id), 'archive.events');

  const bundle: ArchiveExportBundle = { conversation, messages, events, exportedAt };
  if (input.project !== undefined) bundle.project = project ?? null;
  return bundle;
}
