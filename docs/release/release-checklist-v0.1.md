# LLM Chat History v0.1 — Release Checklist

Status: **BLOCKED — authenticated live validation required**
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

Current repository evidence:

- [x] TypeScript typecheck green.
- [x] Full unit/integration/stress tests green.
- [x] Production extension build green.
- [x] Security/distribution verifier green.
- [x] Deterministic release packaging green.
- [x] Unpacked extension artifact upload proven in CI.
- [x] Packaged `llm-chat-history-v0.1.0.zip` artifact upload proven in CI.
- [x] Historical-import 1,002-turn/lazy-load/failure-restoration/truncation tests green.

These prove implementation quality but do not replace the final exact-candidate gate after live QA.

## 3. Package inspection

For the exact final candidate ZIP after live QA:

- [ ] record final CI run number and commit SHA.
- [ ] record packaged artifact name.
- [ ] record GitHub artifact SHA-256 digest.
- [ ] record internal release ZIP `.sha256` value.
- [ ] ZIP opens successfully and CRC validation passes.
- [ ] contains only intended extension files.
- [ ] `manifest.json` reports 0.1.0 and Manifest V3.
- [ ] no `.map` files.
- [ ] no development/test/source files accidentally packaged.
- [ ] only `storage` extension permission.
- [ ] host permissions limited to `chatgpt.com` and `chat.openai.com`.
- [ ] explicit extension CSP present.
- [ ] no remotely hosted executable code.
- [ ] checksum matches CI-generated SHA-256 file.

## 4. Documentation

- [x] Chrome/Edge install/update instructions: `docs/release/install-v0.1.md`.
- [x] Privacy statement: `docs/release/privacy-v0.1.md`.
- [x] Known limitations: `docs/release/known-limitations-v0.1.md`.
- [x] Migration/data compatibility: `docs/release/migration-v0.1.md`.
- [x] Security/privacy review: `docs/security/security-privacy-review-v0.1.md`.
- [x] Changelog/release notes: `CHANGELOG.md`.
- [x] PRD acceptance evidence matrix: `docs/release/acceptance-evidence-v0.1.md`.
- [x] Live ChatGPT QA protocol: `docs/qa/live-chatgpt-validation.md`.
- [ ] final release notes updated with exact validated artifact checksum and QA environment.

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
- [ ] Explicit **Import history** completes on a real long thread (or reports the safety cap clearly), preserves ordering, creates no duplicates, and restores the user's position.
- [ ] Re-running **Import history** is idempotent for already captured turns.
- [ ] Library/search/Markdown/JSON smoke test passes.
- [ ] Current semantic selectors/IDs documented without private content.
- [ ] Adapter health remains healthy/degraded as expected; no silent selector failure.

## 6. Historical long-thread import — IMPLEMENTED / LIVE VALIDATION REQUIRED

The original TASK-012 historical-import code gap is closed in `main` (`ea8d09a`).

Automated evidence:

- [x] explicit manual **Import history** action exists; no silent auto-scroll.
- [x] import is allowed only while actively recording.
- [x] import refuses to start while assistant output is still streaming.
- [x] scroll-container discovery has a document-scroll fallback.
- [x] traversal walks to a stable top then a stable bottom.
- [x] every traversal step is smaller than the viewport, guaranteeing overlapping windows.
- [x] each window persists through the canonical retry/dedupe `turn-snapshot` path.
- [x] navigation to another conversation aborts the import.
- [x] normal MutationObserver capture is restored in `finally`.
- [x] original distance-from-bottom is restored even after failure.
- [x] 500-window hard safety cap reports truncation.
- [x] synthetic 1,002-turn traversal passes.
- [x] lazy older-history expansion at the top passes.
- [x] failure-restoration and truncation tests pass.

Remaining gate:

- [ ] authenticated live ChatGPT validation confirms the provider currently exposes/loads historical turns in a way this traversal can harvest safely.

The first CI run caught a real skipped-window bug caused by a 240px minimum step. The implementation was fixed—not the coverage—so all scroll moves are now strictly smaller than the current viewport and the unchanged long-history tests pass.

## 7. Privacy/security manual smoke checks

- [ ] archived provider text displays as inert text in Library.
- [ ] unsafe links/content do not become executable UI.
- [ ] pause test confirms omitted text absent from Markdown and JSON.
- [ ] diagnostics download contains no conversation text/URL/title/checkpoint notes.
- [ ] performance report contains aggregate metadata only.
- [ ] Library Delete warning clearly states browser-only deletion scope.
- [ ] filesystem mirror permission loss shows warning without affecting canonical capture.

## 8. Upgrade/uninstall smoke checks

- [ ] upgrade a prior development install to 0.1.0 without uninstalling and confirm existing IndexedDB archive remains readable.
- [ ] confirm database v2 project migration behavior for a v1 fixture (automated test already exists; optional manual browser smoke recommended).
- [ ] export JSON, import into a clean profile/install, and verify round-trip locally.
- [ ] verify uninstall warning/documentation is understood: extension-owned browser storage may be removed.

## 9. Release approval

Only after the remaining live/manual sections are satisfied:

- [ ] issue #3 closed with authenticated live evidence.
- [ ] TASK-054 issue #37 updated with final evidence.
- [ ] run the complete gate on the exact final post-QA candidate commit.
- [ ] record final artifact/checksum/QA environment.
- [ ] close TASK-054 only after all release gates pass.
- [ ] create/tag final v0.1.0 release artifact from the approved commit.
- [ ] publish checksum + install/privacy/limitations links with release notes.

Until then, v0.1.0 is a **release candidate under authenticated runtime validation**, not a production-ready release.
