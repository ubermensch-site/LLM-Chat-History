# v0.1 Acceptance Evidence

This matrix maps the v0.1 PRD acceptance criteria to current evidence.

Status meanings:

- **PASS** — automated/repository evidence is complete.
- **LIVE REQUIRED** — implementation exists and automated coverage exists, but provider-runtime behavior still requires authenticated live ChatGPT validation.
- **BLOCKED / RESCOPE REQUIRED** — release cannot be approved until the capability is implemented/validated or the requirement is explicitly re-scoped.

| PRD acceptance criterion | Status | Evidence |
| --- | --- | --- |
| 1. ChatGPT conversations record automatically across normal navigation | LIVE REQUIRED | Adapter implementation + synthetic navigation tests exist; authenticated live ChatGPT validation remains issue #3. |
| 2. User/assistant turns are captured in correct order without routine duplicates | LIVE REQUIRED | 1,002-turn virtualization stress suite + dedupe tests PASS; live provider DOM/IDs still require issue #3 validation. |
| 3. Refresh/browser restart preserves persisted turns | LIVE REQUIRED | IndexedDB close/reopen and MV3 retry/idempotency tests PASS; live browser restart/worker recovery still required. |
| 4. Pause excludes content and resume is predictable | LIVE REQUIRED | Privacy suppression tests PASS, including no backfill after rescan; live pause/private/resume scenario remains required. |
| 5. Minimize/hide does not stop recording | LIVE REQUIRED | UI state-machine tests + implementation PASS; live interaction remains required. |
| 6. Stop explicitly stops capture | LIVE REQUIRED | Persisted stop/start state tests PASS; live interaction remains required. |
| 7. User can browse local archived chats | PASS | Library CRUD/transcript tests and production build PASS. |
| 8. User can search archived text locally | PASS | Ranked full-text search/navigation tests PASS. |
| 9. Markdown export is readable and preserves common formatting | LIVE REQUIRED | Export tests + DOM-to-Markdown structural serializer tests PASS; live ChatGPT semantic DOM mapping remains required. |
| 10. JSON export round-trips normalized archive model | PASS | Validation, fresh restore, idempotent re-import, cross-install merge and privacy-boundary tests PASS. |
| 11. Storage health/errors are visible | PASS | Recorder storage/adaptor health UI + diagnostics tests PASS. |
| 12. No network service is required for core recording/search/export | PASS | Hardened distribution verifier rejects network APIs; security review PASS. |
| 13. Material-based UI is usable without covering chat | LIVE REQUIRED | Compact pill + minimize/hide implementation and UI state tests PASS; actual provider-page placement remains live QA. |
| 14. Automated tests exist for normalization/dedupe/state/export | PASS | Full unit/integration/stress suite green in CI. |

## Additional release gates

### Authenticated live ChatGPT validation

**LIVE REQUIRED.** Issue #3 remains open. The required protocol is `docs/qa/live-chatgpt-validation.md`.

### Existing long-thread historical harvest

**BLOCKED / RESCOPE REQUIRED.** The extension reliably accumulates rendered/visited windows and synthetic virtualization coverage exceeds 1,000 turns, but it does not yet expose a deliberate first-time scroll-and-harvest workflow that guarantees traversal of an already-long conversation. Do not treat virtualization stress coverage as proof of historical import completeness.

### Packaging/security

**PASS.** The release branch produces a deterministic v0.1.0 ZIP, verifies CRC/content/checksum, enforces production no-source-map policy, minimal permissions, explicit CSP, no dynamic-code/HTML sinks and no v0.1 network APIs.

## Release decision

The repository is in **release-candidate preparation** state, not production-ready state. Do not tag/publish v0.1.0 until the live-required criteria pass and the historical-harvest gate is implemented/validated or explicitly re-scoped with a documented product decision.
