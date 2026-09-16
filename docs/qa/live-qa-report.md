# Live QA Report — v0.1

The in-page recorder exposes **QA report** to make authenticated ChatGPT validation reproducible without copying private conversation content into GitHub.

## What it does

Click **QA report** in the expanded recorder. The extension downloads a local JSON file named like:

`llm-chat-history-live-qa__2026-09-16T12-30-00-000Z.json`

The file is generated locally. v0.1 has no report upload/network path.

## Report schema

- `schema`: `llm-chat-history/live-qa-report`
- `schemaVersion`: `1`
- extension version and generation timestamp;
- provider: ChatGPT;
- route **shape only**: home/conversation/other, path-segment count, query/hash presence, stable-provider-ID-present boolean, provisional boolean;
- semantic DOM selector **counts only**;
- stop-generation-control presence;
- conversation-scroll-container evidence;
- browser History API availability;
- adapter state/code;
- recorder state;
- storage health;
- rendered-turn count;
- whether a successful local save has been confirmed;
- whether Import history is currently eligible;
- canonical archive **counts only**: conversation found, message count, event count, persisted recorder state.

## Explicitly excluded

The report does **not** serialize:

- prompt text;
- assistant answer text;
- Markdown/message bodies;
- conversation title;
- raw source URL or pathname;
- ChatGPT provider conversation ID;
- turn/message IDs themselves;
- project/folder/tag names;
- checkpoint names/notes;
- filesystem mirror paths.

The implementation reconstructs the report from an allowlisted schema instead of serializing source objects. Tests deliberately inject secret route/query/message fields and assert they cannot appear in the JSON.

## How to use it during issue #3 validation

1. Install the exact pinned unpacked RC artifact.
2. Open a logged-in ChatGPT test conversation.
3. At the beginning of each validation scenario, click **QA report** and keep the file as the `before` snapshot when counts/state matter.
4. Perform the scenario.
5. Click **QA report** again for the `after` snapshot.
6. Verify expected state/count changes against `docs/qa/live-chatgpt-validation.md`.
7. Attach the report files to issue #3 only if needed for evidence/debugging. Do not attach Markdown/JSON conversation exports unless their contents are deliberately non-sensitive test data.

## Current pinned candidate with this feature

CI run: `35095244062`

- packaged artifact: `llm-chat-history-v0.1-release-6683cca03fc5903b458b842f7a1888c19ffab184`
  - GitHub artifact digest: `sha256:355a128a3ffd93cf948dc6e2dc4c226711ddb8d5df71b75f5807c1836b80b0a3`
- unpacked artifact: `llm-chat-history-unpacked-6683cca03fc5903b458b842f7a1888c19ffab184`
  - GitHub artifact digest: `sha256:58943d194b4bf5b27d058f919ec8987d452800038d4112cce26caec740e2183c`

These artifacts came from the fully green PR #41 head and include the QA-report feature. A final release candidate must still be gated again after authenticated live QA and any resulting fixes.
