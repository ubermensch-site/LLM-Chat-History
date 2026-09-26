# AI Chat History

AI Chat History is a local-first browser extension for automatically archiving conversations across AI chat providers while keeping users in control of what is recorded, stored, exported, and synced.

> Repository note: the code repository is still named `LLM-Chat-History` after its transfer into the `aichathistory` organization. Product policy and cross-repository ownership are canonical in [aichathistory/aichathistory](https://github.com/aichathistory/aichathistory).

## Product direction

The project starts with ChatGPT support and is designed to expand to Claude, Perplexity, Grok, Gemini, and other LLM interfaces through provider adapters.

### Core principles

- **Local first** — conversations are captured and stored locally by default.
- **User controlled** — recording is always visible and can be paused, resumed, or stopped.
- **Provider independent** — every supported LLM is normalized into a common archive format.
- **Portable** — Markdown and JSON exports remain usable outside the extension.
- **Recoverable** — archives survive lost chat threads, navigation, refreshes, and browser restarts.
- **Privacy first** — no telemetry or remote upload is required for the core product.
- **Cloud optional** — future sync supports user-selected storage rather than making cloud storage mandatory.

## Initial scope

Version 0.1 focuses on a reliable ChatGPT recorder for Chrome/Edge with:

- automatic conversation detection;
- continuous user/assistant turn capture;
- pause, resume, stop, and checkpoint controls;
- compact/minimized recorder UI;
- IndexedDB-backed local archive;
- Markdown and JSON export/import;
- projects, folders, tags, and full-text search;
- optional user-selected local-folder Markdown mirror;
- crash-safe incremental persistence;
- conversation deduplication and stable IDs;
- adapter failure diagnostics;
- local performance/storage profiling;
- Material Design 3 based UI.

## Privacy and deletion boundaries

Version 0.1 is intentionally local-first. The extension does not require telemetry, a hosted backend, or remote upload for normal recording, Library, search, diagnostics, or performance profiling.

- **Pause/Stop privacy:** turns intentionally omitted while paused or stopped are not stored as transcript content, and later DOM rescans cannot silently backfill them.
- **Library Delete:** deleting a conversation removes that conversation, its captured messages, and its conversation events from the extension's browser IndexedDB archive.
- **Provider copy remains:** Library Delete does **not** delete the original ChatGPT conversation from ChatGPT.
- **Filesystem mirror copies remain:** if the optional computer-folder mirror previously wrote a Markdown file, Library Delete or Disconnect does **not** erase that file. Remove retained mirror files manually if you want those external copies deleted.
- **Exports remain external copies:** Markdown/JSON files the user explicitly downloaded are outside the extension's deletion control.
- **Diagnostics/profiling:** downloadable diagnostics and performance reports are designed to contain health/performance aggregates rather than chat bodies, titles, URLs, checkpoint notes, or search queries.

See the [v0.1 security and privacy review](docs/security/security-privacy-review-v0.1.md) for the detailed threat boundary, findings, and residual risks.

## Documentation

- [Product requirements](docs/prd/product-requirements.md)
- [Development roadmap](docs/roadmap/development-roadmap.md)
- [Architecture](docs/architecture/architecture.md)
- [Material Design UI brief](docs/design/material-design.md)
- [v0.1 security and privacy review](docs/security/security-privacy-review-v0.1.md)

## Status

**Phase 5 — reliability and v0.1 release-candidate preparation.**

The core local recorder/archive pipeline is implemented and heavily automated-tested. No production release has been published yet. Authenticated live ChatGPT browser QA remains a release gate before v0.1 is declared ready.
