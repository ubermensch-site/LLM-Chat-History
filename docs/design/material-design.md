# LLM Chat History — Material Design UI Brief

Status: Initial UI/UX direction v0.1  
Foundation: Google Material Design / Material 3

## 1. Design goal

The UI should feel familiar, quiet and trustworthy rather than visually experimental. The recorder must stay out of the way of the host LLM interface while making recording/privacy state unmistakable.

Use Material 3 concepts for:

- color roles;
- typography hierarchy;
- elevation;
- shape;
- spacing;
- component states;
- accessibility;
- responsive layout.

The initial release should avoid creating a custom design system where standard Material patterns already work.

## 2. Product surfaces

### A. In-page recorder

A compact floating control injected into supported LLM pages.

Default collapsed form:

```text
●  REC  286
```

Expected behavior:

- very small footprint;
- movable or placeable where it does not obscure the chat/composer;
- clear recording state;
- expands only when requested;
- minimize/hide never implies stop;
- state remains understandable without color alone.

Expanded example:

```text
┌───────────────────────────────┐
│ LLM Chat History         —  × │
│ ● Recording                   │
│                               │
│ Shopify Rebuild               │
│ 286 messages                  │
│ Saved 4 sec ago               │
│                               │
│ [ Pause ]  [ Checkpoint ]     │
│                               │
│ Browser archive       ✓       │
│ Folder mirror         ✓       │
│                               │
│ [ Library ] [ Export ]        │
│ [ Stop recording ]            │
└───────────────────────────────┘
```

The exact visual form can evolve; the behavior should not.

### B. Library

Full extension page for:

- search;
- recent chats;
- projects/folders;
- provider filters;
- tags;
- transcript view;
- export/import;
- storage health.

### C. Settings

- provider enable/disable;
- default recording behavior;
- local folder connection;
- storage usage;
- privacy options;
- future cloud/sync configuration.

## 3. Color strategy

Keep v0.1 simple.

Use Material color roles rather than hard-coding component-specific colors:

- `primary`
- `on-primary`
- `primary-container`
- `on-primary-container`
- `surface`
- `surface-container`
- `surface-container-high`
- `on-surface`
- `on-surface-variant`
- `outline`
- `error`
- `on-error`

Initial theme direction:

- neutral/light surfaces;
- restrained primary accent;
- dark mode supported from the same semantic roles;
- no large decorative gradients required for v0.1.

Recording status must combine icon/text with semantic color:

- Recording: active indicator + `Recording` text.
- Paused: pause icon + `Paused` text.
- Stopped: stop icon + `Stopped` text.
- Error/degraded: warning/error icon + explanatory text.

Do not rely on green/yellow/red alone.

## 4. Typography

Use a clean system/Material-compatible sans-serif stack.

Suggested hierarchy:

- page title: Material `headline-small` equivalent;
- section title: `title-medium`;
- chat/library item title: `title-small` or `body-large` depending on density;
- standard UI: `body-medium`;
- metadata: `body-small` / `label-medium`;
- buttons/chips: `label-large` / `label-medium`.

Keep transcript content closer to the provider's natural reading density rather than forcing oversized UI typography.

## 5. Spacing

Use a simple 4dp base grid with common steps:

- 4
- 8
- 12
- 16
- 24
- 32

Avoid dense ad-hoc spacing values.

Recorder pill should use compact spacing; library/settings can use standard comfortable Material spacing.

## 6. Shape

Use Material 3 rounded shapes consistently.

Suggested starting points:

- recorder pill: fully rounded/pill;
- cards/panels: 12–16dp radius;
- buttons: Material defaults;
- dialogs/sheets: Material 3 defaults.

Avoid excessive nested cards and excessive rounding.

## 7. Elevation

Recorder UI may need enough elevation/shadow to remain legible over arbitrary host pages.

Use restrained Material elevation:

- collapsed pill: low-to-medium;
- expanded recorder: medium;
- dialogs/sheets: standard Material layer elevation.

Do not use large ornamental shadows.

## 8. Core components

Prefer standard Material interaction patterns:

- Icon button;
- Filled/tonal/text button;
- Chips for tags/providers;
- Search field;
- Navigation rail/drawer as needed in library;
- Lists for chats;
- Dialogs for destructive confirmation;
- Snackbar for short status feedback;
- Tooltip for compact recorder icons;
- Menu for secondary actions;
- Tabs only when information architecture genuinely benefits.

## 9. Recorder component rules

### Collapsed

Must show:

- state;
- unobtrusive health/count information.

Interaction:

- click expands;
- drag only if we implement deliberate drag behavior;
- keyboard accessible;
- no accidental stop action.

### Expanded

Primary actions:

- Pause/Resume;
- Checkpoint.

Secondary actions:

- Export;
- Library;
- Settings/health.

Destructive/major state action:

- Stop recording should be visually separated from minimize/close and may require confirmation or a deliberate two-step action.

### Close vs minimize

UI language must be explicit:

- **Minimize/Hide:** UI disappears/collapses; recording continues.
- **Stop recording:** capture stops.

Never use a generic close icon if users could reasonably interpret it as stopping unless supporting text/tooltip makes behavior clear.

## 10. Library information architecture

Initial desktop layout recommendation:

```text
Top app bar
├── Search
└── Settings/storage health

Left navigation
├── All chats
├── Projects
├── Unsorted
├── Providers
└── Archive

Main content
└── Conversation list / transcript
```

For a narrow extension window, collapse navigation into a drawer.

## 11. Conversation list item

Show only useful information:

- title;
- provider icon/name;
- project/folder when helpful;
- last captured time;
- message count;
- tags/checkpoint hint if useful;
- health badge only when action is needed.

Avoid cluttering every row with every possible action. Put secondary actions in an overflow menu.

## 12. Search UX

Search should feel immediate and local.

Result should show:

- conversation title;
- provider;
- matching snippet;
- timestamp/turn context;
- project if applicable.

Highlight matching text accessibly without destroying readability.

## 13. Empty states

Use straightforward guidance, not marketing copy.

Examples:

- `No chats recorded yet. Open a supported AI conversation to begin.`
- `No results for “…”`
- `Folder mirror is not connected. Your browser archive is still active.`

## 14. Error and health states

Important recorder/storage failures must be visible.

Examples:

- Provider adapter needs attention.
- Browser archive write failed.
- Folder permission expired.
- Mirror write pending/failed.

Show:

- what failed;
- whether the canonical archive is safe;
- clear recovery action.

Avoid alarming language when the browser archive remains healthy.

## 15. Dark mode

Support system theme early if practical.

All colors should come from semantic roles so dark mode is not a separate one-off stylesheet.

Host-page recorder should remain readable over both light and dark LLM interfaces.

## 16. Motion

Keep motion subtle:

- panel expand/collapse;
- state transition feedback;
- snackbar transitions.

Respect `prefers-reduced-motion`.

Do not animate the recording indicator in a distracting way. A static dot + text is sufficient.

## 17. Accessibility requirements

- WCAG-conscious contrast;
- keyboard navigation;
- visible focus ring;
- appropriate ARIA labels;
- recording status announced in an understandable way;
- target sizes appropriate for pointer use;
- no color-only status;
- reduced-motion support;
- screen-reader friendly transcript structure.

## 18. Iconography

Use Material Symbols or another consistent Material-aligned icon source selected during implementation.

Avoid mixing unrelated icon sets.

Likely icons:

- record/status;
- pause;
- play/resume;
- stop;
- checkpoint/bookmark;
- archive/library;
- folder;
- cloud/future sync;
- download/export;
- search;
- warning;
- settings;
- minimize/expand.

## 19. v0.1 UI priority

Build in this order:

1. recorder state pill;
2. expanded recorder controls;
3. storage/adapter health feedback;
4. export UI;
5. basic library;
6. search;
7. projects/tags;
8. settings/folder mirror.

Avoid polishing secondary screens before recorder reliability and non-obstruction are proven.

## 20. Open design questions

- fixed corner vs draggable recorder by default;
- best placement avoidance for ChatGPT composer/sidebar;
- Shadow DOM styling isolation;
- Material Web vs framework component library vs lightweight custom components using Material tokens;
- whether the library is a full tab page, side panel, or both;
- exact primary color/brand identity once the working product name is finalized.
