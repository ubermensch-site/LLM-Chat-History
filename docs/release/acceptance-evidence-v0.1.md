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
| 11. Storage health/errors are visible | PASS | Recorder storage/adapter health UI + diagnostics tests PASS. |
| 12. No network service is required for core recording/search/export | PASS | Hardened distribution verifier rejects network APIs; security review PASS. |
| 13. Material-based UI is usable without covering chat | LIVE REQUIRED | Compact pill + minimize/hide implementation and UI state tests PASS; actual provider-page placement remains live QA. |
| 14. Automated tests exist for normalization/dedupe/state/export | PASS | Full unit/integration/stress suite green in CI. |

## Additional release gates

### Authenticated live ChatGPT validation

**LIVE REQUIRED.** Issue #3 remains open. The required protocol is `docs/qa/live-chatgpt-validation.md`.

### Existing long-thread historical harvest

**LIVE REQUIRED.** Explicit first-time scroll-and-harvest is implemented in `main` as of `ea8d09a`.

Automated evidence now covers:

- a deliberate **Import history** recorder action rather than silent scrolling;
- import only while recording and not while an assistant response is streaming;
- bounded upward-then-downward traversal with stable top/bottom detection;
- overlapping virtualized windows by construction;
- canonical retry/dedupe persistence for every harvested window;
- conversation-change abort;
- restoration of the user's original distance-from-bottom even on failure;
- a 500-window safety cap;
- a 1,002-turn synthetic virtualized-history traversal;
- lazy older-history expansion at the top;
- failure restoration and truncation behavior.

The first CI run caught a real defect where a 240px minimum scroll step could exceed a small viewport and skip virtualized windows. The algorithm was corrected so every step is strictly less than the current viewport height; the unchanged long-history tests then passed.

This capability still requires authenticated live validation against current ChatGPT virtualization/lazy-loading behavior before release approval.

### Packaging/security

**PASS.** The release build produces a deterministic v0.1.0 ZIP, verifies CRC/content/checksum, enforces production no-source-map policy, minimal permissions, explicit CSP, no dynamic-code/HTML sinks and no v0.1 network APIs.

## Release decision

The repository is in **release-candidate preparation** state, not production-ready state. The historical-import implementation gap is closed; do not tag/publish v0.1.0 until the remaining live-required ChatGPT scenarios pass on an authenticated browser session.
