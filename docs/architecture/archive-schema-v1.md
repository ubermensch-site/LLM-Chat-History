# Archive Schema v1

Status: **TASK-011 implementation**  
Database: `llm-chat-history`  
IndexedDB version: `1`

## Canonical principle

The extension-owned IndexedDB archive is the canonical local record for v0.1. Provider DOM nodes, page localStorage, filesystem mirrors and exported Markdown are not canonical stores.

## Conversation identity

`ArchiveConversation.id` is an extension-owned stable internal ID.

Provider conversation IDs are indexed separately using `providerKey`:

`<providerId>:<providerConversationId>`

This is intentionally different from making a provider URL the database primary key.

### New-chat promotion

A brand-new ChatGPT thread may initially have no provider conversation ID. In that state the record gets a temporary indexed `provisionalKey` tied to the active capture session.

When ChatGPT assigns its real conversation ID:

1. storage first looks for an existing stable `providerKey`;
2. if none exists, it finds the provisional record for the capture session;
3. the same internal conversation record is updated with the provider ID;
4. `provisionalKey` is removed and `providerKey` is added;
5. messages keep the same internal conversation ID.

This prevents the first prompt and the later `/c/<id>` route from becoming two archives.

On a later browser/session reload, the stable provider key resolves the already-existing internal conversation record.

## Stores

### `conversations`

Key: `id`

Core fields:
- internal ID;
- provider ID;
- provider conversation ID;
- provider/provisional lookup key;
- title;
- source URL;
- provisional flag;
- created/updated/last-observed timestamps;
- message count.

Indexes:
- `by_provider_key` — unique;
- `by_provisional_key` — unique while the record is provisional;
- `by_updated_at`.

### `messages`

Key: `id`

Message ID is derived from internal conversation ID + provider turn ID. Re-observing a streaming assistant turn therefore updates the same record rather than appending a token-by-token history.

Core fields:
- conversation ID;
- provider turn/message IDs;
- role;
- order hint;
- plain text;
- normalized Markdown placeholder/representation;
- partial/final state;
- SHA-256 content hash;
- first/last observed timestamps.

Indexes:
- `by_conversation_order` on `[conversationId, orderHint]`;
- `by_provider_turn` on `[conversationId, providerTurnId]`, unique;
- `by_conversation_updated_at`.

The content hash is a change/deduplication signal, not message identity. Identical repeated user prompts remain valid distinct turns because provider turn identity is primary.

### `events`

Key: `id`

Initial event types:
- conversation-created;
- conversation-identified;
- title-changed;
- message-added;
- message-updated;
- message-finalized;
- adapter-health.

Indexes:
- `by_conversation_time`;
- `by_type_time`.

Events provide audit/debug/timeline information. Canonical current message text remains in the `messages` store.

## Streaming writes

For a logical assistant turn:

1. first observation creates one message record;
2. later partial observations update that same ID;
3. content hash determines whether meaningful content changed;
4. transition from `partial=true` to `partial=false` records finalization;
5. repeated identical final observations do not increase message count or create duplicate messages.

TASK-014 will add explicit write coalescing/retry/last-good-state policy around this repository layer.

## Service-worker lifecycle

The MV3 background worker opens IndexedDB lazily. No correctness-critical archive state is held only in service-worker memory.

The content script sends provider observations through a sequential message queue. The background listener keeps the message channel open until the IndexedDB write completes, then acknowledges success/failure.

## Migration mechanism

`ARCHIVE_DB_VERSION` and `applyArchiveMigrations()` are the only schema-upgrade entry points.

Version 1 creates the three canonical stores and indexes. Future changes must:
- increase the version;
- add a forward migration guarded by `oldVersion`;
- include migration tests;
- avoid destructive deletion without an explicit data-preservation decision.

## Tests

Node unit tests use `fake-indexeddb` only as a development dependency. Current coverage verifies:
- v1 store/index creation;
- provisional-to-stable conversation promotion without duplicate archives;
- ordered message retrieval;
- streaming message upsert/finalization;
- message-count deduplication;
- event creation for add/update/finalize transitions.

Browser-level IndexedDB behavior remains part of extension integration QA; the test double does not replace real Chromium validation.
