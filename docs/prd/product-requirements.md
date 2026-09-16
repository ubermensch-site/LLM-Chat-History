# LLM Chat History — Product Requirements

Status: Draft v0.1  
Working name: **LLM Chat History**  
Initial platform: Chromium browsers (Chrome/Edge)  
Initial provider: ChatGPT

## 1. Problem

Long AI conversations increasingly contain project history, decisions, research, code, files, and operational context. Provider-native history is useful but is not a reliable independent archive: a user can lose a thread, lose track of which chat contains a decision, encounter provider UI changes, or need to move context between different LLM products.

LLM Chat History should give the user a local, portable, searchable and provider-independent history that is recorded automatically while still giving the user explicit control over what is captured.

## 2. Product vision

Create a user-controlled archive for conversations across AI providers.

The product should eventually support ChatGPT, Claude, Perplexity, Grok, Gemini and other LLM interfaces through isolated provider adapters, while keeping storage, search, export, projects and sync provider-independent.

## 3. Product principles

1. **Local first** — the core product works without an account or cloud service.
2. **Visible recording** — recording state must never be ambiguous.
3. **User control** — pause, resume and stop are first-class controls.
4. **Portable data** — users can export useful Markdown and structured JSON.
5. **Provider independence** — provider-specific DOM logic never becomes the canonical archive format.
6. **Fail safely** — loss of filesystem permission or provider parsing must not silently discard the browser copy.
7. **No invented content** — the archive stores what was rendered/captured; it does not fabricate missing turns.
8. **Privacy by default** — no analytics, telemetry, remote upload or AI processing is required for recording.
9. **Recoverability** — navigation, refreshes, crashes and browser restarts should not destroy captured history.
10. **Progressive capability** — optional cloud sync and additional providers build on the same local data model.

## 4. Target users

### Primary

- people doing long-running work with LLMs;
- developers and researchers who need traceable project context;
- creators and operators using several AI providers;
- users who want a personal archive independent of provider history.

### Secondary

- teams that later need exportable project context;
- privacy-conscious users who want local-only archives;
- users migrating context between different LLM providers.

## 5. Core user stories

### Recording

- As a user, I want a conversation to begin recording automatically when I open or create a supported LLM chat.
- As a user, I want a small persistent indicator showing whether recording is active, paused, stopped or unhealthy.
- As a user, I want to pause recording before discussing content I do not want archived.
- As a user, I want to resume recording without creating duplicate turns.
- As a user, I want to stop recording for a conversation entirely.
- As a user, I want hiding/minimizing the UI to be different from stopping the recorder.

### Recovery

- As a user, I want captured messages to survive refresh, navigation and browser restart.
- As a user, I want the archive to continue associating messages with the same conversation even when its title changes.
- As a user, I want the extension to detect when I move to a different conversation and switch archive targets safely.

### Organization

- As a user, I want to put chats into projects and folders.
- As a user, I want to add tags and notes/checkpoints.
- As a user, I want to search across all archived conversations.
- As a user, I want chats from different providers to coexist in one project.

### Export

- As a user, I want to download a complete conversation as Markdown.
- As a user, I want a structured JSON export that preserves IDs, roles, timestamps and metadata.
- As a user, I want a plain-text/copy option for quick recovery.
- As a user, I want an AI handoff/context-pack export for continuing work in a new thread or another provider.

### Filesystem mirror

- As a user, I want to optionally choose a local directory and mirror my archives there.
- As a user, I want a clear warning when directory permission is lost.
- As a user, I want the browser archive to remain intact even if the folder mirror fails.

## 6. Functional requirements — v0.1

### 6.1 Browser extension

- Chrome/Edge compatible Manifest V3 extension.
- No mandatory backend.
- Works on supported provider domains only.
- Extension UI must not materially obstruct the provider chat interface.

### 6.2 ChatGPT provider adapter

The first provider adapter must:

- detect ChatGPT conversation pages;
- determine a stable conversation identity when available;
- read the current conversation title;
- detect user and assistant turns;
- preserve message ordering;
- observe newly added/updated turns;
- distinguish incomplete/streaming assistant output from finalized output when possible;
- survive SPA navigation between conversations;
- deduplicate already captured messages;
- tolerate DOM virtualization by harvesting rendered turns incrementally;
- expose adapter health/failure state to the recorder engine.

Provider selectors and heuristics must be isolated from storage and business logic.

### 6.3 Recording states

Each active conversation can be:

- `recording`
- `paused`
- `stopped`
- `error`

Rules:

- **Minimize/hide does not change recording state.**
- While `paused`, newly observed conversation content must not be persisted as message content.
- Resume begins capturing from the resume boundary forward.
- Stop is explicit and requires an intentional user action.
- Recording state transitions are stored as archive events without storing omitted private content.

### 6.4 Local storage

Primary archive storage should use IndexedDB or an equivalent extension-owned database suited to large structured records.

The data model must support:

- providers;
- conversations;
- messages/turns;
- archive events;
- projects;
- folders;
- tags;
- checkpoints/notes;
- attachment metadata;
- export metadata;
- sync state (future-compatible).

Storage must support schema migration/versioning from the beginning.

### 6.5 Canonical normalized model

Minimum conversation fields:

- internal archive ID;
- provider;
- provider conversation ID when available;
- title and title history;
- source URL;
- first-seen timestamp;
- last-captured timestamp;
- recording state;
- project/folder/tags;
- message count;
- archive version.

Minimum message fields:

- internal message ID;
- provider message/turn ID when available;
- conversation ID;
- role (`user`, `assistant`, `tool`, `system-visible`, or extensible future role);
- content in normalized rich-text representation and/or source-safe form;
- plain-text representation;
- observed timestamp;
- finalized timestamp when known;
- sequence/order key;
- content hash for deduplication;
- capture version/provider-adapter version.

### 6.6 Incremental persistence

- Do not wait until the user manually exports before storing captured turns.
- Persist finalized turns promptly.
- Writes must be idempotent/deduplicated.
- Avoid permanently treating partially streamed assistant text as a finalized message.
- If a partial turn must be cached for crash safety, mark it as partial and replace/finalize it later.

### 6.7 Recorder UI

Collapsed state should occupy very little screen space and show at minimum:

- recording status;
- captured-message count or health indicator.

Expanded state should provide:

- pause/resume;
- stop;
- checkpoint;
- save/export;
- open library;
- minimize;
- storage health.

The close/hide control must not silently stop recording.

### 6.8 Material Design

Use a simple Google Material Design / Material 3 inspired system for layout, components, states, typography, spacing and accessible contrast.

The initial product should avoid unnecessary custom visual language. See `docs/design/material-design.md`.

### 6.9 Chat library

The library must eventually support:

- list of archived conversations;
- provider filter;
- project/folder filtering;
- tags;
- rename/archive/delete;
- search;
- open transcript;
- export;
- recording/storage health where applicable.

For v0.1, basic list + search + project assignment is sufficient.

### 6.10 Search

Initial search should be local-only and include:

- conversation title;
- provider;
- project/folder;
- tags;
- user text;
- assistant text;
- checkpoints/notes.

Search results should link to the archived conversation and relevant matching turns.

### 6.11 Export

#### Markdown

Must produce a human-readable transcript with:

- title;
- provider;
- source URL;
- archive/export timestamp;
- project/tags when present;
- ordered turns with clear role headings;
- checkpoints/recording state boundaries where useful;
- attachment references/manifest when available.

Markdown export should preserve useful formatting where possible: headings, lists, code blocks, blockquotes, links and tables.

#### JSON

Must export the normalized archive record and schema/version metadata suitable for re-import.

### 6.12 Optional local-folder mirror

A user may explicitly select a directory using browser-supported filesystem permissions.

Requirements:

- folder connection is optional;
- user explicitly chooses the directory;
- permission state is visible;
- failed mirror writes do not delete or invalidate the browser archive;
- file names are deterministic and filesystem safe;
- title changes do not create uncontrolled duplicate archives;
- atomic/safer write patterns should be used when supported.

Suggested human-readable hierarchy:

`LLM Chat History/<Project>/<YYYY-MM>/<timestamp>__<provider>__<slug>.md`

The canonical identity remains an internal stable archive/conversation ID, not the filename.

## 7. Checkpoints

Users can create a checkpoint with:

- timestamp;
- optional title;
- optional note.

Example uses:

- task completed;
- decision made;
- handoff point;
- release milestone.

Checkpoints should appear in archive viewing and export.

## 8. Selective privacy controls

v0.1 must include pause/resume.

Future controls may include:

- exclude one captured turn;
- remove selected turns from the local archive;
- private section start/end;
- per-conversation recording defaults;
- provider/domain exclusions.

Deletion semantics must be explicit and should include both canonical storage and configured mirrors/sync targets when technically possible.

## 9. Attachments and rich content

Initial release may store attachment metadata rather than binary copies.

The normalized model should support future references for:

- uploaded files;
- generated files;
- images;
- citations;
- tool results;
- provider-specific artifacts.

The product must clearly distinguish a referenced attachment from a locally backed-up binary file.

## 10. Future provider support

Provider integrations must use an adapter interface rather than direct coupling to storage/UI.

Planned candidates:

1. ChatGPT
2. Claude
3. Perplexity
4. Grok
5. Gemini
6. other providers based on demand and technical feasibility

Adding a provider should primarily require implementation of detection/extraction/observation/normalization rather than modification of the core archive engine.

## 11. Future cloud/sync direction

Cloud is out of scope for v0.1 but the data model must not block it.

Preferred progression:

1. local browser archive;
2. optional local-folder mirror;
3. bring-your-own-cloud connectors (for example Drive/Dropbox/OneDrive/WebDAV/S3-compatible storage);
4. encrypted cross-device synchronization;
5. optional hosted service if justified.

Privacy goal for future sync: support client-side encryption so remote storage need not receive plaintext conversation content.

## 12. Project Context Pack / AI handoff

Future export mode should generate a portable context package containing a user-selected combination of:

- project metadata;
- key checkpoints;
- recent turns;
- selected historical turns;
- decisions/notes explicitly marked by the user;
- attachment manifest;
- source conversation references;
- optional full transcript.

The feature must distinguish archived source text from any generated summary.

## 13. Security and privacy requirements

- No hidden recording state.
- No remote telemetry by default.
- No transmission of chat content for basic capture/search/export.
- Least-privilege extension permissions.
- Provider host permissions must be explicit and reviewable.
- Sanitize/escape archived content before rendering it in extension UI.
- Treat provider page content as untrusted input.
- Do not execute archived scripts/HTML.
- Avoid storing secrets outside the local archive unless the user intentionally captured them.
- Future cloud credentials must use appropriate browser/OAuth credential flows and must not be embedded in code.

## 14. Accessibility

- Keyboard-operable controls.
- Visible focus states.
- Screen-reader labels for recording state and controls.
- Sufficient contrast.
- Status must not rely on color alone.
- Respect reduced-motion preferences where applicable.

## 15. Non-goals for v0.1

- recording every LLM provider at launch;
- building an LLM chat client;
- sending prompts/messages on the user's behalf;
- replacing provider-native history;
- cloud accounts/subscriptions;
- team collaboration;
- server-side AI summarization;
- guaranteed binary backup of every attachment;
- mobile browser support.

## 16. v0.1 acceptance criteria

A release candidate is acceptable when:

1. ChatGPT conversations can be recorded automatically across normal navigation.
2. User and assistant turns are captured in the correct order without routine duplicates.
3. Refresh/browser restart does not destroy already persisted turns.
4. Pause excludes content captured during the paused interval and resume works predictably.
5. Minimize/hide does not stop recording.
6. Stop explicitly stops capture.
7. The user can browse locally archived chats.
8. The user can search archived text locally.
9. Markdown export is readable and preserves common formatting.
10. JSON export can round-trip the normalized archive model.
11. Storage health/errors are visible.
12. No network service is required for core recording/search/export.
13. UI follows the agreed Material Design foundation and is usable without covering the chat.
14. Basic automated tests exist for normalization, deduplication, state transitions and export.

## 17. Success measures

Early success is reliability-oriented rather than growth-oriented:

- no silent loss of finalized turns during normal usage;
- very low duplicate-turn rate;
- successful recovery after refresh/restart/navigation;
- correct pause/resume boundaries;
- exports that can restore useful project context in a fresh LLM thread;
- provider DOM changes surface visible adapter-health failures rather than silent corruption.

## 18. Known risks

- provider DOM structures change without notice;
- virtualized chat interfaces may unload old turns;
- streaming responses are difficult to finalize robustly across providers;
- browser filesystem permissions may expire or be revoked;
- provider terms/policies may constrain automation approaches;
- very large histories require indexing/storage discipline;
- encrypted sync adds key-management complexity;
- attachments/tool output differ significantly by provider.

## 19. Initial decisions

- Working name: **LLM Chat History**.
- Initial form factor: Chrome/Edge extension.
- Initial provider: ChatGPT.
- UI foundation: simple Material Design 3.
- Canonical storage: local structured database.
- Local filesystem copy: optional secondary mirror, not canonical storage.
- Cloud: deliberately deferred; architecture remains sync-ready.
- Provider support: adapter based.

## 20. Open decisions

To resolve during architecture/prototyping:

- framework vs minimal TypeScript/DOM implementation;
- exact normalized rich-text representation;
- search/index implementation for large archives;
- filesystem mirror update strategy;
- message identity fallback when provider IDs are unavailable;
- strategy for generated images/files and binary attachment backup;
- import/migration semantics;
- encryption/key-management model for later sync;
- extension distribution/licensing strategy.
