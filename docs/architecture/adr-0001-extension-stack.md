# ADR-0001 — v0.1 Extension Stack

Status: **Accepted**  
Date: 2026-09-16

## Context

LLM Chat History needs a small, reliable Chromium extension before it needs a large application framework. The in-page recorder must coexist with third-party LLM pages, survive SPA navigation, and keep provider integration code separate from storage and UI. The library/settings surface will grow later, but the first release is dominated by capture correctness rather than complex application state.

The UI must follow Google Material Design / Material 3. The design system choice does not require coupling the product to Google's Material Web component package. As of September 2026, Material Web is in maintenance mode; its existing components remain usable, but it is not an ideal foundation for a new product that expects substantial UI evolution.

Manifest V3 service workers can suspend, so correctness cannot rely on long-lived background memory. Content scripts own provider DOM interaction; durable state will be stored explicitly.

## Decision

### Language

Use **TypeScript** throughout extension code.

Reasons:
- provider observations and archive records benefit from explicit contracts;
- safer evolution across multiple providers;
- better migration/refactor support for a DOM integration that will change over time.

### Build

Use **esbuild** through a small checked-in build script.

Reasons:
- content scripts need self-contained classic bundles rather than a dependency on page-side modules;
- very small configuration surface;
- easy multiple entry points for content/background/library code;
- avoids extension-specific build-plugin coupling during the reliability phase.

Vite was evaluated and remains a reasonable option for a future larger extension UI, but it adds little value to the initial two-bundle shell and can create shared-chunk/content-script packaging considerations that we do not need yet.

### UI framework

Use **vanilla TypeScript + DOM APIs** for v0.1. Do not introduce React/Preact/Vue/Lit in the recorder shell.

Reasons:
- recorder UI is intentionally tiny;
- minimizes runtime/bundle/compatibility surface inside provider pages;
- makes Shadow DOM isolation straightforward;
- avoids choosing a framework before the archive library's complexity is known.

Re-evaluate for the full archive library only if state/interaction complexity materially justifies it.

### Material Design

Use **Material 3 design tokens, interaction patterns and accessibility guidance** implemented with local CSS/custom properties and small local components.

Do not depend on remotely hosted fonts, styles, JavaScript or icons. Manifest V3 packages all executable code locally. Use system/Roboto-compatible typography fallbacks initially; package any future approved font/icon assets with the extension.

### In-page isolation

Use a **Shadow DOM host** for the recorder pill/panel.

Reasons:
- limits style leakage in both directions;
- avoids depending on ChatGPT utility classes;
- provides a stable extension-owned rendering boundary.

The host uses a deliberately high z-index but a small footprint and configurable placement later.

### Provider boundary

Provider adapters emit normalized observations. They do not own persistence.

Initial ChatGPT adapter is:
- DOM-first for continuous recording;
- semantic-attribute-first for selectors;
- URL-watch + MutationObserver based for SPA/turn changes;
- tolerant of content virtualization;
- explicit about adapter health/failure.

Historical backfill is an optional adapter capability and remains separate from continuous capture.

### Background/service worker

The MV3 service worker is an event coordinator, not a long-lived process. Durable recorder state must be restored from storage after suspension/restart.

### Canonical storage

TASK-011 will implement extension-owned **IndexedDB** as canonical storage. `chrome.storage` is reserved for lightweight settings/state pointers rather than full transcripts.

## Initial dependency policy

Keep runtime dependencies at **zero** where practical during the shell phase. Build/test/type packages are development-only.

Initial dev toolchain:
- TypeScript 7.0.2;
- esbuild 0.28.2;
- Vitest 5.0.1;
- `@types/chrome` 0.3.0.

Versions are pinned in `package.json` for reproducible development and should be upgraded deliberately.

## Consequences

### Positive

- minimal extension attack/bundle surface;
- fast builds;
- provider page integration stays understandable;
- Material 3 look without UI-vendor lock-in;
- future provider adapters share one typed contract;
- no framework decision blocks TASK-010/011/012.

### Trade-offs

- library UI may require more hand-written interaction code initially;
- local Material components must be implemented/accessibility-tested rather than inherited from a component suite;
- build script owns copying/static packaging explicitly.

## Revisit triggers

Re-evaluate this ADR when any of the following become true:
- archive library UI requires complex routing/state/forms;
- more than two UI surfaces duplicate significant component logic;
- Firefox/Safari packaging needs a higher-level extension build abstraction;
- Material component maintenance burden becomes larger than adopting a maintained component framework.
