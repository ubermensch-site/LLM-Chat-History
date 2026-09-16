# LLM Chat History v0.1 — Release Checklist

Status: **BLOCKED — release preparation only**
Target version: 0.1.0
Tracking: TASK-054 issue #37

Do not mark this checklist complete or create a final v0.1 release solely from automated/synthetic evidence.

## 1. Version and source state

- [x] `package.json` version is 0.1.0.
- [x] extension manifest version is 0.1.0.
- [x] release build omits source maps.
- [x] dev/watch build may retain source maps.
- [ ] final approved release commit SHA recorded here.
- [ ] final release tag created only after all gates below pass.

## 2. Automated quality gates

Required on the exact final candidate commit:

- [ ] TypeScript typecheck green.
- [ ] Full unit/integration/stress tests green.
- [ ] Production extension build green.
- [ ] Security/distribution verifier green.
- [ ] Deterministic release packaging green.
- [ ] Unpacked extension artifact uploaded.
- [ ] Packaged `llm-chat-history-v0.1.0.zip` artifact uploaded.
- [ ] ZIP SHA-256 recorded in release notes/checklist.

The checklist boxes above remain open until the exact final RC head is known; earlier green runs are supporting evidence but not a substitute for the final-head gate.

## 3. Package inspection

For the exact final candidate ZIP:

- [ ] ZIP opens successfully and CRC validation passes.
- [ ] Contains only intended extension files.
- [ ] `manifest.json` reports 0.1.0 and Manifest V3.
- [ ] No `.map` files.
- [ ] No development/test/source files accidentally packaged.
- [ ] Only `storage` extension permission.
- [ ] Host permissions limited to `chatgpt.com` and `chat.openai.com`.
- [ ] Explicit extension CSP present.
- [ ] No remotely hosted executable code.
- [ ] Checksum matches CI-generated SHA-256 file.

## 4. Documentation

- [x] Chrome/Edge install/update instructions: `docs/release/install-v0.1.md`.
- [x] Privacy statement: `docs/release/privacy-v0.1.md`.
- [x] Known limitations: `docs/release/known-limitations-v0.1.md`.
- [x] Migration/data compatibility: `docs/release/migration-v0.1.md`.
- [x] Security/privacy review: `docs/security/security-privacy-review-v0.1.md`.
- [x] Changelog/release notes: `CHANGELOG.md`.
- [x] PRD acceptance evidence matrix: `docs/qa/v0.1-acceptance-evidence.md`.
- [x] Live ChatGPT QA protocol: `docs/qa/live-chatgpt-validation.md`.
- [ ] final release notes updated with exact artifact checksum and QA environment.

## 5. Authenticated live ChatGPT QA — BLOCKING

Issue #3 is the source of truth.

- [ ] Existing-conversation baseline passes.
- [ ] New-chat provisional → stable identity promotion passes.
- [ ] Streaming partial → one finalized archived message passes.
- [ ] SPA navigation A ↔ B keeps archives isolated.
- [ ] Pause/private/resume excludes private interval and prevents backfill.
- [ ] Stop/start persists and requires explicit restart.
- [ ] Minimize/hide changes UI only and capture continues.
- [ ] Refresh/MV3 wake recovery preserves archive and resumes writes.
- [ ] Long-thread virtualization does not delete/duplicate captured turns.
- [ ] Library/search/Markdown/JSON smoke test passes.
- [ ] Current semantic selectors/IDs documented without private content.
- [ ] Adapter health remains healthy/degraded as expected; no silent selector failure.

## 6. Historical long-thread import — BLOCKING OR REQUIRES EXPLICIT RESCOPE

Original TASK-012 scope includes an explicit historical scroll-and-harvest/import path for already-long conversations.

- [ ] Implement and validate historical harvest, **or**
- [ ] deliberately re-scope it out of v0.1 with PRD/roadmap/issue/release-notes changes approved before release.

Do not infer full historical coverage from the existing >1,000-turn synthetic virtualization tests; those prove reconciliation/retention logic, not that the provider has rendered every historical turn during first-time capture.

## 7. Privacy/security manual smoke checks

- [ ] Archived provider text displays as inert text in Library.
- [ ] Unsafe links/content do not become executable UI.
- [ ] Pause test confirms omitted text absent from Markdown and JSON.
- [ ] Diagnostics download contains no conversation text/URL/title/checkpoint notes.
- [ ] Performance report contains aggregate metadata only.
- [ ] Library Delete warning clearly states browser-only deletion scope.
- [ ] Filesystem mirror permission loss shows warning without affecting canonical capture.

## 8. Upgrade/uninstall smoke checks

- [ ] Upgrade a prior development install to 0.1.0 without uninstalling and confirm existing IndexedDB archive remains readable.
- [ ] Confirm database v2 project migration behavior for a v1 fixture (automated test already exists; optional manual browser smoke recommended).
- [ ] Export JSON, import into a clean profile/install, and verify round-trip locally.
- [ ] Verify uninstall warning/documentation is understood: extension-owned browser storage may be removed.

## 9. Release approval

Only after sections 1–8 are satisfied:

- [ ] issue #3 closed with authenticated live evidence.
- [ ] TASK-054 issue #37 updated with final evidence.
- [ ] PR #38 (or successor final RC PR) ready and green on exact head.
- [ ] merge final RC changes to `main`.
- [ ] create/tag final v0.1.0 release artifact from the approved commit.
- [ ] publish checksum + install/privacy/limitations links with release notes.

Until then, v0.1.0 is a **release candidate under validation**, not a production-ready release.
