# ChatGPT DOM & Lifecycle Technical Spike — 2026-09-16

Status: **TASK-002 research complete; implementation assumptions ready for validation**

## Goal

Define a resilient capture strategy for ChatGPT without coupling the recorder to unstable CSS class names or assuming that every turn is permanently mounted in the DOM.

## Observed / corroborated structure

Current third-party implementations and recent live-DOM references consistently identify semantic attributes as the most resilient surface:

- turn shells: `section[data-turn="user"]` and `section[data-turn="assistant"]` (some prior/current snapshots use `article[data-turn]`);
- turn identity: `data-turn-id` when present;
- fallback message identity/role: descendants with `data-message-author-role="user|assistant"` and `data-message-id`;
- assistant rendered body commonly lives below `.markdown` / prose markup;
- user text commonly lives in a whitespace-preserving message region;
- CSS utility/class names are not considered stable contracts.

The adapter must therefore prefer semantic `data-*` attributes and keep element-tag and class assumptions as fallbacks only.

## Conversation identity

Primary ChatGPT conversation routes use a conversation UUID in the URL path, typically `/c/<conversation-id>`.

Adapter policy:

1. Parse a stable provider conversation ID from the URL when available.
2. Treat a route without a stable conversation ID (for example a brand-new unsaved chat) as a provisional session.
3. When ChatGPT assigns a conversation ID after the first exchange, merge/rekey the provisional session rather than creating a second archive.
4. Keep `sourceUrl` as metadata; do not use the full URL as the canonical internal primary key.

## SPA navigation

ChatGPT navigation is client-side. The page can change conversations without a full reload.

Detection strategy:

- observe `popstate`;
- patch/listen around `history.pushState` and `history.replaceState` from the isolated content-script boundary where feasible;
- also keep a lightweight URL-change watchdog because provider routing implementation can change;
- on route change, rescan conversation identity and title;
- tear down conversation-scoped observers/caches and attach them to the new route;
- never clear persisted archive records merely because the DOM route changed.

The adapter must make route changes idempotent because the same navigation can be observed via more than one mechanism.

## Turn discovery and identity

Priority order for stable provider turn identity:

1. `data-turn-id` on the user/assistant shell;
2. descendant `data-message-id`;
3. semantic turn shell index combined with conversation ID as a temporary fallback;
4. deterministic fingerprint only as a last-resort support signal.

A content hash must **not** be the sole identity because users can legitimately repeat the same prompt or receive identical answers.

## Streaming behavior

Assistant output mutates while generation is in progress. A MutationObserver can therefore emit many updates for one logical response.

Capture policy:

- discover a turn once;
- upsert updates to the same provider turn ID;
- mark the record `partial` while content is changing;
- debounce/coalesce mutations before serialization;
- persist partial state periodically for crash recovery, but avoid emitting a filesystem mirror write for every token;
- finalize after a provider completion signal when one is reliably detectable;
- otherwise use conservative stabilization (no relevant content mutation for a configured interval plus no active-generation control/state signal) and record finalization source/confidence.

The recorder must never create one archived message per MutationObserver callback.

## Virtualization / long conversations

Recent ChatGPT implementations can keep stable turn shells while unmounting or replacing off-screen turn content. Other observations report more aggressive virtualization where older content is absent until scrolled into view. Therefore the implementation must assume **content virtualization is possible** even when turn shells remain.

Consequences:

- continuous recording stores a turn permanently once observed;
- a DOM node disappearing is not a deletion signal;
- initial capture of an existing long conversation needs a historical-import strategy;
- routine recording must not auto-scroll the user's page repeatedly;
- explicit historical import can use controlled scroll-and-harvest with scroll-position restoration;
- adapter health must report when known turn shells exist but bodies have not yet been harvested.

## Historical import strategies

### Strategy A — explicit DOM harvest (v0.1 baseline)

On user request, walk the conversation through the scroll container, harvest mounted turns, dedupe by provider IDs, and restore the prior scroll position.

Pros:
- depends only on the rendered application surface;
- avoids coupling core correctness to an undocumented backend endpoint.

Cons:
- can be visually disruptive while running;
- may miss provider-only structured content;
- must handle virtualized shells carefully.

### Strategy B — same-origin conversation endpoint (experimental/fallback)

Recent exporters have used ChatGPT's authenticated same-origin conversation endpoint to retrieve the full conversation tree, then linearize the active branch. This can solve DOM virtualization and preserve message metadata.

Policy for this project:
- do **not** make an undocumented endpoint a hard dependency for v0.1 continuous recording;
- keep the adapter interface able to support an optional provider-specific backfill capability later;
- if implemented, gate it behind explicit user action, same-origin access only, strict parsing, and a visible fallback to DOM harvest;
- never transmit the retrieved conversation to a third party.

## Rich content extraction

For v0.1 capture, store both:

- `plainText` — normalized text for search and fallback export;
- `markdown` — sanitized Markdown generated from known safe DOM structures;
- `providerMeta` — IDs/model/capability metadata that are useful but not required for rendering.

Do not persist raw executable HTML as the canonical representation. Never render provider HTML unsanitized in the archive library.

Expected Markdown conversion coverage:

- paragraphs/headings;
- emphasis;
- inline code and fenced code blocks;
- ordered/unordered lists;
- blockquotes;
- tables;
- links;
- visible citation/link labels;
- attachment placeholders/metadata when detectable.

## Branches / regenerated answers

A single ChatGPT conversation can contain alternate answer branches after edits/regenerations.

v0.1 policy:

- record the branch currently rendered/active;
- preserve provider turn/message IDs;
- do not pretend alternate hidden branches were captured;
- future provider backfill can expose branch metadata as a capability without changing canonical message storage.

## Pause semantics

Privacy rule: **Pause is a capture-policy boundary, not merely a UI state.**

While paused:

- DOM observers may remain attached for adapter health/navigation purposes;
- message content created/changed during the paused interval is not persisted;
- on resume, the recorder establishes a new forward boundary and must not silently backfill omitted messages during normal continuous capture;
- a later explicit historical import must warn that it could encounter previously omitted turns and must not import them without a deliberate override.

This requires pause boundaries to store enough provider turn identity/ordering information to prevent accidental backfill.

## Selector strategy

Centralize selectors in the ChatGPT adapter and version them by priority.

Preferred turn-shell queries:

```ts
const TURN_SELECTORS = [
  'section[data-turn="user"], section[data-turn="assistant"]',
  'article[data-turn="user"], article[data-turn="assistant"]',
  '[data-testid^="conversation-turn-"][data-turn]'
];
```

Fallback role query:

```ts
'[data-message-author-role="user"], [data-message-author-role="assistant"]'
```

Rules:

- role from shell `data-turn` first;
- provider turn ID from `data-turn-id` first;
- message ID from descendant `data-message-id` when present;
- role/message selectors may support fallback capture but class names must not define identity;
- selector failure transitions adapter health to `degraded`/`error` visibly.

## Observer design

Use one conversation-scoped MutationObserver near the conversation root rather than one observer per message.

On mutation batch:

1. determine whether route/conversation identity changed;
2. scan semantic turn shells touched by the mutation plus the active/last assistant turn;
3. normalize observations;
4. dedupe/coalesce by provider turn ID;
5. emit facts to the recorder engine;
6. recorder state decides whether content is persisted.

A periodic low-frequency reconciliation scan can catch missed mutations without expensive full-DOM work on every token.

## Failure modes and required behavior

| Failure | Required behavior |
|---|---|
| Semantic selectors return zero turns on a conversation page | Visible adapter error; never claim recording is healthy |
| Turn shell exists but content is unmounted | Keep prior archive record; mark current DOM observation incomplete |
| Provider IDs absent | Use temporary fallback identity and emit degraded health |
| Repeated mutation callbacks | Idempotent upsert, no duplicate archived turns |
| Navigation fires multiple signals | Idempotent route transition |
| Refresh while streaming | Restore partial record and reconcile with rendered turn |
| Title changes | Update metadata only; conversation ID remains stable |
| Minimize/hide recorder | No capture-state change |
| Paused interval | Do not persist omitted message content or silently backfill it |
| Unsupported DOM revision | Surface error + offer debug report containing selectors/structure diagnostics without transcript content by default |

## Adapter contract implications

TASK-003 should extend the provider adapter contract with optional capabilities instead of forcing every provider to support ChatGPT-specific mechanisms.

Recommended shape:

```ts
interface ProviderAdapter {
  readonly providerId: string;
  readonly capabilities: ProviderCapabilities;

  matchesLocation(url: URL): boolean;
  getConversationIdentity(): ProviderConversationIdentity | null;
  getConversationTitle(): string | null;
  scanRenderedTurns(): ProviderTurnObservation[];
  observe(callback: (event: ProviderObservation) => void): () => void;
  getHealth(): AdapterHealth;

  // Optional provider capability.
  historicalImport?(options: HistoricalImportOptions): Promise<HistoricalImportResult>;
}
```

## TASK-002 decision

Proceed with a **DOM-first continuous recorder** using semantic data attributes, durable deduplication and explicit health reporting. Treat historical import as a separate capability. Implement explicit scroll-and-harvest first; evaluate same-origin provider backfill as an optional later enhancement rather than a v0.1 dependency.

## Validation still required during implementation

Because ChatGPT is a moving external UI, the first unpacked extension build must validate these assumptions against the current live site and capture sanitized fixtures/debug metadata for regression tests. TASK-012 cannot be considered complete based on this document alone.
