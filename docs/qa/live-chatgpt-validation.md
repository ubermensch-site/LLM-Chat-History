# Live ChatGPT Validation — v0.1 Functional Release

Status: Required before declaring the ChatGPT recorder production-ready.

This checklist validates the exact unpacked extension produced by CI against a real logged-in ChatGPT session. It remains separate from fixture/unit/stress coverage because provider DOM, SPA navigation, streaming, virtualization, historical lazy-loading and provider-visible work UI are external runtime dependencies.

## Build under test

Current pinned functional candidate:

- commit: `b611c3936a8902246692d4cad2d128c6af971cdc`;
- CI run: `35117220444`;
- unpacked artifact: `llm-chat-history-unpacked-b611c3936a8902246692d4cad2d128c6af971cdc`;
- unpacked artifact digest: `sha256:953650fb329547a9c30b607d9f6d12ac8e8b4f124333cb1fc2ae1fbe75bbf4fb`;
- packaged artifact digest: `sha256:f854458c8e1812ef0f5b294df5a89a7b2834ffd4a7829c537b0c7e93019d57b8`.

Also record:

- Chrome/Edge version;
- OS;
- test date/time;
- tester.

Install using **Load unpacked** after extracting the exact CI artifact. Disable older LLM Chat History test builds so only one recorder is active.

If live QA causes a runtime code change, the changed behavior must be retested on the newly gated candidate before release approval.

## Privacy-safe QA evidence

The recorder exposes **QA report**. Use it as the standard structural/count/state evidence format.

The report contains:

- selector counts;
- route-shape booleans;
- adapter/recorder/storage state;
- canonical archive message/event counts;
- **count-only `visibleActivityCount`**;
- historical-import eligibility.

It intentionally excludes:

- prompt text;
- assistant answer text;
- visible-activity/reasoning/work text;
- conversation title;
- raw URL/path;
- provider conversation ID value;
- tags/projects/folders;
- checkpoint notes.

For scenarios where state/count changes matter:

1. click **QA report** before the scenario;
2. perform the scenario;
3. click **QA report** after the scenario;
4. compare recorder state and archive message/event/activity counts;
5. use disposable test content for manual transcript/export inspection.

A QA report does not prove manual visual/content criteria by itself. Record those criteria separately in the scenario notes.

## Pass/fail evidence

For every scenario record:

- PASS / FAIL / BLOCKED;
- QA report filename(s);
- source ChatGPT URL **shape only**, never raw URL;
- visible recorder state;
- canonical archive message/event/activity counts where relevant;
- whether Library opens;
- whether console/recorder reports an adapter/persistence error;
- concise notes for manual visual/content checks.

## Scenario 1 — Existing conversation baseline

1. Open an existing ChatGPT conversation.
2. Confirm the recorder pill appears and does not materially block the composer/message text.
3. Confirm the route is recognized and the pill is not in ERROR.
4. Download a **QA report**.
5. Open **Library** from the recorder.
6. Confirm the conversation appears locally and rendered turns are in correct order.
7. Reload the Library page and confirm the conversation remains.

Pass criteria:

- route kind is `conversation`;
- provider conversation identity is present as a boolean only;
- semantic user/assistant selector evidence is present;
- canonical archive reports `conversationFound: true`;
- archive message count agrees with the expected captured conversation state;
- no routine duplicates;
- transcript order is correct;
- archive persists after Library reload.

## Scenario 2 — New chat identity promotion

1. Start a new ChatGPT chat.
2. Before sending anything, confirm provisional state is handled without error and download a report.
3. Send one ordinary disposable prompt and allow the response to finish.
4. Confirm ChatGPT assigns/navigates to a stable conversation route when applicable.
5. Download a second report.
6. Open Library.

Pass criteria:

- before report may show provisional/no provider conversation ID;
- after report shows stable provider identity present without exposing the ID value;
- exactly one local conversation exists for the test chat;
- the same archive promotes from provisional to stable identity;
- user/assistant turns appear once each.

## Scenario 3 — Streaming + visible session activity + model label

Use a disposable prompt that takes long enough to visibly stream and, if possible, visibly shows one or more provider work elements such as Thinking/reasoning summary, searching/browsing, reading/fetching, tool/work steps, implementation/testing/status/progress text.

1. Send the prompt.
2. While generation is active, observe the recorder and download a QA report if practical.
3. Confirm stop-generation evidence is present while generation is genuinely active.
4. Confirm **Import history** is unavailable/refuses while generation is active.
5. Observe any provider-visible work/status/reasoning summary that appears during generation.
6. Wait for generation to finish.
7. Download a final QA report.
8. Open Library and inspect the assistant response.
9. Expand **What ChatGPT showed while working (N)** if present.
10. Inspect the model metadata line.
11. Export JSON and Markdown using disposable content.

Pass criteria:

- one assistant archive message is updated rather than duplicated;
- final text replaces/updates the partial record and is not left partial;
- no stale partial duplicate remains;
- historical import does not run during active generation;
- stop-generation evidence returns false after generation;
- provider-visible work/activity seen while recording is retained with the response even if transient provider UI later disappears;
- final QA report `visibleActivityCount` is non-zero when the test visibly produced supported activity;
- Library activity entries match provider-visible work actually observed; hidden/private reasoning is not invented;
- if ChatGPT visibly exposes a human-readable per-response model label, it is saved;
- if ChatGPT does not visibly expose a model label, the archive does not guess from hidden/internal metadata;
- Markdown/JSON carry supported model/activity metadata.

## Scenario 4 — SPA navigation between chats

1. Open chat A and download a report.
2. Navigate via ChatGPT sidebar to chat B without full reload.
3. Download another report in B.
4. Add a disposable turn in B if appropriate.
5. Navigate back to A and download a third report.

Pass criteria:

- observations attach to the correct conversation after each navigation;
- A and B remain separate archive records;
- message/activity counts do not cross-contaminate;
- SPA/history capability remains available;
- no cross-chat contamination.

## Scenario 5 — Pause / private interval / resume

Use disposable placeholder content.

1. Record a baseline turn and report.
2. Click **Pause saving** and download another report.
3. Confirm historical import is unavailable while paused.
4. While paused, send a prompt that produces a response; if possible make it show visible work/activity.
5. Download a report while still paused.
6. Resume saving.
7. Send another disposable turn and download a final report.
8. Trigger a later DOM rescan/navigation or revisit the conversation.
9. Open Library and export Markdown/JSON.

Pass criteria:

- recorder/archive state changes to paused then recording predictably;
- archive message count does not increase for the paused interval;
- **visibleActivityCount does not gain activity produced only while paused**;
- pre-pause/post-resume content is stored;
- paused prompt/answer/activity text is absent from stored data;
- later rescan/navigation does not backfill the omitted transcript or activity;
- export records pause/resume boundaries without suppressed private content.

## Scenario 6 — Stop / start

1. Click **Stop saving** and deliberately confirm/complete the intended stop interaction.
2. Download a report.
3. Confirm historical import is disabled while stopped.
4. Add a disposable placeholder turn.
5. Navigate away/back or refresh.
6. Download another report and confirm state remains stopped.
7. Explicitly start saving again, add a new turn and download a final report.

Pass criteria:

- persisted/visible state remains stopped until explicit Start;
- stopped interval transcript/activity is not archived;
- state survives navigation/refresh;
- capture resumes only after explicit Start.

## Scenario 7 — Minimize / Hide / Move semantics

1. While recording, download a baseline report.
2. Drag the recorder to another safe location.
3. Refresh ChatGPT and confirm the recorder returns to approximately the saved safe position.
4. Minimize the recorder.
5. Add a disposable turn and verify it is captured.
6. Hide the recorder with ×.
7. Add another disposable turn.
8. Restore the recorder using the extension toolbar icon.
9. Download a final report and inspect Library.

Pass criteria:

- drag/move/minimize/hide are UI-only operations;
- recording never stops or pauses;
- saved recorder position persists/clamps on screen after refresh;
- archive reflects turns/activity produced while controls were minimized/hidden.

## Scenario 8 — Refresh and MV3 worker recovery

1. Capture at least two finalized turns and download a report.
2. Refresh the ChatGPT page.
3. Leave the page idle long enough for normal service-worker suspension if practical.
4. Add another turn.
5. Download another report and open Library.

Pass criteria:

- previously stored turns/activity remain;
- canonical conversation remains found after refresh;
- new turn persists after worker wake-up;
- no duplicate conversation/archive is created.

## Scenario 9 — Long-thread virtualization + historical import

Use a long existing conversation with older turns outside the currently rendered window if available. Prefer non-sensitive content or count-only evidence.

1. Open near the normal/bottom position.
2. Download a report and note message/activity/rendered-turn counts and scroll-container evidence.
3. Click **Bring in older messages / Import history**.
4. Accept the confirmation.
5. Observe temporary traversal while the recorder remains attached to the same conversation.
6. Wait for completion or safety-limit message.
7. Confirm the view returns to approximately its original distance from bottom.
8. Download another report.
9. Inspect Library order.
10. Run historical import a second time.
11. Download a third report.

Pass criteria:

- scroll-container evidence is present;
- previously archived turns/activity are never deleted because provider DOM unmounts them;
- import traverses toward stable top then stable bottom or reports the 500-window safety cap;
- older rendered turns are added to canonical archive;
- overlapping windows do not create duplicates;
- second import is idempotent for already captured turns;
- no observations attach to another conversation;
- canonical ordering remains correct;
- original scroll position/distance-from-bottom is restored even after failure;
- normal observation resumes after import;
- import remains unavailable while paused/stopped/streaming.

## Scenario 10 — Library / search / export / appearance / keyboard

Use disposable captured content so transcript/export inspection is safe.

1. Download a report for the current chat.
2. Open Library.
3. Confirm visible transcript order and activity section(s).
4. Search for a phrase in captured transcript content.
5. Search for a phrase that exists only in a captured visible-activity entry, if available.
6. Search for a phrase that does not exist.
7. Press **Ctrl+K** (Cmd+K on macOS) and confirm focus jumps to Library search.
8. Type a search and press Escape; confirm search clears.
9. Switch Auto → Light → Dark and reload once; confirm the selected preference behaves/persists as designed.
10. Download Markdown.
11. Download JSON.
12. Click the extension toolbar icon and confirm it opens/restores the local Library UI.

Pass criteria:

- QA archive message count agrees with visible transcript count for the conversation;
- visible-activity sections are inspectable without modifying answer text;
- local search matches transcript and visible-activity text correctly;
- transcript order is correct;
- archived content renders inertly, not as executable HTML;
- Ctrl/Cmd+K and Escape work as documented;
- appearance choices function and persist appropriately;
- Markdown is readable, preserves common semantic formatting, includes supported visible model/activity context with accurate labels;
- JSON contains `schema: llm-chat-history/archive-export` and `schemaVersion: 1`, and round-trips supported model/activity metadata;
- filenames are deterministic/filesystem-safe.

The current v0.1 Library visual design may still be dense; **major visual/information-architecture polish is tracked separately in issue #47 and is not by itself a functional release failure** unless it prevents these acceptance actions from being completed.

## Structural DOM evidence

The privacy-safe report records current counts/presence for supported turn selector families, stable ID families, scroll-container discovery, generation control, SPA/history capability and archive state. It never needs raw private IDs/text in GitHub.

If stable IDs disappear, record whether adapter health changes to degraded and which fallback class is used, without pasting provider IDs.

## Release gate

The ChatGPT recorder must not be called production-ready until scenarios 1–10 pass on a real logged-in browser session using the exact approved functional candidate. Unit/stress evidence supports this gate but cannot replace it.
