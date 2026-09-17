# UI system v2 — Astra baseline

Status: implementation baseline for the UI/UX refresh.

## Product direction

The hosted ChatGPT Studio exploration is the primary visual reference for the refresh: quiet local-first productivity UI, restrained surfaces, clear hierarchy, prominent search, compact metadata, and privacy messaging that stays visible without dominating the workspace.

The implementation must remain grounded in features that exist in the extension. Generated concepts such as cloud sync, vector search, token-cost estimates, unsupported providers, or fictional storage backends must not appear unless the product actually implements them.

## Typography

- **Poppins**: headings, page titles, conversation titles, and major section titles only.
- **Inter**: body copy, buttons, inputs, navigation, metadata, status text, and other UI.
- Fonts are self-hosted in the extension build through Fontsource. No Google Fonts or other runtime font requests.
- Typography is fluid with `clamp()` instead of breakpoint-only jumps.

## Fluid layout tokens

The Library design system defines fluid tokens for:

- display, heading, body, small, and metadata type sizes;
- page, section, card, and control spacing;
- sidebar width;
- transcript reading width.

The same token family should be reused for the transcript and recorder refresh instead of introducing separate size systems.

## Color and surface language

The v2 Library uses a warm neutral base with a restrained muted-green accent. The accent is reserved for selection, focus, privacy/local state, and primary actions. It should not become decorative chrome.

Both light and dark themes must preserve:

- readable contrast;
- quiet surface separation;
- visible keyboard focus;
- semantic danger/error treatment;
- a clear selected-conversation state.

## Library hierarchy

Priority order:

1. Search
2. Conversation list
3. Open/read a conversation
4. Current vs archived state
5. Project filtering
6. Rename/archive/export
7. Project/folder/tag management
8. Diagnostics and secondary tools

Organization controls use progressive disclosure so they do not permanently compete with the transcript.

## Conversation list

A conversation item should remain compact and scannable. The intended card model is:

- provider/status context;
- conversation title;
- short preview when available;
- message count and recency;
- minimal project/tag metadata.

Avoid tall dashboard cards and invented telemetry.

## Transcript

The transcript is a reading surface rather than a ChatGPT clone:

- constrained line length;
- subtle distinction between user and assistant turns;
- secondary metadata visually de-emphasized;
- partial capture shown as informational state;
- export/organization controls outside the message body.

## Responsive behavior

Use fluid sizing first, then structural breakpoints only when the information architecture must change.

Desktop uses the Library sidebar + transcript workspace. Narrow layouts stack the Library controls and transcript, cap the conversation-list height, maintain touch-friendly controls, and avoid requiring hover.

## Safety boundary for this refresh

UI work must not change the canonical archive, provider capture, background persistence, recorder state machine, or Scenario 2 identity logic unless a separate engineering change explicitly requires it. Functional IDs used by the current Library JavaScript are preserved during the visual migration so UI changes can be reviewed independently from capture/storage behavior.
