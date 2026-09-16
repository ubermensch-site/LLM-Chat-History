# LLM Chat History — Development Roadmap

Status: Draft v0.1  
Primary target: Chrome/Edge  
Initial provider: ChatGPT

## Roadmap principles

- Build reliability before provider breadth.
- Keep capture, normalization, storage and UI loosely coupled.
- Make failures visible rather than silently dropping history.
- Keep the browser-local archive canonical for v0.1.
- Add optional mirrors/sync only after core recording is dependable.
- Treat provider adapters as replaceable integration modules.

## Phase 0 — Foundation and product definition

### TASK-001 — Repository and documentation scaffold

Scope:
- establish README;
- PRD;
- architecture document;
- Material Design brief;
- roadmap;
- contribution/testing conventions.

Acceptance:
- source-of-truth docs are linked from README;
- initial scope and non-goals are explicit.

### TASK-002 — Technical spike: ChatGPT DOM and lifecycle

Scope:
- document current conversation URL/ID behavior;
- identify stable user/assistant turn signals;
- test streaming behavior;
- test SPA navigation;
- test virtualized long threads;
- identify resilient selector/fallback strategy;
- record failure modes.

Acceptance:
- adapter contract can be implemented without coupling to specific CSS class names where avoidable;
- observed DOM assumptions are documented and test fixtures captured where appropriate.

### TASK-003 — Extension architecture decision

Scope:
- select implementation stack;
- define MV3 layout;
- define content-script/background/offscreen/library responsibilities;
- define message bus/event boundaries;
- define persistence/schema version strategy.

Acceptance:
- architecture doc contains component ownership and data flow;
- framework choice is justified for maintainability and extension constraints.

## Phase 1 — Minimal reliable recorder

### TASK-010 — Manifest V3 extension shell

Deliver:
- installable unpacked Chrome/Edge extension;
- permissions limited to required provider domains/storage;
- development build workflow;
- basic lint/typecheck/test commands.

Acceptance:
- extension loads with no critical console errors;
- content script activates only on supported domains.

### TASK-011 — Canonical archive schema v1

Deliver:
- conversations store;
- messages store;
- events store;
- schema versioning/migration mechanism;
- stable internal IDs;
- content hashing/dedupe keys.

Acceptance:
- unit tests cover create/read/update, ordering and migrations.

### TASK-012 — ChatGPT provider adapter v1

Deliver:
- provider detection;
- conversation identity/title/source URL extraction;
- user and assistant message extraction;
- MutationObserver/navigation observation;
- streaming/finalization handling;
- deduplication inputs;
- adapter health events.

Acceptance:
- captures a normal new conversation correctly;
- captures continued turns without duplicates;
- moving between two chats changes archive target correctly;
- refresh preserves prior data.

### TASK-013 — Recorder state machine

States:
- recording;
- paused;
- stopped;
- error.

Deliver:
- explicit transitions;
- persisted recording state;
- pause boundary events;
- stop semantics;
- restart/navigation recovery.

Acceptance:
- paused content is not stored as message content;
- resume does not backfill intentionally omitted content;
- minimize/hide has no effect on capture state;
- state tests cover invalid transitions.

### TASK-014 — Incremental/crash-safe persistence

Deliver:
- prompt finalized-turn writes;
- partial-response handling;
- idempotent upserts;
- retry/error reporting;
- last-good-state recovery.

Acceptance:
- simulated reload/crash does not lose finalized captured turns;
- duplicate observer events do not create duplicate messages.

## Phase 2 — Recorder UI and exports

### TASK-020 — Material 3 recorder pill

Deliver:
- compact floating pill;
- recording/paused/error/stopped status;
- message count/health indicator;
- draggable or non-obstructive placement strategy;
- accessible labels and focus behavior.

Acceptance:
- collapsed recorder does not meaningfully obscure ChatGPT text/composer;
- status is understandable without relying only on color.

### TASK-021 — Expanded recorder controls

Deliver:
- pause/resume;
- stop with deliberate confirmation/interaction;
- checkpoint;
- export;
- library link;
- minimize/hide;
- storage health display.

Acceptance:
- close/minimize cannot accidentally stop recording.

### TASK-022 — Markdown exporter v1

Deliver:
- metadata header;
- ordered user/assistant turns;
- checkpoints and recording boundaries;
- common rich formatting preservation;
- safe deterministic filename.

Acceptance:
- exported transcript is readable in GitHub/standard Markdown viewers;
- code fences/lists/links remain useful.

### TASK-023 — JSON exporter/import foundation

Deliver:
- versioned JSON schema/export;
- import validation;
- duplicate-conversation strategy.

Acceptance:
- export can be re-imported without losing normalized IDs/order/metadata.

## Phase 3 — Archive library

### TASK-030 — Library shell

Deliver:
- list chats;
- provider/title/date/message count;
- open archive transcript;
- rename/archive/delete actions.

### TASK-031 — Projects, folders and tags

Deliver:
- create/edit project;
- assign chat to project/folder;
- tags;
- Unsorted fallback.

Acceptance:
- one project can contain conversations from different providers.

### TASK-032 — Local full-text search

Search:
- title;
- provider;
- project/folder/tags;
- user/assistant text;
- checkpoints/notes.

Acceptance:
- matching result links to the relevant archived conversation/turn.

### TASK-033 — Checkpoints and notes

Deliver:
- named checkpoint;
- optional note;
- visible timeline markers;
- export inclusion.

## Phase 4 — Optional filesystem mirror

### TASK-040 — Folder connection

Deliver:
- user explicitly chooses archive directory;
- permission state stored/revalidated appropriately;
- disconnect/reconnect flows;
- visible mirror health.

### TASK-041 — Deterministic filesystem layout

Suggested layout:

`LLM Chat History/<Project>/<YYYY-MM>/<timestamp>__<provider>__<slug>.md`

Requirements:
- safe filenames;
- stable conversation identity independent of title/file path;
- title changes handled without uncontrolled duplicates.

### TASK-042 — Safe mirror writer

Deliver:
- queued writes;
- write coalescing;
- temporary/safer replacement pattern where browser API permits;
- browser DB remains canonical on write failure.

Acceptance:
- revoked folder permission surfaces warning without affecting local archive.

## Phase 5 — Reliability and release candidate

### TASK-050 — Long-chat virtualization stress test

Test:
- long conversations;
- scrolling history;
- older turn virtualization;
- switching threads rapidly;
- refresh during assistant streaming.

### TASK-051 — DOM change/failure detection

Deliver:
- adapter health diagnostics;
- selector failure detection;
- visible degraded/error state;
- optional debug report users can export without full chat content.

Acceptance:
- provider breakage is noisy/visible rather than silent data loss.

### TASK-052 — Performance/storage profiling

Measure:
- large archives;
- search speed;
- IndexedDB size growth;
- observer CPU use;
- UI responsiveness.

### TASK-053 — Security/privacy review

Review:
- CSP/Trusted Types compatibility;
- untrusted provider content rendering;
- XSS prevention;
- extension permissions;
- no accidental network transmission;
- private pause semantics;
- archive deletion behavior.

### TASK-054 — v0.1 release candidate

Acceptance gate based on PRD v0.1 acceptance criteria.

Deliver:
- packaged extension;
- install instructions;
- known limitations;
- migration notes;
- privacy statement;
- QA evidence.

## Phase 6 — Multi-provider architecture expansion

Do not start until ChatGPT recorder is stable.

### TASK-060 — Provider adapter SDK/contract hardening

Deliver:
- formal adapter interface;
- provider capability flags;
- shared adapter test harness;
- fixture strategy.

### TASK-061 — Claude adapter

### TASK-062 — Perplexity adapter

### TASK-063 — Grok adapter

### TASK-064 — Gemini adapter

Each provider must pass the same core capture/navigation/pause/dedupe reliability suite with provider-specific exceptions documented.

## Phase 7 — Context portability

### TASK-070 — Project Context Pack / AI handoff export

Deliver configurable export containing:
- project metadata;
- selected chats;
- checkpoints;
- recent turns;
- attachment manifest;
- source links;
- optional generated summary clearly marked as generated.

### TASK-071 — Cross-provider handoff helpers

Goal:
- prepare context for continuing work in another provider without pretending to migrate hidden/provider-internal state.

## Phase 8 — Cloud and cross-device sync

Cloud work remains intentionally deferred until local correctness is proven.

### TASK-080 — Sync model and conflict semantics

Define:
- object/version IDs;
- merge/conflict behavior;
- tombstones/deletions;
- offline behavior;
- key rotation implications.

### TASK-081 — Client-side encryption design

Deliver threat model and key-management design before any cloud implementation.

### TASK-082 — Bring-your-own-cloud connector #1

Candidate selection later (Drive/Dropbox/OneDrive/WebDAV/S3-compatible) based on implementation/security tradeoffs.

### TASK-083 — Additional storage connectors

### TASK-084 — Optional hosted sync evaluation

Only pursue if there is a clear product need beyond user-owned storage.

## Backlog / future ideas

- one-turn exclusion after capture;
- private-section start/end;
- encrypted local vault;
- attachment binary backup;
- generated-image archive;
- citation preservation;
- provider tool/artifact normalization;
- duplicate/near-duplicate chat detection;
- project-level timeline;
- local analytics such as chat/message/storage counts;
- retention policies;
- scheduled exports/backups;
- browser profile migration helper;
- Firefox support;
- Safari support;
- native desktop companion if browser filesystem constraints become limiting;
- optional Git repository archive target;
- optional user-owned object storage;
- import from provider-native data exports.

## Immediate execution order

1. TASK-002 — ChatGPT DOM/lifecycle spike.
2. TASK-003 — extension architecture decision.
3. TASK-010 — MV3 extension shell.
4. TASK-011 — archive schema.
5. TASK-012 — ChatGPT adapter.
6. TASK-013/014 — recorder state + persistence.
7. TASK-020/021 — compact recorder UI.
8. TASK-022/023 — export/import foundation.
9. TASK-030 onward — library/search/organization.
