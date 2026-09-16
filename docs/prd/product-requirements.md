# LLM Chat History — Product Requirements

Status: Draft v0.1 functional release  
Working name: **LLM Chat History**  
Initial platform: Chromium browsers (Chrome/Edge)  
Initial provider: ChatGPT

## 1. Problem

Long AI conversations increasingly contain project history, decisions, research, code, files, operational context and provider-visible work performed while a response is being produced. Provider-native history is useful but is not a reliable independent archive: a user can lose a thread, lose track of which chat contains a decision, encounter provider UI changes, or need to move context between different LLM products.

LLM Chat History should give the user a local, portable, searchable and provider-independent history that is recorded automatically while still giving the user explicit control over what is captured.

The archive should preserve not only the final prompt/answer transcript but, when the provider visibly renders it, the useful session context around the answer: visible reasoning summaries, searches, browsing, tool/work steps, progress/status text, interruptions/retries, visible model labels and related provider-visible activity. The product must never pretend it captured hidden/private reasoning that the provider did not render.

## 2. Product vision

Create a user-controlled archive for conversations and visible session context across AI providers.

The product should eventually support ChatGPT, Claude, Perplexity, Grok, Gemini and other LLM interfaces through isolated provider adapters, while keeping storage, search, export, projects, handoff and sync provider-independent.

A core long-term value proposition is **continuity of work**: a user should be able to preserve enough provider-visible context to continue a project in a fresh thread or a different provider without depending on the original provider's history UI.

## 3. Product principles

1. **Local first** — the core product works without an account or cloud service.
2. **Visible recording** — recording state must never be ambiguous.
3. **User control** — pause, resume and stop are first-class controls.
4. **Portable data** — users can export useful Markdown and structured JSON.
5. **Provider independence** — provider-specific DOM logic never becomes the canonical archive format.
6. **Fail safely** — loss of filesystem permission or provider parsing must not silently discard the browser copy.
7. **No invented content** — the archive stores what was rendered/captured; it does not fabricate missing turns, model names or reasoning.
8. **Visible-context fidelity** — if the provider visibly shows work/status/reasoning summaries during a response, preserve that context when technically observable.
9. **Honest reasoning boundary** — capture provider-visible reasoning summaries/work activity only; never claim access to hidden/private chain-of-thought that was not rendered to the user.
10. **Privacy by default** — no analytics, telemetry, remote upload or AI processing is required for recording.
11. **Recoverability** — navigation, refreshes, crashes and browser restarts should not destroy captured history.
12. **Progressive capability** — optional cloud sync and additional providers build on the same local data model.
13. **Progressive disclosure in UX** — beginner-critical actions stay understandable while advanced diagnostics, backup and power-user controls stay available without dominating the default surface.

## 4. Target users

### Primary

- people doing long-running work with LLMs;
- developers and researchers who need traceable project context;
- creators and operators using several AI providers;
- users who want a personal archive independent of provider history;
- users who need to continue complex work in a new chat without losing provider-visible execution context.

### Secondary

- teams that later need exportable project context;
- privacy-conscious users who want local-only archives;
- users migrating context between different LLM providers.

## 5. Core user stories

### Recording

- As a user, I want a conversation to begin recording automatically when I open or create a supported LLM chat.
- As a user, I want a small persistent indicator showing whether recording is active, paused, stopped or unhealthy.
- As a user, I want every provider-rendered user/assistant response preserved, including visible interruption/status responses.
- As a user, I want provider-visible work shown while an answer is running — such as Thinking/reasoning summaries, browsing/search steps, tool/work steps and progress/status text — preserved with that response.
- As a user, I want a visible per-response model label saved when the provider actually shows one, and I do not want the extension to guess when it does not.
- As a user, I want to pause recording before discussing content I do not want archived.
- As a user, I want pause privacy to apply to visible work/activity as well as prompt/answer text.
- As a user, I want to resume recording without creating duplicate turns or backfilling intentionally omitted content.
- As a user, I want to stop recording for a conversation entirely.
- As a user, I want hiding/minimizing or moving the UI to be different from stopping the recorder.

### Recovery

- As a user, I want captured messages and provider-visible activity to survive refresh, navigation and browser restart.
- As a user, I want the archive to continue associating messages with the same conversation even when its title changes.
- As a user, I want the extension to detect when I move to a different conversation and switch archive targets safely.
- As a user, I want transient provider-visible activity that disappears after completion to remain available in my archive if it was observed while recording.

### Organization

- As a user, I want to put chats into projects and folders.
- As a user, I want to add tags and notes/checkpoints.
- As a user, I want to search across all archived conversations, including provider-visible work activity.
- As a user, I want chats from different providers to coexist in one project.

### Export and handoff

- As a user, I want to download a complete conversation as Markdown.
- As a user, I want a structured JSON export that preserves IDs, roles, timestamps and metadata.
- As a user, I want exports to preserve provider-visible work/reasoning/status context in a clearly labeled form before the final assistant answer.
- As a user, I want visible model metadata included when the provider exposed it.
- As a user, I want a plain-text/copy option for quick recovery.
- As a user, I want an AI handoff/context-pack export for continuing work in a new thread or another provider.

### Filesystem mirror

- As a user, I want to optionally choose a local directory and mirror my archives there.
- As a user, I want a clear warning when directory permission is lost.
- As a user, I want the browser archive to remain intact even if the folder mirror fails.

### Usability and power-user access

- As a user, I want the recorder to be draggable so I can place it somewhere unobtrusive.
- As a user, I want Auto/Light/Dark appearance support.
- As a new user, I want plain-language controls that explain consequences instead of implementation details.
- As a power user, I want keyboard-first access such as Ctrl/Cmd+K in the Library without making the beginner UI more complicated.

## 6. Functional requirements — v0.1

### 6.1 Browser extension

- Chrome/Edge compatible Manifest V3 extension.
- No mandatory backend.
- Works on supported provider domains only.
- Extension UI must not materially obstruct the provider chat interface.
- Production extension must not add telemetry, remote code or an unexpected network client.

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
- capture provider-visible activity associated with assistant responses when it is rendered in the user-visible interface;
- preserve provider-visible transient activity once observed even if the provider later collapses/removes that transient UI;
- capture a short human-readable model label only when the provider visibly exposes it for the response;
- avoid using internal-looking/hidden model slugs or page metadata as a substitute for a user-visible model label;
- expose adapter health/failure state to the recorder engine.

Provider-visible activity may include, where actually rendered:

- visible Thinking/reasoning summaries;
- browsing/search/research steps;
- file/tool/computer/terminal/code work steps;
- implementation/testing/build/verification steps;
- progress/status/waiting/retry/interruption text;
- other visible provider work that materially contributes to reconstructing the session.

The adapter must not infer, synthesize or claim to capture hidden/private chain-of-thought that the provider did not render.

Provider selectors and heuristics must be isolated from storage and business logic.

### 6.3 Recording states

Each active conversation can be:

- `recording`
- `paused`
- `stopped`
- `error`

Rules:

- **Minimize/hide/move does not change recording state.**
- While `paused`, newly observed conversation content must not be persisted as message content.
- While `paused`, newly observed provider-visible activity must also be suppressed.
- Resume begins capturing from the resume boundary forward.
- Content or visible activity produced only while paused must not later backfill when it reappears in the DOM.
- Stop is explicit and requires an intentional user action.
- Recording state transitions are stored as archive events without storing omitted private content.

### 6.4 Local storage

Primary archive storage should use IndexedDB or an equivalent extension-owned database suited to large structured records.

The data model must support:

- providers;
- conversations;
- messages/turns;
- per-response visible activity timeline;
- visible model labels when available;
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
- visible provider model label when available;
- zero or more provider-visible activity records associated with the response;
- capture version/provider-adapter version.

Minimum visible-activity fields:

- stable archive-local/provider-turn-associated activity ID;
- activity kind such as visible reasoning summary, tool/work step, status or other visible activity;
- provider-visible text;
- observed timestamp;
- sequence/order hint within the response lifecycle.

### 6.6 Incremental persistence

- Do not wait until the user manually exports before storing captured turns.
- Persist finalized turns promptly.
- Persist observed provider-visible activity incrementally enough that transient activity can survive later provider UI removal.
- Writes must be idempotent/deduplicated.
- Avoid permanently treating partially streamed assistant text as a finalized message.
- If a partial turn must be cached for crash safety, mark it as partial and replace/finalize it later.
- Later scans that omit a previously observed visible model label or activity item must not erase already persisted valid metadata solely because the provider collapsed it.

### 6.7 Recorder UI

Collapsed state should occupy very little screen space and show at minimum:

- recording status;
- captured-message count or health indicator.

Recorder requirements:

- draggable placement with remembered safe on-screen position;
- minimizing/hiding/moving never changes capture state;
- Auto/Light/Dark appearance support;
- plain-language status/copy for normal users;
- advanced/technical adapter details behind progressive disclosure where practical.

Expanded state should provide:

- pause/resume;
- stop;
- checkpoint;
- save/export;
- open library;
- minimize/hide;
- storage health;
- manual historical import where supported;
- privacy-safe QA report for authenticated validation builds.

The close/hide control must not silently stop recording.

### 6.8 Design and UX

The functional v0.1 release must be understandable, keyboard-operable and non-obstructive, but **final visual polish is not a release gate for the functional v0.1 milestone**.

The current visual system is intentionally scheduled for a dedicated post-v0.1 redesign (GitHub issue #47) rather than incremental styling churn during the recorder reliability gate.

The redesign direction is:

- transcript-first Library layout;
- search/chat navigation emphasized over organization controls;
- one obvious primary action per context;
- progressive disclosure for organization, export/backup, diagnostics, QA and performance tools;
- compact model/activity/timestamp metadata;
- coherent purpose-designed light and dark themes;
- unobtrusive recorder pill;
- beginner-friendly default UI with keyboard/power-user paths preserved.

See `docs/design/material-design.md` for the original Material foundation; issue #47 supersedes the assumption that Material-like components alone are sufficient for the final information architecture.

### 6.9 Chat library

The library must support:

- list of archived conversations;
- provider/title/date/message count;
- provider filter;
- project/folder filtering;
- tags;
- rename/archive/delete;
- local search;
- open transcript;
- export;
- visible model metadata where available;
- collapsible provider-visible activity timeline associated with assistant responses;
- recording/storage health where applicable;
- appearance preference;
- Ctrl/Cmd+K focus/search power-user shortcut.

For the functional v0.1 release, correctness and inspectability are higher priority than the final information architecture. The dedicated UX redesign follows immediately after the functional release gate.

### 6.10 Search

Initial search should be local-only and include:

- conversation title;
- provider;
- project/folder;
- tags;
- user text;
- assistant text;
- provider-visible activity text;
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
- visible model label where the provider exposed one;
- provider-visible activity/work timeline clearly labeled as visible provider output and associated with the relevant assistant response;
- checkpoints/recording state boundaries where useful;
- attachment references/manifest when available.

Markdown export should preserve useful formatting where possible: headings, lists, code blocks, blockquotes, links and tables.

The export must not label provider-visible reasoning summaries as hidden/private chain-of-thought. It should use accurate labels such as **Visible reasoning summary**, **Work step** and **Status**.

#### JSON

Must export the normalized archive record and schema/version metadata suitable for re-import, including supported visible model/activity metadata.

### 6.12 Optional local-folder mirror

A user may explicitly select a directory using browser-supported filesystem permissions.

Requirements:

- folder connection is optional;
- user explicitly chooses the directory;
- permission state is visible;
- failed mirror writes do not delete or invalidate the browser archive;
- file names are deterministic and filesystem safe;
- title changes do not create uncontrolled duplicate archives;
- atomic/safer write patterns should be used when supported;
- mirror Markdown uses the same canonical export semantics, including provider-visible activity when present.

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

Pause suppression applies to:

- newly rendered user/assistant message content;
- newly rendered provider-visible reasoning/work/status activity;
- later rescans that would otherwise backfill content first seen only while paused.

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

Visible references to files/tools/artifacts shown during a response may be preserved as provider-visible activity even when the binary artifact itself is not backed up.

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

Each provider adapter must declare capability differences, especially for:

- stable conversation/turn IDs;
- streaming/finalization signals;
- historical/virtualized turn recovery;
- visible model labels;
- provider-visible reasoning/work/tool/status activity;
- attachment/artifact metadata.

Provider-specific limitations must be documented rather than hidden behind a misleading universal claim.

## 11. Future cloud/sync direction

Cloud is out of scope for v0.1 but the data model must not block it.

Preferred progression:

1. local browser archive;
2. optional local-folder mirror;
3. bring-your-own-cloud connectors (for example Drive/Dropbox/OneDrive/WebDAV/S3-compatible storage);
4. encrypted cross-device synchronization;
5. optional hosted service if justified.

Privacy goal for future sync: support client-side encryption so remote storage need not receive plaintext conversation content.

Cloud/sync work is deliberately scheduled after local capture, multi-provider support and context portability are dependable.

## 12. Project Context Pack / AI handoff

This is a prioritized post-v0.1 product milestone, not merely a distant future idea.

The export mode should generate a portable context package containing a user-selected combination of:

- project metadata;
- selected chats;
- key checkpoints;
- recent turns;
- selected historical turns;
- provider-visible reasoning summaries/work/status activity;
- visible model metadata where available;
- decisions/notes explicitly marked by the user;
- attachment/artifact manifest;
- source conversation references;
- optional full transcript;
- optional generated summary clearly marked as generated rather than archived source text.

The handoff goal is to improve continuity when starting a fresh conversation or moving to another provider. It must not claim to migrate hidden provider state, hidden reasoning or internal model memory.

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
- Provider-visible activity text is user-visible content and follows the same privacy/storage rules as transcript text.
- Privacy-safe QA reports may expose counts/state only and must not serialize prompt/answer/activity text, raw URLs, provider conversation IDs or titles.
- Future cloud credentials must use appropriate browser/OAuth credential flows and must not be embedded in code.

## 14. Accessibility

- Keyboard-operable controls.
- Visible focus states.
- Screen-reader labels for recording state and controls.
- Sufficient contrast.
- Status must not rely on color alone.
- Respect reduced-motion preferences where applicable.
- Ctrl/Cmd+K in the Library should provide fast search/command access for power users without making keyboard shortcuts mandatory for basic use.

## 15. Non-goals for v0.1

- recording every LLM provider at launch;
- building an LLM chat client;
- sending prompts/messages on the user's behalf;
- replacing provider-native history;
- extracting or reconstructing hidden/private chain-of-thought that the provider does not render;
- cloud accounts/subscriptions;
- team collaboration;
- server-side AI summarization;
- guaranteed binary backup of every attachment;
- final polished Library information architecture/visual redesign (tracked separately as issue #47);
- mobile browser support.

## 16. v0.1 functional release acceptance criteria

A functional release candidate is acceptable when authenticated ChatGPT testing demonstrates:

1. ChatGPT conversations can be recorded automatically across normal navigation.
2. User and assistant turns are captured in the correct order without routine duplicates.
3. Provider-rendered interruption/status responses are preserved rather than silently discarded.
4. Provider-visible work/reasoning/status activity observed during a response is retained with that response, including useful transient entries that later disappear from the provider UI.
5. A visible per-response model label is stored when ChatGPT actually exposes one; hidden/internal model metadata is not substituted when it does not.
6. Refresh/browser restart does not destroy already persisted turns/activity.
7. Pause excludes content and newly visible activity captured during the paused interval and resume works predictably without backfill.
8. Minimize/hide/move does not stop recording.
9. Stop explicitly stops capture.
10. The user can browse locally archived chats and inspect the stored visible-activity timeline.
11. The user can search archived transcript/activity text locally.
12. Markdown export is readable, preserves common formatting and clearly includes supported provider-visible context.
13. JSON export can round-trip the normalized archive model including supported model/activity metadata.
14. Historical import can recover supported rendered history without routine duplicates and restores the user's scroll position.
15. Storage/adapter health errors are visible.
16. No network service is required for core recording/search/export.
17. Production packaging retains the reviewed minimal permission/host/CSP/network boundary.
18. Recorder UI is usable, understandable and non-obstructive enough for the functional release; the larger visual/IA redesign remains a separate post-v0.1 milestone.
19. Automated tests cover normalization, deduplication, state transitions, visible-activity persistence/privacy, export/import and long-chat virtualization.
20. The exact release candidate passes the authenticated live QA protocol and the final release-preflight evidence gate.

## 17. Success measures

Early success is reliability-oriented rather than growth-oriented:

- no silent loss of finalized turns during normal usage;
- no silent loss of provider-visible work/activity that was observed while recording and is needed for handoff context;
- very low duplicate-turn/activity rate;
- successful recovery after refresh/restart/navigation;
- correct pause/resume boundaries across transcript and activity;
- exports that can restore useful project context in a fresh LLM thread;
- provider DOM changes surface visible adapter-health failures rather than silent corruption;
- the product never misrepresents hidden model reasoning as captured data.

## 18. Known risks

- provider DOM structures change without notice;
- provider-visible work/reasoning/tool UIs can be transient and structurally different from final answers;
- virtualized chat interfaces may unload old turns;
- streaming responses are difficult to finalize robustly across providers;
- browser filesystem permissions may expire or be revoked;
- provider terms/policies may constrain automation approaches;
- very large histories and activity timelines require indexing/storage discipline;
- encrypted sync adds key-management complexity;
- attachments/tool output differ significantly by provider;
- visible model labels may be absent or inconsistent even when a model was used;
- aggressive UI feature growth can make the Library unusable without deliberate information architecture, hence the dedicated redesign milestone.

## 19. Current product decisions

- Working name: **LLM Chat History**.
- Initial form factor: Chrome/Edge extension.
- Initial provider: ChatGPT.
- Canonical storage: local structured database/IndexedDB.
- Local filesystem copy: optional secondary mirror, not canonical storage.
- Cloud: deliberately deferred; architecture remains sync-ready.
- Provider support: adapter based.
- Visible session context: provider-visible activity is first-class archive data when technically observable.
- Reasoning boundary: save visible reasoning summaries/work; never infer hidden/private chain-of-thought.
- Model metadata: save only short human-readable model labels visibly exposed by the provider.
- Recorder UX: draggable placement plus Auto/Light/Dark appearance.
- Library power-user shortcut: Ctrl/Cmd+K focuses search in v0.1; future UX may evolve this into a command palette.
- Functional release vs polish: finish the reliable ChatGPT v0.1 release gate first; then execute the dedicated Library/recorder UX redesign in issue #47.
- Post-v0.1 sequence: UX redesign → provider SDK hardening/additional providers → context portability/handoff → backup/power-user expansion → encrypted sync/cloud.

## 20. Near-term product sequence after v0.1

### 20.1 Dedicated UX redesign

Tracked by GitHub issue #47.

The redesign must preserve all functional/data/privacy behavior while replacing the current dense interface with a transcript-first information architecture.

### 20.2 Multi-provider expansion

Harden the provider adapter SDK/test harness, then prioritize:

1. Claude
2. Perplexity
3. Grok
4. Gemini

Each provider must pass the same core reliability/privacy suite, with explicit provider-specific capability exceptions.

### 20.3 Context portability

Build Project Context Pack / AI Handoff so selected transcript, visible session activity, checkpoints, artifacts and metadata can be carried into a fresh thread/provider.

### 20.4 Backup and power-user layer

Prioritize:

- scheduled/local backups;
- browser-profile migration;
- provider-native export import;
- stronger attachment/citation/artifact preservation;
- duplicate/near-duplicate conversation detection;
- project timelines/local analytics;
- richer command palette and keyboard workflows.

### 20.5 Encrypted sync/cloud

Only after local capture, provider breadth and handoff portability are dependable.

## 21. Open decisions

To resolve during later product/architecture work:

- final normalized rich-text representation beyond current Markdown/plain-text support;
- search/index implementation for very large multi-provider archives;
- provider capability taxonomy for visible reasoning/work/tool/status capture;
- strategy for generated images/files and binary attachment backup;
- provider-native bulk import/migration semantics;
- context-pack size selection/summarization policy;
- encryption/key-management model for later sync;
- extension distribution/licensing strategy;
- final post-v0.1 Library/recorder design system after issue #47 mockup review.
