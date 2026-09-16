# Live ChatGPT Validation — v0.1 Recorder

Status: Required before declaring the ChatGPT recorder production-ready.

This checklist validates the unpacked extension produced by CI against a real logged-in ChatGPT session. It is intentionally separate from fixture/unit coverage because provider DOM, SPA navigation, streaming, virtualization and historical lazy-loading are external runtime dependencies.

## Build under test

Record before testing:

- commit SHA;
- CI run URL/number;
- artifact name (`llm-chat-history-unpacked-<sha>`);
- Chrome/Edge version;
- OS;
- test date/time;
- tester.

Install the CI artifact from `chrome://extensions` / `edge://extensions` using **Load unpacked** after extracting the artifact ZIP.

Current pinned candidate containing the built-in QA report feature:

- CI run: `35095244062`;
- unpacked artifact: `llm-chat-history-unpacked-6683cca03fc5903b458b842f7a1888c19ffab184`;
- unpacked artifact digest: `sha256:58943d194b4bf5b27d058f919ec8987d452800038d4112cce26caec740e2183c`.

The final release candidate must be re-gated if live QA causes any code change.

## Privacy-safe QA evidence

The recorder now exposes **QA report**. Use it as the standard structural/count/state evidence format for this checklist. See `docs/qa/live-qa-report.md`.

The report contains selector counts, route-shape booleans, adapter/recorder/storage state and count-only canonical archive status. It intentionally excludes message text, conversation title, raw URL/path, provider conversation ID, tag/project/folder names and checkpoint notes.

For scenarios where state/count changes matter:

1. click **QA report** before the scenario;
2. perform the scenario;
3. click **QA report** after the scenario;
4. compare recorder state and archive message/event counts;
5. attach the content-safe reports to issue #3 when useful.

Do not paste private conversation content into GitHub issues. Structural/count evidence is sufficient.

## Pass/fail evidence

For every scenario record:

- PASS / FAIL / BLOCKED;
- QA report filename(s) used as before/after evidence when applicable;
- source ChatGPT URL **shape only**, never the raw conversation URL;
- recorder state shown in the pill/report;
- canonical archive message count before/after;
- whether the Library opens;
- whether console shows an adapter/persistence error;
- notes needed to reproduce a failure.

## Scenario 1 — Existing conversation baseline

1. Open an existing ChatGPT conversation.
2. Confirm the recorder pill appears and does not cover the composer/message text materially.
3. Confirm the route is recognized and the pill is not in ERROR.
4. Download a **QA report**.
5. Open **Library** from the recorder panel.
6. Confirm the conversation appears locally and rendered turns are in correct user/assistant order.

Pass criteria:

- QA report shows route kind `conversation` and provider conversation ID present as a boolean only;
- semantic user/assistant selector counts are non-zero for a rendered conversation;
- canonical archive reports `conversationFound: true`;
- no routine duplicates;
- title/source route captured internally;
- archive persists after Library reload.

## Scenario 2 — New chat identity promotion

1. Start a new ChatGPT chat from the provider UI.
2. Before sending anything, confirm the provisional route is handled without an error and download a QA report.
3. Send one ordinary test prompt and allow one assistant response to finish.
4. Confirm ChatGPT assigns/navigates to its stable conversation route when applicable.
5. Download a second QA report.
6. Open Library.

Pass criteria:

- the before report may show `provisional: true` / no provider conversation ID;
- the after report shows stable provider-conversation identity present without exposing the ID value;
- exactly one local conversation record exists for the test chat;
- the same archive transitions from provisional to stable provider conversation ID;
- user and assistant turns appear once each.

## Scenario 3 — Streaming response

1. In a disposable test chat, send a prompt that takes long enough to visibly stream.
2. While streaming, observe the recorder status and download a QA report if practical.
3. Confirm the report/DOM evidence shows a stop-generation control while generation is genuinely active.
4. Confirm **Import history** is unavailable/refuses to start while generation is active.
5. Wait for generation to finish.
6. Download another QA report.
7. Open Library and export JSON.

Pass criteria:

- one assistant archive message is updated rather than duplicated;
- final text replaces/updates the partial record;
- the final record is not marked partial;
- no stale partial duplicate remains;
- historical import does not run against an actively changing response;
- stop-generation presence changes back to false after generation finishes.

## Scenario 4 — SPA navigation between chats

1. Open chat A and download a QA report.
2. Use the ChatGPT sidebar to navigate to chat B without a full page reload.
3. Download another QA report in chat B.
4. Add a disposable test turn to chat B if appropriate.
5. Navigate back to chat A and download a third QA report.

Pass criteria:

- observations after navigation attach to the correct conversation;
- chat A and chat B remain separate archive records;
- archive message counts do not cross-contaminate;
- SPA/history capability remains available;
- no cross-chat contamination.

## Scenario 5 — Pause / private interval / resume

Use a disposable conversation with non-sensitive placeholder text.

1. Record a baseline turn and download a QA report.
2. Click **Pause** and download another QA report.
3. Confirm **Import history** is disabled while paused.
4. Send a clearly identifiable placeholder prompt and receive an answer while paused.
5. Download a QA report while still paused.
6. Click **Resume**.
7. Send another placeholder turn and download a final QA report.
8. Open Library and export Markdown/JSON.

Pass criteria:

- report recorder/archive state changes to paused and back to recording predictably;
- canonical archive message count does not increase for the paused placeholder interval;
- pre-pause and post-resume turns are stored;
- paused prompt/answer text is absent from stored message content;
- a later DOM rescan/navigation does not backfill the omitted turns;
- Markdown contains recording pause/resume boundaries but no suppressed-turn identifier/content.

## Scenario 6 — Stop / start

1. Click **Stop** and confirm deliberately.
2. Download a QA report.
3. Confirm **Import history** is disabled while stopped.
4. Add a disposable placeholder turn.
5. Navigate away and back or refresh.
6. Download another QA report and confirm state remains stopped.
7. Explicitly click **Start**, add a new turn, and download a final QA report.

Pass criteria:

- persisted and visible recorder state remain stopped until Start;
- stopped interval is not archived;
- state survives navigation/refresh;
- capture resumes only after explicit Start.

## Scenario 7 — Minimize and Hide semantics

1. While recording, download a baseline QA report.
2. Minimize the recorder panel.
3. Add a disposable turn.
4. Reopen the pill and verify the turn is captured.
5. Hide the recorder with ×.
6. Add another disposable turn.
7. Restore the recorder using the extension toolbar icon.
8. Download a final QA report and inspect the Library.

Pass criteria:

- minimize/hide changes UI only;
- recording never stops or pauses;
- final archive message count reflects turns added while minimized/hidden;
- turns are captured normally while the controls are minimized or hidden.

## Scenario 8 — Refresh and MV3 worker recovery

1. Capture at least two finalized turns and download a QA report.
2. Refresh the ChatGPT page.
3. Leave the page idle long enough for normal MV3 service-worker suspension if practical.
4. Add another turn.
5. Download another QA report and open Library.

Pass criteria:

- previously stored turns remain;
- canonical archive conversation remains found after refresh;
- new turn persists after worker wake-up;
- no duplicate conversation/archive is created.

## Scenario 9 — Long-thread virtualization + historical import

Use a long existing conversation with older turns outside the currently rendered window if available. Use non-sensitive content or inspect counts only.

1. Open the conversation near its normal/bottom position.
2. Download a QA report and note archive message count, rendered-turn count and scroll-container evidence.
3. Expand the recorder and click **Import history**.
4. Accept the confirmation.
5. Observe that the page temporarily traverses the conversation while the recorder remains attached to the same provider conversation.
6. Wait for a visible completion or safety-limit message.
7. Confirm the view returns to approximately the original distance-from-bottom.
8. Download another QA report and compare archive message count.
9. Open Library and inspect message order.
10. Run **Import history** a second time.
11. Download a third QA report and compare archive count/order again.

Pass criteria:

- adapter scroll-container evidence is present;
- previously archived turns are never deleted because ChatGPT unmounts them;
- the historical import traverses toward a stable top and then a stable bottom, or explicitly reports the 500-window safety cap;
- older turns that become rendered during traversal are added to the canonical archive;
- revisiting overlapping windows does not create duplicates;
- the second import is idempotent for already captured turns;
- no observations attach to a different conversation;
- correct turn ordering is retained after import;
- the user's original scroll position/distance-from-bottom is restored after completion;
- if import encounters a failure, position is still restored and the recorder resumes normal observation;
- import remains unavailable while paused, stopped or assistant output is streaming.

## Scenario 10 — Library/search/export

1. Download a QA report for the current chat.
2. Open the Library from the recorder.
3. Search for a phrase known to exist in captured test content.
4. Search for a phrase that does not exist.
5. Download Markdown.
6. Download JSON.
7. Click the browser-extension toolbar icon and confirm it also opens/restores the expected local UI.

Pass criteria:

- QA report archive message count agrees with the visible Library transcript count for the current conversation;
- local search filters correctly;
- transcript order is correct;
- archived content renders as text, not executable HTML;
- `.md` is readable and preserves common captured formatting where the provider DOM is semantic;
- JSON contains `schema: llm-chat-history/archive-export` and `schemaVersion: 1`;
- filenames are deterministic and filesystem-safe.

## Structural DOM evidence to capture

The QA report captures counts/presence only; never commit private message text or private conversation titles.

It records current support for:

- `section[data-turn="user"]`;
- `section[data-turn="assistant"]`;
- `article[data-turn]`;
- `[data-message-author-role="user"]`;
- `[data-message-author-role="assistant"]`;
- elements carrying `data-turn-id`;
- elements carrying `data-message-id`;
- `[data-testid^="conversation-turn-"]`;
- `[data-testid="collapsible-user-message-content"]`;
- `.markdown` / `.prose` content wrappers;
- the scrollable ancestor used by **Import history**;
- the mobile app-shell scroll-container test ID;
- stop-generation controls while generation is genuinely active;
- count of conversation links and browser History API availability as SPA-routing evidence.

If stable IDs disappear, record whether adapter health changes to `degraded` and which fallback class is being used. Do not paste actual provider IDs.

## Release gate

The ChatGPT recorder must not be called production-ready until scenarios 1–10 pass on a real logged-in browser session using the exact candidate build. The QA report makes the evidence reproducible and content-safe, but it does **not** convert synthetic/unit evidence into a live PASS.
