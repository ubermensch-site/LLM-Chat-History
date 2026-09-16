# LLM Chat History v0.1 — Install and Update Guide

Status: release-candidate instructions. Do not treat v0.1 as production-approved until the release checklist and authenticated live ChatGPT QA gates are complete.

## Supported browsers

v0.1 targets current desktop Chromium browsers:

- Google Chrome;
- Microsoft Edge.

Mobile browsers, Firefox, Safari and other Chromium variants are not part of the v0.1 acceptance target.

## Release artifacts

A green CI run produces two useful artifacts:

1. `llm-chat-history-unpacked-<commit-sha>` — the already-built unpacked extension directory;
2. `llm-chat-history-v0.1-release-<commit-sha>` — release package containing:
   - `llm-chat-history-v0.1.0.zip`;
   - `llm-chat-history-v0.1.0.zip.sha256`;
   - `zip-contents.txt`.

The release ZIP has `manifest.json` at its root. Production packages intentionally exclude JavaScript source maps.

## Verify the package before installing

After downloading the release artifact, verify the checksum where your operating system provides a SHA-256 tool.

Linux:

```bash
sha256sum -c llm-chat-history-v0.1.0.zip.sha256
```

macOS:

```bash
shasum -a 256 llm-chat-history-v0.1.0.zip
```

Compare the printed digest with the digest in `llm-chat-history-v0.1.0.zip.sha256`.

Windows PowerShell:

```powershell
Get-FileHash .\llm-chat-history-v0.1.0.zip -Algorithm SHA256
Get-Content .\llm-chat-history-v0.1.0.zip.sha256
```

The values should match.

## Install in Google Chrome

1. Extract `llm-chat-history-v0.1.0.zip` to a permanent local folder. Do not load the ZIP itself.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the extracted folder that directly contains `manifest.json`.
6. Confirm **LLM Chat History** appears as version `0.1.0`.
7. Open a supported ChatGPT page and confirm the recorder pill appears.
8. Use the extension toolbar icon to restore the recorder or open the local Library.

## Install in Microsoft Edge

1. Extract `llm-chat-history-v0.1.0.zip` to a permanent local folder.
2. Open `edge://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the extracted folder that directly contains `manifest.json`.
6. Confirm **LLM Chat History** appears as version `0.1.0`.
7. Open a supported ChatGPT page and confirm the recorder pill appears.

## Permissions you should expect

v0.1 requests only:

- extension local storage;
- access to `https://chatgpt.com/*`;
- access to `https://chat.openai.com/*` for compatibility with the older ChatGPT hostname.

The extension does not request broad `<all_urls>` access, cookies, browsing history, downloads, clipboard, identity, native messaging, or network-request interception permissions.

## First-use checks

Before trusting the extension with important work:

1. use a disposable ChatGPT conversation;
2. confirm the recorder says `REC` rather than `ERROR`;
3. send a short test turn and let the assistant finish;
4. open **Library** and confirm the user/assistant turns are present once and in order;
5. test **Pause → disposable private placeholder turn → Resume** and verify the paused text is absent from the Library;
6. minimize/hide the recorder, add another test turn and confirm capture continues;
7. download Markdown and JSON backups;
8. optionally connect a computer folder mirror only after understanding its retention behavior.

The full release QA procedure is in `docs/qa/live-chatgpt-validation.md`.

## Updating an unpacked installation

The browser archive lives under the extension installation's browser storage origin. To reduce the risk of creating a separate unpacked extension identity/storage area:

1. export important conversations to JSON before updating;
2. keep the existing extracted installation folder in place;
3. replace that folder's extension files with the new release contents rather than choosing a completely unrelated install location;
4. open `chrome://extensions` or `edge://extensions`;
5. click **Reload** on the existing LLM Chat History entry;
6. open the Library and verify your existing archive is still present;
7. confirm the displayed extension version is the expected version.

Creating a second unpacked installation may result in a separate extension identity and therefore separate browser-local IndexedDB storage. JSON export/import is the portable recovery path if that happens.

## Uninstalling

Removing the extension removes access to its extension-owned browser storage according to browser behavior. Before uninstalling, export any archive you want to keep.

Uninstalling does **not** remove:

- the original conversations stored by ChatGPT;
- Markdown/JSON files you explicitly downloaded;
- Markdown files already written to an optional computer-folder mirror.

Those copies are independent of the extension installation and must be managed separately.

## Troubleshooting

### Recorder shows adapter error

Open the expanded recorder and read the adapter health code/detail. Repeated inability to find semantic ChatGPT turns escalates to `selector-failure-suspected` instead of failing silently.

Use **Library → Download diagnostics** to create a content-free adapter-health report if you need to file a bug. Do not paste private chat content into GitHub issues.

### Library save error

A red local-archive status indicates canonical IndexedDB persistence failed. Treat this as a capture problem until resolved.

### Computer-folder mirror warning

The mirror is secondary. Reconnect the folder from the Library if browser permission needs user approval again. Mirror failure does not invalidate the canonical browser archive.

### Existing mirror files after Delete

Library Delete removes the browser archive copy. It does not erase files already written into a connected computer folder. Delete those files manually if you want them removed.
