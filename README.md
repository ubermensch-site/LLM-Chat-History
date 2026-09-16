# LLM Chat History

LLM Chat History is a local-first browser extension for automatically archiving conversations across AI chat providers while keeping users in control of what is recorded, stored, exported, and synced.

> **Working name:** the product may be renamed later without changing the architecture.

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
- Markdown and JSON export;
- projects, folders, tags, and full-text search;
- optional user-selected local-folder mirror;
- crash-safe incremental persistence;
- conversation deduplication and stable IDs;
- Material Design 3 based UI.

## Documentation

- [Product requirements](docs/prd/product-requirements.md)
- [Development roadmap](docs/roadmap/development-roadmap.md)
- [Architecture](docs/architecture/architecture.md)
- [Material Design UI brief](docs/design/material-design.md)

## Status

**Phase 0 — product definition and technical foundation.**

No production extension has been released yet.
