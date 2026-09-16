# LLM Chat History v0.1 — Known Limitations

Status: Release-candidate documentation
Version: 0.1.0

## Release blockers still open

### Authenticated live ChatGPT QA

The repository has extensive synthetic/unit/integration coverage, but current ChatGPT DOM behavior has not yet been authenticated against a real logged-in browser session because the connected browser automation environment could not start the required strict-agent run.

Issue #3 remains the authoritative live-validation gate. v0.1 must not be called release-ready until that evidence is recorded.

### First-time historical harvest for already-long threads

The recorder incrementally archives rendered turns and preserves turns already stored when ChatGPT virtualizes/unmounts them. Automated tests cover overlapping virtualized windows and long histories.

However, v0.1 does not yet provide an explicit scroll-and-harvest workflow that guarantees first-time capture of every historical turn in an already-long conversation whose older content is not currently rendered.

This capability is still tracked in issue #3 and must either be implemented/validated or explicitly re-scoped before final release approval.

## Functional limitations

- Initial provider support is ChatGPT only.
- Chrome/Edge are the initial supported browsers; Firefox/Safari are not validated.
- Mobile browser support is out of scope.
- The extension archives the active/rendered provider branch; provider-internal alternate/generated branch history is not normalized.
- Attachment metadata may be referenced, but binary attachment backup is not guaranteed.
- Generated images/files are not comprehensively mirrored as binary assets.
- The current full-text search is local and scans normalized archive records; it is not a dedicated large-scale search index.
- Very large whole-file JSON imports can cause local memory pressure because import validation currently loads the file as a whole.

## Formatting limitations

The ChatGPT adapter captures common semantic formatting into Markdown, including headings, emphasis, code, lists, blockquotes, safe links, tables and image alt labels.

Provider-specific visual widgets, canvases, interactive controls, complex artifacts and non-semantic layout may be flattened or omitted. Unsafe/unsupported links are not emitted as active Markdown links.

## Filesystem mirror limitations

- The mirror is optional and secondary; IndexedDB is canonical.
- Browser permission may require user-initiated reconnection after revocation/expiry.
- Library Delete does not erase previously written mirror files.
- Disconnecting a mirror does not erase existing files.
- External edits to mirrored Markdown are not imported back into the canonical archive.

## Deletion limitations

Deleting from the Library removes the browser archive copy only. It does not delete the provider-native ChatGPT conversation, downloaded exports or existing filesystem-mirror files.

## Diagnostics/profiling limitations

Diagnostics and performance reports intentionally omit content, which limits how much they can explain content-specific parsing defects. They are designed to identify adapter/storage/runtime health without exposing conversation text.

## Cloud/sync limitations

v0.1 has no cloud sync, cross-device account, server backup or hosted recovery service. Loss of the browser profile can therefore lose the canonical archive unless the user also has JSON/Markdown exports or a filesystem mirror.

## Provider-change risk

ChatGPT can change DOM structure without notice. v0.1 includes visible health degradation/error states and selector-failure diagnostics so breakage should be noisy rather than silent, but no DOM adapter can guarantee indefinite compatibility with unannounced provider changes.
