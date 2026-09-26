# Provider Compatibility Architecture

Provider DOM is an external, versionless contract.

Executable adapters live under `src/providers/` in this repository. Structural evidence, sanitized fixtures and compatibility status live in `aichathistory/adapter-lab`.

The preferred model is:

Provider → ordered discovery strategies → normalized turns → recorder/archive.

Avoid a single union of increasingly broad selectors when that can create duplicate parent/child matches. Keep old renderer strategies and fixtures so current-provider fixes do not break historical/A-B cohorts.

When a known conversation route is present but recognizable turns fall to zero, treat that as a likely compatibility regression and protect already captured history rather than interpreting the DOM as an empty conversation.
