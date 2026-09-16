# LLM Chat History — Architecture

Status: Initial architecture proposal v0.1

## 1. Architectural goals

The architecture must support a reliable ChatGPT recorder first while making it straightforward to add additional LLM providers later without rewriting storage, search, export or organization features.

Key constraints:

- Chromium Manifest V3;
- local-first operation;
- no backend required for core features;
- provider DOMs are unstable external dependencies;
- long chat UIs may virtualize older turns;
- assistant messages may stream/update before finalization;
- browser filesystem access is optional and permission-dependent;
- cloud synchronization is future work.

## 2. High-level components

```text
Supported LLM page
      │
      ▼
Provider Adapter (content script)
      │ normalized observations
      ▼
Recorder Engine / State Machine
      │ archive commands/events
      ▼
Persistence Layer ──────────────► Search Index
      │                              │
      │                              ▼
      ├────────────► Exporters ◄── Archive Library
      │
      └────────────► Optional Filesystem Mirror

Future:
Persistence/Sync Abstraction ───► Cloud Connectors
```

## 3. Extension surfaces

### 3.1 Content script

Responsibilities:

- identify supported provider/page;
- run the provider adapter;
- observe provider SPA navigation and DOM mutation;
- render the small in-page recorder control surface when enabled;
- send normalized observations to the recorder engine;
- never become the canonical data store.

Avoid:

- direct IndexedDB business logic scattered through provider selectors;
- filesystem writes;
- cloud sync;
- long-running unrelated application logic.

### 3.2 Extension service worker/background

Responsibilities:

- central command/event routing;
- recorder session coordination;
- persistence access abstraction where appropriate;
- export orchestration/download initiation;
- extension lifecycle handling;
- future sync coordination.

Manifest V3 service workers may suspend, so correctness cannot depend on permanent in-memory state. Durable state must be persisted.

### 3.3 Library/settings UI

Potential implementation as extension pages/routes.

Responsibilities:

- browse/search transcripts;
- projects/folders/tags;
- checkpoints/notes;
- export/import;
- storage health;
- provider health;
- filesystem mirror settings;
- future sync settings.

## 4. Provider adapter contract

Each provider adapter should implement a contract conceptually similar to:

```ts
interface ProviderAdapter {
  readonly providerId: string;
  matchesLocation(url: URL): boolean;
  getConversationIdentity(): ProviderConversationIdentity | null;
  getConversationTitle(): string | null;
  scanRenderedTurns(): ProviderTurnObservation[];
  observe(callback: (event: ProviderObservation) => void): () => void;
  getHealth(): AdapterHealth;
}
```

The exact API may evolve during the technical spike.

### Adapter outputs

Provider adapters should emit facts/observations, not write archives directly.

Examples:

- conversation discovered;
- title changed;
- turn discovered;
- turn content updated;
- turn finalized when determinable;
- navigation changed conversation;
- adapter degraded/error.

## 5. Normalization layer

Provider-specific observations become canonical records.

Responsibilities:

- role mapping;
- stable internal IDs;
- provider-ID preservation;
- ordering;
- rich/plain text conversion;
- content hashing;
- attachment/citation references;
- provider capability metadata.

Provider raw data may be retained selectively for debugging/migration, but the product should not depend on replaying raw HTML.

## 6. Recorder engine

The recorder engine owns capture policy.

### States

```text
recording
paused
stopped
error
```

### Key rules

- minimized/hidden UI does not change recorder state;
- pause creates a boundary and suppresses message-content persistence during the paused interval;
- resume records forward from that point without silently backfilling omitted private content;
- stop is explicit;
- errors are surfaced and recorded as health events;
- state is durable across refresh/restart where applicable.

### Event model

Archive events should support at least:

- conversation-created;
- title-changed;
- recording-started;
- recording-paused;
- recording-resumed;
- recording-stopped;
- message-added;
- message-updated;
- message-finalized;
- checkpoint-created;
- adapter-warning/error;
- export-created;
- mirror-write-succeeded/failed (health history, potentially coalesced).

This event history is not necessarily a full event-sourced database, but it provides recoverability/debugging and supports rebuilding user-visible timelines.

## 7. Persistence

### 7.1 Canonical store

Use extension-owned IndexedDB (or an equivalent structured local database) as the v0.1 canonical archive.

Reasoning:

- suited to larger records than simple key/value settings storage;
- transactional writes;
- indexes;
- schema/version migration;
- local operation.

### 7.2 Suggested stores

```text
conversations
messages
events
projects
folders
tags
checkpoints
attachments
provider_state
settings
exports
sync_state   (reserved/future)
```

The exact schema should be defined in TASK-011 after the adapter spike.

### 7.3 Schema versioning

Every database and exported JSON format must include a version.

Migration principles:

- forward migrations tested;
- do not destructively discard original content without an explicit migration rule;
- migrations should be resumable or transactionally safe;
- export format version is separate from internal DB version when useful.

## 8. Message identity and deduplication

Preferred identity order:

1. provider message/turn ID when stable;
2. provider conversation ID + provider turn sequence/anchor;
3. deterministic internal fingerprint using conversation, role, position and content-related signals;
4. content hash only as a supporting signal, not the sole identity (identical repeated messages are legitimate).

Deduplication must account for streaming updates: repeated observations of the same assistant turn should update/finalize one record rather than create many messages.

## 9. Streaming strategy

A provider may expose an assistant turn before it is complete.

Preferred model:

- discover turn;
- optionally store a `partial` record for crash resilience;
- update same record as content grows;
- finalize when a robust provider signal exists;
- if no reliable signal exists, use conservative stabilization heuristics and mark finalization confidence/source.

Exports should default to latest content and may omit stale partial snapshots.

## 10. Virtualized conversation handling

Long chats may not keep every turn in the DOM.

The recorder should therefore:

- continuously capture turns as they are rendered during normal use;
- maintain persistent records even after DOM nodes are removed;
- provide an explicit historical scan/import flow when first encountering an existing conversation;
- never delete archived turns merely because the provider UI virtualizes/unmounts them.

Initial historical import may scroll/harvest the thread, but continuous recording should not repeatedly auto-scroll and disrupt the user.

## 11. Rich content representation

The archive needs both usability and provider independence.

Recommended fields:

- sanitized normalized rich representation (decision during TASK-003/011);
- Markdown or Markdown-capable representation where fidelity is good;
- plain text for search/accessibility;
- optional provider-specific structural metadata.

Never render stored provider HTML unsanitized.

## 12. Search

Search is local in v0.1.

Architecture options to evaluate:

- IndexedDB token/inverted indexes;
- lightweight client-side full-text library;
- incremental index separate from canonical records.

Search index must be rebuildable from canonical archive records.

## 13. Exporters

Exporters consume normalized records only.

Initial exporters:

- Markdown;
- JSON;
- plain text/copy helper.

Future exporters:

- Project Context Pack;
- provider-targeted handoff formats;
- ZIP archive containing metadata/attachments;
- Git-friendly archive layout.

## 14. Filesystem mirror

The filesystem mirror is secondary, never canonical in v0.1.

Flow:

```text
Canonical DB update
      │
      ├── success -> queue mirror update
      │                │
      │                ├── success -> health OK
      │                └── failure -> retain DB + warning
      │
      └── failure -> recorder storage error
```

The chosen directory handle/permission must be treated as revocable.

Writers should coalesce frequent streaming updates and prefer finalized-turn/checkpoint based writes rather than rewriting a large file for every mutation.

## 15. UI architecture

Two surfaces:

### In-page recorder

- small Material 3 pill by default;
- minimal DOM footprint;
- isolated styles to avoid provider collisions;
- shadow DOM should be evaluated during implementation;
- expanded controls only on demand.

### Library/settings

- full extension page;
- Material 3 tokens/components;
- keyboard and screen-reader accessible.

## 16. Security boundaries

Treat LLM page data as untrusted content.

Requirements:

- sanitize rendered archive content;
- no `innerHTML` with unsanitized provider data;
- no execution of archived scripts;
- strict extension CSP;
- minimal host permissions;
- never expose archive contents to arbitrary page scripts;
- carefully validate messages crossing content-script/extension boundaries;
- avoid provider page code gaining access to extension secrets/settings.

## 17. Privacy boundaries

Core capture/search/export requires no remote service.

Future cloud sync must be a separate module and permission surface.

Recommended future boundary:

```text
Normalized local archive
      ▼
Sync serialization
      ▼
Client-side encryption
      ▼
Provider connector
      ▼
Remote storage
```

Do not make plaintext cloud upload an architectural assumption.

## 18. Multi-provider evolution

Core modules must not import ChatGPT-specific selectors.

Suggested structure:

```text
src/
  providers/
    chatgpt/
      adapter.ts
      selectors.ts
      normalize.ts
      fixtures/
    claude/
    perplexity/
    grok/
    gemini/

  recorder/
  storage/
  search/
  export/
  mirror/
  ui/
  shared/
```

Provider capability flags may include:

- stable conversation ID available;
- stable turn IDs available;
- reliable streaming-final signal;
- citations supported;
- attachments detectable;
- artifacts/tools detectable.

## 19. Testing strategy

### Unit

- normalization;
- state machine;
- dedupe/upserts;
- schema migration;
- Markdown/JSON export;
- filesystem naming;
- search indexing.

### Adapter fixtures

Sanitized HTML/DOM fixtures for known provider states:

- user turn;
- streaming assistant turn;
- completed assistant turn;
- code/table/list content;
- citations/files;
- long/virtualized structures where feasible.

### Integration/E2E

- unpacked extension against supported provider;
- new chat;
- existing chat historical import;
- SPA navigation;
- pause/resume;
- refresh/restart;
- streaming interruption;
- library/export.

## 20. Initial architecture decisions still pending

The following should be settled after TASK-002 rather than assumed prematurely:

- vanilla TypeScript vs UI framework;
- build system;
- exact rich-text canonical representation;
- IndexedDB wrapper/library;
- full-text search implementation;
- Shadow DOM approach for in-page recorder;
- historical import/auto-scroll UX;
- generated file/image backup strategy.
