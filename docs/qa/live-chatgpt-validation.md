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

## Pass/fail evidence

For every scenario record:

- PASS / FAIL / BLOCKED;
- source ChatGPT URL shape (do not copy message text into the QA report);
- recorder state shown in the pill;
- archive message count before/after;
- whether the Library opens;
- whether console shows an adapter/persistence error;
- notes needed to reproduce a failure.

Do not paste private conversation content into GitHub issues. Structural selector/ID evidence is sufficient.

## Scenario 1 — Existing conversation baseline

1. Open an existing ChatGPT conversation.
2. Confirm the recorder pill appears and does not cover the composer/message text materially.
3. Confirm the route is recognized and the pill is not in ERROR.
4. Open **Library** from the recorder panel.
5. Confirm the conversation appears locally and rendered turns are in correct user/assistant order.

Pass criteria:

- no routine duplicates;
- title/source route captured;
- archive persists after Library reload.

## Scenario 2 — New chat identity promotion

1. Start a new ChatGPT chat from the provider UI.
2. Before sending anything, confirm the provisional route is handled without an error.
3. Send one ordinary test prompt and allow one assistant response to finish.
4. Confirm ChatGPT assigns/navigates to its stable conversation route when applicable.
5. Open Library.

Pass criteria:

- exactly one local conversation record exists for the test chat;
- the same archive transitions from provisional to stable provider conversation ID;
- user and assistant turns appear once each.

## Scenario 3 — Streaming response

1. In a disposable test chat, send a prompt that takes long enough to visibly stream.
2. While streaming, observe the recorder status.
3. Confirm **Import history** is unavailable/refuses to start while generation is active.
4. Wait for generation to finish.
5. Open Library and export JSON.

Pass criteria:

- one assistant archive message is updated rather than duplicated;
- final text replaces/updates the partial record;
- the final record is not marked partial;
- no stale partial duplicate remains;
- historical import does not run against an actively changing response.

## Scenario 4 — SPA navigation between chats

1. Open chat A and note its archive count.
2. Use the ChatGPT sidebar to navigate to chat B without a full page reload.
3. Add a disposable test turn to chat B if appropriate.
4. Navigate back to chat A.

Pass criteria:

- observations after navigation attach to the correct conversation;
- chat A and chat B remain separate archive records;
- no cross-chat contamination.

## Scenario 5 — Pause / private interval / resume

Use a disposable conversation with non-sensitive placeholder text.

1. Record a baseline turn.
2. Click **Pause**.
3. Confirm **Import history** is disabled while paused.
4. Send a clearly identifiable placeholder prompt and receive an answer while paused.
5. Click **Resume**.
6. Send another placeholder turn.
7. Open Library and export Markdown/JSON.

Pass criteria:

- pre-pause and post-resume turns are stored;
- paused prompt/answer text is absent from stored message content;
- a later DOM rescan/navigation does not backfill the omitted turns;
- Markdown contains recording pause/resume boundaries but no suppressed-turn identifier/content.

## Scenario 6 — Stop / start

1. Click **Stop** and confirm deliberately.
2. Confirm **Import history** is disabled while stopped.
3. Add a disposable placeholder turn.
4. Navigate away and back or refresh.
5. Confirm state remains stopped.
6. Explicitly click **Start** and add a new turn.

Pass criteria:

- stopped interval is not archived;
- state survives navigation/refresh;
- capture resumes only after explicit Start.

## Scenario 7 — Minimize and Hide semantics

1. While recording, minimize the recorder panel.
2. Add a disposable turn.
3. Reopen the pill and verify the turn is captured.
4. Hide the recorder with ×.
5. Add another disposable turn.
6. Restore the recorder using the extension toolbar icon and inspect the Library.

Pass criteria:

- minimize/hide changes UI only;
- recording never stops or pauses;
- turns are captured normally while the controls are minimized or hidden.

## Scenario 8 — Refresh and MV3 worker recovery

1. Capture at least two finalized turns.
2. Refresh the ChatGPT page.
3. Leave the page idle long enough for normal MV3 service-worker suspension if practical.
4. Add another turn.
5. Open Library.

Pass criteria:

- previously stored turns remain;
- new turn persists after worker wake-up;
- no duplicate conversation/archive is created.

## Scenario 9 — Long-thread virtualization + historical import

Use a long existing conversation with older turns outside the currently rendered window if available. Use non-sensitive content or inspect counts/IDs only.

1. Open the conversation near its normal/bottom position.
2. Record the current scroll position/distance-from-bottom and local archive message count.
3. Expand the recorder and click **Import history**.
4. Accept the confirmation.
5. Observe that the page temporarily traverses the conversation while the recorder remains attached to the same provider conversation.
6. Wait for a visible completion or safety-limit message.
7. Confirm the view returns to approximately the original distance-from-bottom.
8. Open Library and compare message count/order.
9. Run **Import history** a second time.
10. Reopen Library and compare message count/order again.

Pass criteria:

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

1. Open the Library from the recorder.
2. Search for a phrase known to exist in captured test content.
3. Search for a phrase that does not exist.
4. Download Markdown.
5. Download JSON.
6. Click the browser-extension toolbar icon and confirm it also opens/restores the expected local UI.

Pass criteria:

- local search filters correctly;
- transcript order is correct;
- archived content renders as text, not executable HTML;
- `.md` is readable and preserves common captured formatting where the provider DOM is semantic;
- JSON contains `schema: llm-chat-history/archive-export` and `schemaVersion: 1`;
- filenames are deterministic and filesystem-safe.

## Structural DOM evidence to capture

For TASK-012, capture counts/presence only; never commit private message text or private conversation titles.

Check current support for:

- `section[data-turn="user"]`;
- `section[data-turn="assistant"]`;
- `article[data-turn]`;
- `[data-message-author-role="user"]`;
- `[data-message-author-role="assistant"]`;
- `data-turn-id`;
- `data-message-id`;
- `[data-testid^="conversation-turn-"]`;
- `[data-testid="collapsible-user-message-content"]`;
- assistant `.markdown` / `.prose` content wrappers;
- the scrollable ancestor used by **Import history**;
- `button[data-testid="stop-button"]` or stop-generation aria-label while generation is genuinely active.

If stable IDs disappear, record which fallback was used and whether adapter health changes to `degraded`.

## Release gate

The ChatGPT recorder must not be called production-ready until scenarios 1–10 pass on a real logged-in browser session using the exact candidate build. Synthetic/unit/stress coverage—including the 1,002-turn historical traversal—is supporting evidence, not a substitute for authenticated provider-runtime validation.
