# Automated Release QA

The default functional release gate runs the built Manifest V3 extension in Chromium and exercises the ten release scenarios against deterministic local ChatGPT fixtures.

## Command

```bash
npm run release:automated
```

CI performs the same work in stages:

1. typecheck;
2. Vitest unit/integration/stress coverage;
3. build the extension;
4. verify MV3/security/release invariants;
5. launch Chromium with the exact built `dist/` extension;
6. run Scenarios 1–10 through `scripts/release-e2e.mjs`;
7. emit `release-qa-automated.json`;
8. package and verify the release ZIP.

The browser harness intercepts `https://chatgpt.com/*` with deterministic local fixture documents. No ChatGPT credentials or provider network calls are needed in CI. The real content script, background service worker, recorder UI, IndexedDB archive and Library are used.

## Scenario coverage

| Scenario | Automated evidence |
| --- | --- |
| 1 — Existing conversation baseline | Stable conversation identity, two canonical turns, correct order and Library persistence after reload. |
| 2 — New-chat identity promotion | Provisional archive promotes to one stable conversation with no duplicate. |
| 3 — Streaming/activity/model | Partial assistant becomes final in place; visible activity/model metadata persists; history import refuses while generation is active. |
| 4 — SPA navigation | A → B → A/B navigation stays isolated; changed turn-shell ID with the same providerMessageId does not duplicate the assistant. |
| 5 — Pause/private/resume | Paused transcript/activity never enters the archive and cannot backfill after resume/revisit; import is disabled while paused. |
| 6 — Stop/start | Stopped state survives refresh, stopped-interval content stays omitted, and capture resumes only after explicit Start. |
| 7 — Move/minimize/hide semantics | Collapse/hide do not stop capture; toolbar restore works; saved recorder position is restored after refresh. |
| 8 — Refresh/MV3 recovery | The background service-worker target is terminated, normal traffic wakes recovery, previous data remains, and new turns persist without a duplicate conversation. |
| 9 — Virtualization/history import | Overlapping virtualized windows converge to canonical order, scroll position is restored, and a second import is idempotent. |
| 10 — Library/search/export | Transcript renders inertly, transcript/activity search works, Ctrl/Cmd+K and Escape work, theme persists, and Markdown/JSON preserve supported metadata. |

## Machine-readable evidence

A successful run writes:

`release-qa-automated.json`

Schema:

`llm-chat-history/automated-release-qa`

CI uploads this file as:

`llm-chat-history-automated-qa-<commit SHA>`

The evidence contains scenario names/statuses, extension version, commit SHA when run in CI, fixture/browser metadata and the fact that a live provider smoke check is still required. It does not contain real user conversations.

## What automation does not prove

The deterministic fixture can prove our code and release artifact behavior, but it cannot guarantee that the live ChatGPT DOM, routes or transient provider UI have not changed after the fixtures were written.

Therefore production release still requires the short authenticated smoke test in `docs/qa/live-smoke.md`.

If that smoke test exposes a provider change or runtime contradiction, use `docs/qa/live-chatgpt-validation.md` as the comprehensive manual diagnostic checklist.
