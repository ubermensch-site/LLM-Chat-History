# LLM Chat History v0.1 — Privacy Statement

Status: Release-candidate documentation
Version: 0.1.0

## Summary

LLM Chat History v0.1 is local-first. Core recording, browsing, search, export, diagnostics and profiling do not require a server account or remote service.

## What the extension reads

On supported ChatGPT pages, the content script reads rendered conversation structure and rendered user/assistant content needed to build the local archive. Provider page content is treated as untrusted input and is normalized into local records.

The extension does not send prompts or messages on the user's behalf.

## What is stored locally

The canonical archive is stored in extension-owned IndexedDB and may contain:

- conversation identity and source URL;
- provider title and optional user rename;
- user and assistant message content;
- normalized Markdown/plain text;
- project/folder/tag metadata;
- recording-state events;
- checkpoints and checkpoint notes;
- adapter-health events.

Recorder state is per conversation.

## Pause and Stop privacy semantics

While a conversation is paused or stopped, newly observed content is not persisted as message content.

The archive records content-free suppression/state markers so a later DOM rescan cannot silently backfill omitted turns. Existing automated tests explicitly verify that paused/stopped text does not appear in archived messages or event payloads.

Minimizing or hiding the recorder UI does not pause or stop recording.

## Network behavior

v0.1 has no application network client. The release verifier rejects shipped bundle usage of `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` and `sendBeacon`.

There is no telemetry, analytics, cloud sync or remote upload in v0.1.

Host permissions are limited to:

- `https://chatgpt.com/*`
- `https://chat.openai.com/*`

The only extension permission is `storage`.

## Optional computer-folder mirror

Users may explicitly connect a local computer directory through the browser File System Access API. When enabled, Markdown copies are written to that user-selected folder.

The browser IndexedDB archive remains canonical. Folder permission failure or write failure never invalidates the browser archive.

Disconnecting the folder prevents future mirror writes but does not erase files already written there.

## Exports

Markdown and JSON exports contain archived conversation content and metadata by design. They become ordinary files outside extension-managed storage and remain the user's responsibility after download.

Deleting a conversation from the Library does not erase previously downloaded exports.

## Diagnostics and performance reports

Diagnostics and profiling exports are intentionally content-free/aggregate-only. They exclude message bodies, source URLs, conversation titles, checkpoint notes, project/folder names and tags.

## Deletion scope

Library Delete removes the selected conversation and its associated messages/events from the browser archive atomically.

It does **not** delete:

- the original conversation from ChatGPT;
- previously downloaded Markdown/JSON files;
- previously written computer-folder mirror files.

This scope is also displayed in the Library UI.

## Security controls

The packaged extension uses Manifest V3, an explicit extension-page CSP, no remotely hosted executable code, and CI checks that reject eval-like execution, dynamic HTML injection sinks and unexpected network APIs in release bundles.

Archived provider content is rendered with text-node APIs rather than executable HTML.

See `docs/security/security-privacy-review-v0.1.md` for the detailed review.

## Future cloud features

Cloud sync is intentionally out of scope for v0.1. Any future cloud implementation requires a separate threat model, conflict model and client-side encryption/key-management design before release.
