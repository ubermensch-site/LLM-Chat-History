# Scenario 2 authenticated partial-to-final duplicate evidence

Exact-main candidate `4c6f7d31c4892b9cb88a694d2ac2774cdc584f3d` was retested on 2026-09-17.

The privacy-safe before report was healthy on the ChatGPT home/new-chat route with 0 rendered turns and a 0-message provisional archive. The after report was healthy on a stable conversation route with 2 rendered turns and a 2-message stable archive.

The authoritative Library recording still showed two current local records for the same test:

- stable titled record `Identity test reply`, 2 messages, with the final assistant reply `scenario 2 identity test passed`;
- provisional `Untitled conversation`, 2 messages, whose assistant entry was still a partial capture showing `Thinking`.

This establishes that the remaining race is not an exact-content duplicate. The provisional document can persist an exact user turn plus a partial assistant placeholder, then the stable document can arrive with rotated provider IDs and the final assistant content.

The regression for the next fix therefore requires narrow partial-to-final reconciliation only when all of these hold: untouched provisional recording, safe event history, exact ordered role/count alignment, stable snapshot fully finalized, exactly one partial candidate message, that partial is the final assistant turn, every non-partial turn (including the user prompt) exactly matches, candidate is fresh within a short promotion window, and exactly one candidate matches. Existing strong provider-ID and exact full-content paths remain primary.
