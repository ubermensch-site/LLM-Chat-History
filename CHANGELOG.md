# Changelog

## 0.1.0 — Release candidate

Status: not yet release-approved. Authenticated live ChatGPT validation remains required before final release.

### Added

- Manifest V3 Chrome/Edge extension shell with least-privilege ChatGPT host access.
- Automatic ChatGPT conversation/turn capture with provisional-to-stable conversation identity promotion.
- Canonical IndexedDB archive with conversations, messages, events and projects.
- Streaming-safe/idempotent turn updates and crash/restart recovery.
- Per-conversation recording states: recording, paused, stopped and error.
- Privacy-safe pause/stop suppression that prevents later DOM rescans from backfilling omitted content.
- Compact Material-style recorder pill with minimize, hide, pause/resume/start, confirmed stop, checkpoint and Library actions.
- Visible local-storage and adapter-health status.
- Local Library with transcript viewing, rename, archive/unarchive and confirmed cascade delete.
- Projects, folders, tags and Unsorted fallback.
- Local full-text search with message/checkpoint navigation.
- Checkpoints/notes with timeline rendering and recorder-side creation.
- Markdown export with metadata, state boundaries and checkpoint markers.
- Versioned JSON export/import with validation, atomic restore, idempotent re-import and collision handling.
- Optional local computer-folder mirror using user-selected File System Access permission.
- Deterministic cross-platform mirror paths with stable conversation identity.
- Safe/coalesced mirror writer that never becomes part of canonical archive success.
- Adapter selector-failure detection with visible degraded/error diagnostics.
- Privacy-safe diagnostics export containing health metadata only.
- Local performance/storage profiling with bounded samples and aggregate reports.
- Rich ChatGPT DOM-to-Markdown capture for headings, emphasis, code, lists, blockquotes, safe links, tables and image alt labels.
- Deterministic release ZIP packaging with SHA-256 checksum.

### Reliability and security

- 1,002-turn virtualization/overlap stress coverage.
- Rapid conversation switching, refresh-during-streaming and privacy-rescan tests.
- 10,000-message archive footprint profiling fixture.
- Explicit MV3 extension CSP.
- CI distribution verifier for minimal permissions/hosts, no remote scripts, no inline JavaScript/event handlers, no eval/new-Function, no HTML-injection sinks and no v0.1 network APIs.
- Production release builds omit source maps.

### Known release blockers

- Authenticated live ChatGPT QA evidence has not yet been completed; see issue #3 and `docs/qa/live-chatgpt-validation.md`.
- Explicit first-time historical scroll-and-harvest for already-long conversations is not yet implemented/validated; current behavior incrementally captures rendered/visited turns and safely retains them through virtualization.

### Known limitations

See `docs/release/known-limitations-v0.1.md` and `docs/release/privacy-v0.1.md`.
