# LLM Chat History — Development Roadmap

Status: Active v0.1 functional release  
Primary target: Chrome/Edge  
Initial provider: ChatGPT  
Current exact functional candidate: `b611c3936a8902246692d4cad2d128c6af971cdc`

## Roadmap principles

- Build reliability before provider breadth.
- Keep capture, normalization, storage and UI loosely coupled.
- Make failures visible rather than silently dropping history.
- Keep the browser-local archive canonical for v0.1.
- Preserve everything useful that the provider visibly renders while respecting explicit Pause/Stop privacy boundaries.
- Never claim to capture hidden/private chain-of-thought that the provider does not render.
- Keep provider-visible model/activity metadata separate from provider-internal assumptions.
- Add optional mirrors/sync only after core recording is dependable.
- Treat provider adapters as replaceable integration modules.
- Separate functional release correctness from major UI/UX redesign work.

## Current execution status — 2026-09-16

### Completed / implemented on `main`

The original roadmap Phases 0–5 are substantially implemented:

- repository/PRD/architecture/roadmap foundation;
- MV3 Chrome/Edge extension shell;
- canonical IndexedDB archive and schema migrations;
- ChatGPT provider adapter with stable/provisional identity handling;
- Pause/Resume/Stop/Start state machine and strict non-backfill privacy behavior;
- incremental persistence, retries, ACKs and restart recovery;
- recorder overlay and Library;
- Markdown + JSON export/import;
- projects/folders/tags/search/checkpoints;
- optional local filesystem mirror with deterministic paths and safe coalesced writes;
- long-chat/virtualization stress coverage including 1,002 synthetic turns;
- adapter failure diagnostics;
- performance/storage profiling;
- security/privacy hardening and production bundle verifier;
- deterministic release ZIP packaging;
- explicit historical scroll-and-harvest import;
- privacy-safe live QA reports and local evidence validator;
- visible model-label capture when the provider actually shows a human-readable model name;
- cumulative provider-visible activity capture (visible reasoning summaries, tool/work/status activity) with Pause privacy;
- visible-activity search/export/restore/Library support;
- draggable recorder position;
- Auto/Light/Dark appearance support;
- Ctrl/Cmd+K Library search shortcut.

### Still blocking the v0.1 functional release

- complete authenticated live ChatGPT QA on the exact current candidate;
- validate all release scenarios after the newest visible-activity/model/UX functional changes;
- update/rebase final release-preflight tooling from the earlier candidate to the exact final candidate/schema;
- run final exact-candidate CI/package/security gate;
- close TASK-012 / issue #3 and TASK-054 / issue #37 only after authenticated evidence passes;
- tag/publish v0.1.0 only after those gates pass.

### Explicitly deferred until after the functional v0.1 release

- major Library/recorder visual and information-architecture redesign — tracked as issue #47;
- additional providers;
- full Project Context Pack / AI Handoff product;
- cloud/cross-device sync.

---

## Phase 0 — Foundation and product definition — COMPLETE

### TASK-001 — Repository and documentation scaffold — COMPLETE

Scope:
- establish README;
- PRD;
- architecture document;
- Material Design brief;
- roadmap;
- contribution/testing conventions.

### TASK-002 — Technical spike: ChatGPT DOM and lifecycle — IMPLEMENTED / CONTINUOUSLY LIVE-VALIDATED

Scope:
- document current conversation URL/ID behavior;
- identify stable user/assistant turn signals;
- test streaming behavior;
- test SPA navigation;
- test virtualized long threads;
- identify resilient selector/fallback strategy;
- record failure modes.

Provider DOM behavior remains an ongoing live-validation concern rather than a permanently closed assumption.

### TASK-003 — Extension architecture decision — COMPLETE

Architecture is MV3 + TypeScript/esbuild with provider adapters, content script, background worker, browser-local IndexedDB canonical archive and extension Library.

---

## Phase 1 — Minimal reliable recorder — IMPLEMENTED; FINAL LIVE GATE OPEN

### TASK-010 — Manifest V3 extension shell — COMPLETE

### TASK-011 — Canonical archive schema v1+ — COMPLETE

Canonical browser archive now supports conversations/messages/events/projects plus later metadata and migrations.

### TASK-012 — ChatGPT provider adapter v1 — IMPLEMENTED; AUTHENTICATED LIVE ACCEPTANCE STILL OPEN (#3)

Current adapter responsibilities include:

- provider detection;
- stable/provisional conversation identity;
- title/source extraction;
- user/assistant message extraction;
- streaming/finalization handling;
- SPA navigation;
- virtualized/historical harvesting;
- dedupe inputs;
- adapter health events;
- visible human-readable model labels when actually exposed by ChatGPT;
- provider-visible session activity capture, including visible reasoning summaries, searches/browsing/tool/work/status activity when rendered in the UI.

Boundary:
- preserve provider-visible activity;
- do not infer or claim access to hidden/private chain-of-thought.

### TASK-013 — Recorder state machine — COMPLETE

States:
- recording;
- paused;
- stopped;
- error.

Pause/Stop privacy applies to transcript text and provider-visible activity, and omitted content cannot later backfill.

### TASK-014 — Incremental/crash-safe persistence — COMPLETE

Includes idempotent upserts, partial/final transitions, retries/ACKs, restart recovery and cumulative visible-activity persistence.

---

## Phase 2 — Recorder UI and exports — FUNCTIONALLY IMPLEMENTED

### TASK-020 — Recorder pill — FUNCTIONALLY COMPLETE; VISUAL REDESIGN DEFERRED TO #47

Current capabilities:
- compact floating recorder;
- recording/paused/error/stopped state;
- draggable placement with saved viewport-clamped position;
- hide/minimize does not stop recording;
- Auto/Light/Dark appearance;
- plain-language copy and technical disclosure.

The current visuals are not considered final product UX.

### TASK-021 — Expanded recorder controls — COMPLETE

Includes Pause/Resume, Stop/Start, Library, checkpoint flow, manual historical import, QA report and state/health information.

### TASK-022 — Markdown exporter v1 — COMPLETE

Exports ordered transcript, common formatting, checkpoints/boundaries, visible model labels and provider-visible activity/work timeline with accurate labels.

### TASK-023 — JSON exporter/import foundation — COMPLETE

Versioned JSON backup/restore preserves the supported normalized archive model, including visible model/activity metadata.

---

## Phase 3 — Archive Library — FUNCTIONALLY IMPLEMENTED; UX REDESIGN DEFERRED

### TASK-030 — Library shell — COMPLETE FUNCTIONALLY

### TASK-031 — Projects, folders and tags — COMPLETE

### TASK-032 — Local full-text search — COMPLETE

Search includes transcript text, organization/checkpoint metadata and provider-visible activity text.

### TASK-033 — Checkpoints and notes — COMPLETE

### Current UX finding

Authenticated user testing confirms the Library is functionally capable but visually dense and poorly prioritized. The product should not continue incremental styling patches during release QA. A dedicated information-architecture/visual redesign is tracked by **issue #47**.

---

## Phase 4 — Optional filesystem mirror — COMPLETE FOR v0.1

### TASK-040 — Folder connection — COMPLETE

### TASK-041 — Deterministic filesystem layout — COMPLETE

Current stable layout remains conceptually:

`LLM Chat History/<Project>/<YYYY-MM>/<timestamp>__<provider>__<title>--<stable-id>.md`

### TASK-042 — Safe mirror writer — COMPLETE

Browser IndexedDB remains canonical. Mirror failure/permission loss never invalidates successful local capture.

---

## Phase 5 — Reliability and functional release candidate — ACTIVE

### TASK-050 — Long-chat virtualization stress test — COMPLETE

Includes 1,002-turn synthetic history, overlapping virtualized windows, rapid A↔B navigation, restart during streaming, provisional→stable promotion and Pause non-backfill coverage.

### TASK-051 — DOM change/failure detection — COMPLETE

Adapter health diagnostics make breakage visible instead of silently losing history.

### TASK-052 — Performance/storage profiling — COMPLETE

### TASK-053 — Security/privacy review — COMPLETE

Production verifier enforces minimal permissions/hosts/CSP and rejects unexpected network APIs, remote code, unsafe dynamic HTML/script execution and production source maps.

### TASK-054 — v0.1 functional release candidate — ACTIVE / BLOCKED ON AUTHENTICATED QA (#37)

Required remaining sequence:

1. Run the exact current candidate through the authenticated ChatGPT live protocol.
2. Verify baseline capture/Library persistence.
3. Verify new-chat provisional→stable identity.
4. Verify streaming/finalization and provider-visible activity capture.
5. Verify SPA navigation across conversations.
6. Verify Pause/private/Resume, including activity-only privacy/non-backfill.
7. Verify Stop/Start.
8. Verify minimize/hide/move semantics.
9. Verify refresh/MV3 worker recovery.
10. Verify long-thread historical import, idempotency and scroll restoration.
11. Verify Library/search/Markdown/JSON round trip including visible activity/model metadata.
12. Verify the draggable recorder, appearance persistence and Ctrl/Cmd+K functional behavior.
13. Generate privacy-safe QA reports before/after scenarios where counts/state matter.
14. Bring release-preflight tooling forward to the exact candidate/schema and run it on the completed human QA session.
15. Run full exact-candidate CI, build, security verifier and deterministic package gate.
16. Close #3 and #37 only if all required evidence passes.
17. Create/tag/publish v0.1.0 only after the above gates.

### TASK-055 — Visible session context and functional UX pass — IMPLEMENTED; LIVE VALIDATION IN PROGRESS

Delivered:
- preserve all provider-rendered user/assistant responses, including visible interruption/status responses;
- visible model labels only when provider-exposed and human-readable;
- cumulative visible activity timeline for rendered reasoning summaries/work/tool/status text;
- Pause/Stop activity suppression and non-backfill;
- visible activity in Library/search/Markdown/JSON/mirror output;
- count-only visible-activity field in privacy-safe QA evidence;
- draggable recorder;
- Auto/Light/Dark appearance;
- Ctrl/Cmd+K Library search;
- plain-language functional UI copy.

This task does **not** claim the final UI/UX is good; that is intentionally separated into the next phase.

---

## Phase 5.5 — Dedicated UX redesign — NEXT AFTER v0.1 FUNCTIONAL RELEASE

### TASK-056 / issue #47 — Recorder + Library information architecture and visual system

Do not execute this as piecemeal CSS cleanup during release QA.

Process:
1. produce low-fidelity information-architecture mockup;
2. produce one polished dark and one polished light direction;
3. get user review/approval before implementation;
4. implement behind existing data/runtime contracts;
5. re-run usability validation without changing recorder/storage semantics.

Target direction:
- transcript-first Library;
- left sidebar focused primarily on search + chat navigation;
- conversation header with a small number of obvious actions;
- organization/checkpoints/export/backup/diagnostics/QA/performance behind drawer/menu/modal disclosure;
- compact provider/model/activity/timestamp metadata;
- visible-work timeline that is useful without overpowering the answer;
- coherent light/dark design tokens;
- unobtrusive draggable recorder;
- beginner-friendly defaults plus keyboard/power-user access.

---

## Phase 6 — Multi-provider architecture expansion

Start after the ChatGPT functional recorder/release gate is stable. The UX redesign may proceed before or alongside provider SDK work only if it does not destabilize the capture/storage contracts.

### TASK-060 — Provider adapter SDK/contract hardening

Deliver:
- formal adapter interface;
- provider capability flags;
- shared adapter test harness;
- fixture strategy;
- explicit capability declarations for stable IDs, streaming, historical import, visible model labels, visible work/reasoning/tool/status activity and artifact metadata.

### TASK-061 — Claude adapter

### TASK-062 — Perplexity adapter

### TASK-063 — Grok adapter

### TASK-064 — Gemini adapter

Each provider must pass the same core capture/navigation/pause/dedupe/recovery/privacy suite with provider-specific exceptions documented.

---

## Phase 7 — Context portability — HIGH PRIORITY AFTER PROVIDER FOUNDATION

### TASK-070 — Project Context Pack / AI handoff export

Deliver configurable export containing:
- project metadata;
- selected chats;
- checkpoints;
- recent/selected historical turns;
- provider-visible reasoning summaries/work/status activity;
- visible model metadata when available;
- attachment/artifact manifest;
- source conversation references;
- optional full transcript;
- optional generated summary clearly marked as generated.

Goal:
- make a fresh LLM chat useful quickly without losing the provider-visible work history that led to the current state.

### TASK-071 — Cross-provider handoff helpers

Goal:
- prepare context for continuing work in another provider without pretending to migrate hidden/provider-internal state, hidden chain-of-thought or provider memory.

---

## Phase 7.5 — Backup, migration and power-user layer

### TASK-075 — Scheduled/local backup workflow

### TASK-076 — Browser profile/archive migration helper

### TASK-077 — Provider-native export import

### TASK-078 — Richer attachment/citation/artifact preservation

### TASK-079 — Power-user command palette and archive tooling

Candidate capabilities:
- evolve Ctrl/Cmd+K from search focus into a command palette;
- project-level timeline;
- duplicate/near-duplicate chat detection;
- local analytics;
- batch organization/export actions;
- scheduled exports/backups.

---

## Phase 8 — Cloud and cross-device sync

Cloud work remains intentionally deferred until local correctness, provider breadth and handoff portability are proven.

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

---

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
- local analytics such as chat/message/activity/storage counts;
- retention policies;
- scheduled exports/backups;
- browser profile migration helper;
- Firefox support;
- Safari support;
- native desktop companion if browser filesystem constraints become limiting;
- optional Git repository archive target;
- optional user-owned object storage;
- import from provider-native data exports.

## Immediate execution order — CURRENT

1. **TASK-054 — Finish v0.1 functional release QA on ChatGPT.**
   - exact candidate: `b611c3936a8902246692d4cad2d128c6af971cdc` until changed by a real QA fix;
   - complete authenticated scenario evidence;
   - fix only real functional defects and retest changed behavior.
2. **Bring release-preflight tooling forward to the exact final candidate/schema.**
   - earlier PR #44 was built against an older candidate and must not be merged blindly;
   - update candidate metadata and visible-activity QA schema expectations;
   - keep all 10 scenario/human-approval requirements strict.
3. **Final exact-candidate gate and v0.1.0 release.**
   - CI/typecheck/tests/build/security verifier/package;
   - close #3/#37 only after authenticated evidence passes;
   - tag/publish v0.1.0.
4. **Issue #47 — dedicated UX redesign.**
   - mockup first, user approval second, implementation third.
5. **TASK-060 → 064 — provider architecture + Claude/Perplexity/Grok/Gemini.**
6. **TASK-070/071 — Context Pack + cross-provider handoff.**
7. **TASK-075–079 — backup/migration/power-user layer.**
8. **TASK-080 onward — encrypted sync/cloud.**

## Release discipline

- Automated tests support but never substitute for authenticated provider-runtime QA.
- Do not mark v0.1 production-ready while required authenticated scenarios are incomplete.
- Do not weaken tests/verifiers to make a candidate pass.
- If live QA finds a defect, fix it on a branch from the tested candidate, add regression coverage, merge only after full CI, then live-retest the affected behavior.
- UI/UX criticism alone should be tracked separately from functional recorder correctness unless it prevents the acceptance scenario from being completed.
