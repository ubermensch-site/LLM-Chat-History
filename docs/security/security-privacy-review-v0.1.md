# LLM Chat History — v0.1 Security & Privacy Review

Date: 2026-09-16  
Scope: Chrome/Edge MV3 v0.1 release-candidate path  
Roadmap task: TASK-053

## Executive summary

The v0.1 architecture remains local-first and has no expected network transmission path for archived conversation data. The browser IndexedDB archive is canonical; the optional filesystem mirror is user-selected and local. Provider content is rendered in the extension Library as inert text, not executable HTML.

This review found no release-blocking remote-code, network-exfiltration, broad-permission, or DOM-XSS path in the current implementation.

Two residual privacy/robustness limitations must remain explicit for v0.1:

1. **Deleting a conversation from the browser Library does not delete Markdown files already written to the optional filesystem mirror.** The browser archive and the external mirror are separate copies. Users must remove retained mirror files themselves if they want those copies erased.
2. **JSON import is a user-initiated whole-file parse.** A pathologically large local backup can cause memory pressure. Import validation prevents schema/code execution issues, but v0.1 does not stream multi-gigabyte backups.

Live logged-in ChatGPT browser QA is also still required before release because automated browser access in the current environment cannot exercise the authenticated page.

## 1. Extension permissions and execution surface

### Result: PASS

Manifest v3 permissions are restricted to:

- `storage`;
- `https://chatgpt.com/*`;
- `https://chat.openai.com/*`.

The extension does **not** request `tabs`, `activeTab`, `scripting`, `webRequest`, `declarativeNetRequest`, clipboard, downloads, history, cookies, identity, native messaging, or broad `<all_urls>` access.

There are no `web_accessible_resources` and no `externally_connectable` declaration.

The ChatGPT content script runs through the normal MV3 content-script mechanism. Because no `world: MAIN` override is declared, it uses Chrome's isolated content-script world.

### Hardening added by this review

The manifest now declares an explicit extension-page CSP:

```text
script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none';
```

This keeps executable script restricted to packaged extension code, disables object embedding, blocks `<base>` URL rewriting, and prevents framing of extension pages.

## 2. Remote code and dynamic execution

### Result: PASS

Repository and bundle review found no intended use of:

- `eval()`;
- `new Function()`;
- remotely hosted JavaScript;
- inline JavaScript;
- inline DOM event handlers.

The distribution verifier now fails CI if shipped bundles contain eval-like execution or remotely hosted JavaScript.

## 3. Network/exfiltration surface

### Result: PASS

v0.1 has no intended application network client. Repository review found no `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, or `navigator.sendBeacon` use.

The distribution verifier now rejects those network-capable APIs in the shipped background/content/Library bundles. This turns the local-only network boundary into a CI-enforced invariant rather than a documentation promise.

Opening the local Library uses `chrome.runtime.getURL()` and `chrome.tabs.create()` with an extension-owned URL; it is not a remote request.

## 4. Untrusted provider/archive content and DOM XSS

### Result: PASS

ChatGPT/provider text is treated as untrusted data.

The Library transcript and metadata surfaces create DOM nodes and assign provider/archive content with `textContent`. Repository review found no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, or `document.write` path.

Markdown is exported as text. It is not interpreted as HTML inside the Library.

The distribution verifier now fails if dynamic HTML injection sinks appear in the shipped bundles.

Trusted Types is therefore not currently required to compensate for HTML-string sinks because the application does not use those sinks. If future rich HTML rendering is introduced, it requires a new security review rather than silently bypassing this boundary.

## 5. Local archive and pause/private semantics

### Result: PASS

The canonical archive is IndexedDB under the extension origin.

Existing automated tests prove:

- paused turns are not stored as message content;
- paused text is not stored inside suppression events;
- later DOM rescans cannot backfill a suppressed turn after resume;
- stopped state remains durable until explicit Start;
- an unchanged pre-pause turn is not accidentally suppressed;
- restart/reopen and virtualization tests preserve the suppression boundary.

Suppression records retain provider turn identity/reason only; intentionally omitted chat text is not retained for later recovery.

## 6. Import/export boundaries

### Result: PASS with local resource-exhaustion limitation

Markdown/JSON export is explicit user action.

JSON import performs schema validation before persistence and uses atomic restore/merge behavior. It does not execute imported strings as code or render imported archive fields as HTML.

Residual limitation: the current importer reads the selected JSON file as a whole string before parsing. This is acceptable for v0.1 normal backups but is not a streaming parser for extremely large/untrusted files.

## 7. Diagnostics and performance profiling

### Result: PASS

Adapter diagnostics use a strict allowlist and export only:

- generated timestamp/version;
- health-event counts;
- recent `{createdAt, providerId, state, code}` metadata.

Diagnostics deliberately exclude health `detail`, conversation IDs, titles, URLs, messages, checkpoints and projects. Tests inject secret values into those fields and verify they cannot appear in the report.

Performance profiling retains bounded samples containing only metric name, duration, timestamp and item count. Its downloaded report contains aggregate record counts/byte estimates and timing summaries, not archive content or search query text.

## 8. Optional filesystem mirror

### Result: PASS with deletion-retention limitation

The directory is selected through a user gesture. Background mirror operation only queries existing permission; it does not call `requestPermission()` and cannot silently prompt.

The browser archive remains canonical. Mirror errors do not convert a successful archive persistence ACK into failure.

Replacement writes use `FileSystemFileHandle.createWritable()` and close the replacement before stale-path cleanup. If stale-file cleanup fails, the extension retains both copies and reports degraded mirror health rather than risking data loss.

### Residual privacy limitation

Deleting a conversation in the Library removes the IndexedDB conversation/messages/events but **does not delete already-written filesystem mirror files**. Disconnecting a folder also does not remove files previously written there.

This is intentional fail-safe behavior until explicit mirror-retention/deletion semantics are designed. It must be disclosed in release notes/privacy documentation.

## 9. Archive deletion

### Result: PASS for canonical browser archive

Automated tests verify conversation deletion removes the conversation, messages and conversation events atomically from IndexedDB.

The action does not delete the provider's original ChatGPT conversation and does not delete external mirror files. Those are separate copies and must not be implied to be covered by browser-archive deletion.

## 10. Logging and local metadata

### Result: PASS

Runtime logging is limited to operational failures/status. The extension does not intentionally log prompt/assistant bodies as diagnostics or telemetry.

`chrome.storage.local` is used for recorder persistence status, mirror health and bounded content-free performance samples. Chat transcript content remains in IndexedDB rather than being duplicated into general extension settings.

## 11. Build/package review

### Result: PASS

CI verifies:

- MV3 manifest;
- exact minimal permissions/host permissions;
- explicit CSP;
- no web-accessible/external-connectable surface;
- one packaged content script;
- one packaged Library script and no inline/remote Library JavaScript;
- no remotely hosted JavaScript references;
- no eval-like/dynamic HTML sinks;
- no v0.1 network APIs.

Production build currently includes source maps. Source maps contain extension source code, not runtime user archive contents. Whether to retain them in the final release package is a release-size/debuggability decision for TASK-054, not a conversation-data privacy issue.

## 12. Threat/residual-risk summary

Out of scope for v0.1 protection:

- malware or another process with access to the browser profile or explicitly selected filesystem folder;
- a compromised browser/OS account;
- provider-side deletion/retention behavior on ChatGPT itself;
- secure deletion guarantees from SSD/filesystem/browser storage internals;
- encryption-at-rest against a local OS account with access to the browser profile;
- multi-gigabyte hostile JSON import resource exhaustion;
- automatic deletion of external mirror copies.

## 13. Release-candidate security gates

TASK-054 must not claim release readiness until:

1. full typecheck/tests/build/distribution verification is green on this security branch/merged main;
2. authenticated live ChatGPT QA is completed for capture, pause/private/resume, navigation, refresh/streaming and selector-health behavior;
3. install instructions clearly describe extension permissions;
4. privacy statement says conversations remain local unless the user explicitly exports/mirrors them;
5. known limitations explicitly state that browser deletion does not erase provider originals or existing filesystem mirror copies;
6. final release artifact is inspected for intended files/source maps and no unexpected permissions/resources.

## Review disposition

**Ready to proceed to TASK-054 after this branch passes the complete CI gate.**
