# LLM Chat History v0.1 — Migration and Data Compatibility

Status: Release-candidate documentation
Version: 0.1.0

## Canonical browser archive

The extension-owned IndexedDB database is named `llm-chat-history`.

The current database schema version is **2**.

Stores:

- `conversations`
- `messages`
- `events`
- `projects`

Existing v1 archives upgrade in place to v2 by adding the provider-neutral project store while leaving existing conversations valid as Unsorted unless explicitly assigned.

The browser archive remains canonical even when an optional filesystem mirror is enabled.

## Portable JSON archive format

JSON exports use:

- schema: `llm-chat-history/archive-export`
- schema version: **1**

The JSON schema version is independent from the IndexedDB database version.

A v1 JSON export contains the normalized conversation, messages, archive events, export timestamp and optional project definition.

## Import behavior

The importer validates the complete JSON bundle before committing archive changes.

Supported behaviors include:

- fresh restore preserving normalized conversation/message identity where safe;
- idempotent re-import of the same archive;
- merge into an existing provider conversation across installations;
- deterministic remapping where internal IDs differ;
- preservation/remapping of checkpoints and pause/private suppression events;
- project/folder referential-integrity validation;
- rejection of unrelated internal-ID collisions instead of overwriting local history.

Import is atomic at the archive transaction boundary: malformed/conflicting input must not leave a partially restored conversation.

## Updating the extension

For unpacked installations, replace the extension files with the newer release candidate and use **Reload** in `chrome://extensions` or `edge://extensions`.

Do not remove the extension before updating if you want to retain the existing browser archive. Uninstalling the extension can remove extension-owned local storage.

Before a major update, a JSON export and/or filesystem mirror is recommended as an independent backup.

## v0.1.0 compatibility expectations

- Database schema: v2
- JSON export schema: v1
- Initial provider: ChatGPT
- Browser target: Chromium/Chrome/Edge Manifest V3

Future database migrations must preserve existing v2 data or provide an explicit migration path. Future JSON schema changes must use a new schema version and keep import behavior explicit rather than silently accepting incompatible payloads.

## Filesystem mirror compatibility

Mirror Markdown is a human-readable secondary representation, not the canonical import format.

Stable conversation identity is embedded in deterministic filesystem naming so title changes can update/rename an existing mirror rather than creating uncontrolled duplicates.

External edits to mirror Markdown are not currently synchronized back to IndexedDB.

## Rollback caution

Rolling back to a materially older development build is not guaranteed to understand newer database fields/behaviors. Use a JSON backup before testing old builds, and prefer restoring into a separate browser profile rather than downgrading a production archive in place.
