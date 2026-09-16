# Live QA Report — v0.1

The in-page recorder exposes **QA report** to make authenticated ChatGPT validation reproducible without copying private conversation content into GitHub.

## What it does

Click **QA report** in the expanded recorder. The extension downloads a local JSON file named like:

`llm-chat-history-live-qa__2026-09-16T12-30-00-000Z.json`

The file is generated locally. v0.1 has no report upload/network path.

## Report schema

- `schema`: `llm-chat-history/live-qa-report`
- `schemaVersion`: `1` (pre-release schema; finalized with v0.1);
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
- canonical archive **counts only**: conversation found, message count, event count, visible-activity count, persisted recorder state.

`visibleActivityCount` is the number of saved provider-rendered work/reasoning-summary/status entries across the current conversation. It never contains their text.

## Explicitly excluded

The report does **not** serialize:

- prompt text;
- assistant answer text;
- visible activity text;
- Markdown/message bodies;
- conversation title;
- raw source URL or pathname;
- ChatGPT provider conversation ID;
- turn/message/activity IDs themselves;
- project/folder/tag names;
- checkpoint names/notes;
- filesystem mirror paths.

The implementation reconstructs the report from an allowlisted schema instead of serializing source objects. Tests deliberately inject secret fields and visible-activity text and assert they cannot appear in the JSON.

## How to use it during issue #3 validation

1. Install the exact pinned unpacked RC artifact.
2. Open a logged-in ChatGPT test conversation.
3. At the beginning of each validation scenario, click **QA report** and keep the file as the `before` snapshot when counts/state matter.
4. Perform the scenario.
5. Click **QA report** again for the `after` snapshot.
6. Verify expected state/count changes against `docs/qa/live-chatgpt-validation.md`.
7. For a response that visibly shows work/reasoning/status entries, verify `archive.visibleActivityCount` increases after persistence and the Library's **What ChatGPT showed while working** section contains the expected entries.
8. Attach the report files to issue #3 when useful. Do not attach Markdown/JSON conversation exports unless their contents are deliberately non-sensitive test data.

## Candidate pinning

The exact v0.1 candidate is repinned after every runtime code change. Do not reuse an older artifact after a live-QA-driven change. The authoritative candidate commit, CI run, artifact names and digests are recorded on issues #3 and #37 after the exact `main` merge passes CI.
