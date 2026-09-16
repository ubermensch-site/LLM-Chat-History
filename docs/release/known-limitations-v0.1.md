# LLM Chat History v0.1 — Known Limitations

Status: Release-candidate documentation
Version: 0.1.0

## Release blocker still open

### Authenticated live ChatGPT QA

The repository has extensive synthetic/unit/integration coverage, and explicit historical import is now implemented, but the exact current ChatGPT runtime has not yet been validated with the extension loaded in a real logged-in Chrome/Edge session.

Issue #3 remains the authoritative live-validation gate. v0.1 must not be called release-ready until that evidence is recorded.

## Historical import limitations

v0.1 now includes an explicit **Import history** action in the recorder for already-long ChatGPT conversations.

The import:

- is manual and never starts silently;
- is available only while actively recording;
- refuses to start while an assistant response is still streaming;
- temporarily scrolls upward and then downward through the current conversation;
- captures rendered/virtualized windows through the same canonical archive and dedupe pipeline;
- aborts if the active conversation changes;
- restores the user's original distance-from-bottom after completion/failure;
- stops at a 500-window safety limit rather than looping indefinitely.

Automated tests cover a 1,002-turn virtualized history, lazy older-history expansion, failure restoration and truncation. However, provider lazy-loading/virtualization behavior can change, so this workflow still requires authenticated live ChatGPT validation before v0.1 release approval. If the safety cap is reached, the UI reports truncation and the user may run the import again.

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
