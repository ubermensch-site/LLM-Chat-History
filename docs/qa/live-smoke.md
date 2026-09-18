# Authenticated ChatGPT Release Smoke Test

This is the human/provider compatibility check that remains after automated Scenarios 1–10 pass in CI.

It is intentionally short. Do not replay all ten manual scenarios unless the smoke test exposes a problem.

## Preconditions

- Use the exact unpacked artifact from the green exact-main CI run.
- Disable older LLM Chat History test builds.
- Use a normal logged-in ChatGPT profile and disposable content.
- Keep one short screen recording if release evidence is required.

## One-pass smoke

1. Open an existing normal ChatGPT conversation.
   - Recorder appears.
   - It is not in an error state.
   - Existing visible turns are represented plausibly.

2. Start one new disposable chat and send a response long enough to visibly stream.
   - Recorder remains healthy while streaming.
   - After generation finishes, the archive contains one final assistant response, not a stale partial/duplicate.

3. Navigate with the ChatGPT sidebar to another chat and back without manually refreshing.
   - Recorder rebinds to the correct chat.
   - The two chats remain separate.

4. In the disposable chat, click **Pause saving**, create one disposable prompt/answer, then **Resume saving** and create one more disposable prompt/answer.
   - The paused interval is absent from Library after a later revisit.
   - The post-resume turn is present.

5. Refresh the ChatGPT page and open **Library**.
   - Previously saved content remains.
   - Recorder/Library still work.
   - No duplicate conversation is created.

6. Export JSON for the disposable smoke-test chat.
   - Final assistant messages are not partial.
   - No paused/private text is present.
   - Provider-visible activity/model metadata is included only when ChatGPT actually exposed it.

## Pass rule

The smoke test passes when there is no provider-DOM/route/runtime contradiction and the observed archive matches the rules above.

A smoke failure blocks release even when deterministic automation is green. Fix the provider/runtime issue, add a regression fixture where practical, rerun CI, then repeat only the failed smoke behavior.

## Evidence burden

For routine releases, one short recording plus the disposable JSON export is sufficient. A separate ten-scenario manual evidence pack is not required.

The comprehensive `live-chatgpt-validation.md` checklist remains available for first-release audits, provider migrations and investigation of smoke-test failures.
