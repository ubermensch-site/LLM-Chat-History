# Recorder State & Privacy Boundaries — v0.1

Status: TASK-013/014 foundation

## Scope

Recording policy is **per conversation**. Opening two ChatGPT threads does not imply that pausing one should pause the other.

Supported states:
- `recording`
- `paused`
- `stopped`
- `error`

User commands:
- `pause`: recording → paused
- `resume`: paused → recording
- `stop`: recording/paused/error → stopped
- `start`: stopped/error → recording

Invalid transitions fail explicitly rather than guessing user intent.

## Persistence

Recording state is stored on the canonical `ArchiveConversation` record:
- `recordingState`
- `recordingStateUpdatedAt`

Older v1 records without those properties are normalized to `recording` when next resolved. IndexedDB does not need a version bump because this change adds record properties without changing object-store/index structure.

State transitions are stored as archive events:
- `recording-started`
- `recording-paused`
- `recording-resumed`
- `recording-stopped`

Minimizing the recorder UI never emits a recorder command and therefore cannot change capture state.

## Pause/stop privacy model

When a turn is observed while the conversation is paused/stopped/error:

1. the provider turn may exist in memory because the provider page rendered it;
2. LLM Chat History does **not** write its text/Markdown into `messages`;
3. if the turn is new or changed compared with the last already-archived version, a deterministic `turn-suppressed` event is written containing only:
   - conversation ID;
   - provider turn ID;
   - timestamp;
   - suppression reason/state;
4. no omitted prompt/answer text is included in the suppression event.

The deterministic suppression marker prevents a later DOM rescan after Resume/Start from silently backfilling the omitted turn.

### Existing pre-pause turns

A provider mutation may trigger a full rendered-turn scan while paused. An unchanged turn that was already archived before Pause is **not** marked suppressed merely because it was seen again.

If an already archived turn changes while paused (for example a streaming assistant answer continues), its changed/private continuation is not saved and that turn becomes suppressed from further automatic updates. The previously captured pre-pause content remains as the last safe version.

This favors privacy over reconstructing a mixed public/private turn.

## Stop semantics

`stopped` survives later provider observations, route rendering and page refresh because it is stored on the conversation record. Capture resumes only after an explicit `start` command.

Turns changed/created while stopped receive the same no-content suppression treatment as paused turns, preventing later automatic backfill after Start.

## UI semantics

The compact pill remains available while recording is paused/stopped so state is visible.

Expanded controls expose:
- Pause while recording;
- Resume while paused;
- Start while stopped/error;
- Stop unless already stopped;
- Minimize.

`Minimize` only collapses the UI. It does not send any recorder-state command.

A fully hidden/toolbar-reopen flow remains part of TASK-021; this implementation does not overload close/minimize with stop behavior.

## Failure handling

Adapter health and recorder state are distinct:
- adapter health: `healthy | degraded | error` describes provider parsing;
- recorder state describes the user's capture policy.

The pill presents an error if provider/storage health fails, but it does not silently reinterpret that as a user Pause or Stop.

TASK-014 follow-up hardening still includes broader retry/coalescing and browser integration tests. Current writes are already sequentially acknowledged by the content script and idempotent by provider turn identity/content hash.
