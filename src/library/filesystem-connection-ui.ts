import {
  clearStoredDirectoryHandle,
  directoryPickerSupported,
  getStoredDirectoryHandle,
  openMirrorSettingsDb,
  pickDirectory,
  queryDirectoryHealth,
  requestDirectoryPermission,
  storeDirectoryHandle,
  type MirrorConnectionHealth
} from '../filesystem/connection';
import {
  MIRROR_RUNTIME_STATUS_KEY,
  type MirrorRuntimeStatus
} from '../filesystem/status';

const sidebar = document.querySelector<HTMLElement>('#settings-utility-content');
if (!sidebar) throw new Error('Missing Library settings utility surface for filesystem connection controls');

const style = document.createElement('style');
style.textContent = `
  .mirror-card { margin: 16px 2px 0; padding: 12px; border: 1px solid var(--outline-variant); border-radius: 16px; background: var(--surface); }
  .mirror-title { font-size: 13px; font-weight: 750; }
  .mirror-health { display: flex; align-items: flex-start; gap: 8px; margin-top: 8px; font-size: 12px; line-height: 1.35; color: var(--on-surface-variant); }
  .mirror-dot { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%; margin-top: 4px; background: var(--outline); }
  .mirror-dot.connected { background: #2e7d32; }
  .mirror-dot.permission-needed { background: #b26a00; }
  .mirror-dot.denied, .mirror-dot.error { background: var(--error); }
  .mirror-folder { margin-top: 5px; font-weight: 650; color: var(--on-surface); overflow-wrap: anywhere; }
  .mirror-runtime { margin-top: 8px; padding: 8px 9px; border-radius: 10px; background: var(--surface-container); font-size: 10px; line-height: 1.4; color: var(--on-surface-variant); overflow-wrap: anywhere; }
  .mirror-runtime.degraded, .mirror-runtime.permission-needed { background: #fff3d6; color: #6b4d00; }
  .mirror-runtime.denied, .mirror-runtime.error { background: color-mix(in srgb, var(--error) 10%, var(--surface)); color: var(--error); }
  .mirror-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .mirror-button { min-height: 32px; border: 1px solid var(--outline); border-radius: 18px; padding: 0 10px; background: var(--surface); color: var(--on-surface); cursor: pointer; font: inherit; font-size: 11px; font-weight: 650; }
  .mirror-button.primary { background: var(--primary); border-color: var(--primary); color: var(--on-primary); }
  .mirror-button:disabled { opacity: .45; cursor: default; }
  .mirror-note { margin: 8px 0 0; font-size: 10px; line-height: 1.35; color: var(--on-surface-variant); }
`;
document.head.append(style);

const card = document.createElement('section');
card.className = 'mirror-card';
card.setAttribute('aria-label', 'Computer folder mirror');

const title = document.createElement('div');
title.className = 'mirror-title';
title.textContent = 'Computer folder mirror';

const healthRow = document.createElement('div');
healthRow.className = 'mirror-health';
healthRow.setAttribute('aria-live', 'polite');
const dot = document.createElement('span');
dot.className = 'mirror-dot';
dot.setAttribute('aria-hidden', 'true');
const healthText = document.createElement('span');
healthRow.append(dot, healthText);

const folder = document.createElement('div');
folder.className = 'mirror-folder';
folder.hidden = true;

const runtime = document.createElement('div');
runtime.className = 'mirror-runtime';
runtime.setAttribute('aria-live', 'polite');

const actions = document.createElement('div');
actions.className = 'mirror-actions';
const primary = document.createElement('button');
primary.type = 'button';
primary.className = 'mirror-button primary';
const chooseAnother = document.createElement('button');
chooseAnother.type = 'button';
chooseAnother.className = 'mirror-button';
chooseAnother.textContent = 'Choose another';
const disconnect = document.createElement('button');
disconnect.type = 'button';
disconnect.className = 'mirror-button';
disconnect.textContent = 'Disconnect';
actions.append(primary, chooseAnother, disconnect);

const note = document.createElement('p');
note.className = 'mirror-note';
note.textContent = 'Optional Markdown mirror. Your browser IndexedDB archive remains canonical; mirror failures never stop local capture.';

card.append(title, healthRow, folder, runtime, actions, note);
sidebar.append(card);

const dbPromise = openMirrorSettingsDb();
let currentHandle: FileSystemDirectoryHandle | null = null;
let health: MirrorConnectionHealth = {
  state: directoryPickerSupported() ? 'disconnected' : 'unsupported',
  folderName: null,
  detail: null
};
let runtimeStatus: MirrorRuntimeStatus | null = null;
let busy = false;

function healthLabel(value: MirrorConnectionHealth): string {
  switch (value.state) {
    case 'connected':
      return 'Connected and write permission is currently granted.';
    case 'permission-needed':
      return value.detail ?? 'Folder access needs your permission again.';
    case 'denied':
      return value.detail ?? 'Folder access is denied.';
    case 'unsupported':
      return value.detail ?? 'Local folder access is unavailable in this browser.';
    case 'error':
      return value.detail ?? 'Unable to check the folder connection.';
    case 'disconnected':
      return 'No computer folder is connected.';
  }
}

function runtimeLabel(value: MirrorRuntimeStatus | null): string {
  if (!value) {
    return currentHandle
      ? 'No automatic mirror write has been recorded yet.'
      : 'Automatic mirroring is idle until a folder is connected.';
  }
  const date = new Date(value.updatedAt);
  const when = Number.isNaN(date.getTime()) ? value.updatedAt : date.toLocaleString();
  switch (value.state) {
    case 'healthy':
      return `Last mirrored ${when}${value.path ? ` · ${value.path}` : ''}`;
    case 'degraded':
      return `Mirror updated with a cleanup warning · ${value.detail ?? when}`;
    case 'permission-needed':
    case 'denied':
      return value.detail ?? 'Mirror write permission is unavailable.';
    case 'error':
      return `Mirror write failed · ${value.detail ?? when}`;
    case 'disconnected':
      return 'Automatic mirroring is idle because no folder is connected.';
  }
}

function render(): void {
  dot.className = `mirror-dot ${health.state}`;
  healthText.textContent = healthLabel(health);
  folder.hidden = !health.folderName;
  folder.textContent = health.folderName ? `Folder: ${health.folderName}` : '';
  runtime.className = `mirror-runtime${runtimeStatus ? ` ${runtimeStatus.state}` : ''}`;
  runtime.textContent = runtimeLabel(runtimeStatus);

  const supported = health.state !== 'unsupported';
  const hasHandle = Boolean(currentHandle);
  const alreadyConnected = hasHandle && health.state === 'connected';
  primary.disabled = busy || !supported || alreadyConnected;
  chooseAnother.disabled = busy || !supported;
  disconnect.disabled = busy || !hasHandle;
  chooseAnother.hidden = !hasHandle;
  disconnect.hidden = !hasHandle;

  primary.textContent = alreadyConnected
    ? 'Connected'
    : hasHandle
      ? 'Reconnect'
      : 'Connect folder';
}

async function refresh(): Promise<void> {
  try {
    const [db, stored] = await Promise.all([
      dbPromise,
      chrome.storage.local.get(MIRROR_RUNTIME_STATUS_KEY)
    ]);
    currentHandle = await getStoredDirectoryHandle(db);
    health = await queryDirectoryHealth(currentHandle);
    runtimeStatus = (stored[MIRROR_RUNTIME_STATUS_KEY] as MirrorRuntimeStatus | undefined) ?? null;
  } catch (error) {
    health = {
      state: 'error',
      folderName: currentHandle?.name ?? null,
      detail: error instanceof Error ? error.message : String(error)
    };
  }
  render();
}

async function chooseFolder(): Promise<void> {
  if (busy) return;
  busy = true;
  render();
  try {
    // The picker call occurs before any await/IndexedDB work so it consumes the
    // user activation from this click directly.
    const handle = await pickDirectory();
    const db = await dbPromise;
    await storeDirectoryHandle(db, handle);
    currentHandle = handle;
    health = await queryDirectoryHealth(handle);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      health = await queryDirectoryHealth(currentHandle);
      return;
    }
    health = {
      state: 'error',
      folderName: currentHandle?.name ?? null,
      detail: error instanceof Error ? error.message : String(error)
    };
  } finally {
    busy = false;
    render();
  }
}

async function reconnect(): Promise<void> {
  if (busy || !currentHandle) return;
  busy = true;
  render();
  try {
    // Deliberately use the already-loaded handle here. requestPermission() requires
    // transient user activation, so do not insert an IndexedDB lookup before it.
    health = await requestDirectoryPermission(currentHandle);
  } catch (error) {
    health = {
      state: 'error',
      folderName: currentHandle.name,
      detail: error instanceof Error ? error.message : String(error)
    };
  } finally {
    busy = false;
    render();
  }
}

primary.addEventListener('click', () => {
  if (!currentHandle) {
    void chooseFolder();
    return;
  }
  void reconnect();
});

chooseAnother.addEventListener('click', () => {
  void chooseFolder();
});

disconnect.addEventListener('click', () => {
  if (busy) return;
  busy = true;
  render();
  void dbPromise
    .then((db) => clearStoredDirectoryHandle(db))
    .then(() => chrome.storage.local.remove(MIRROR_RUNTIME_STATUS_KEY))
    .then(() => {
      currentHandle = null;
      runtimeStatus = null;
      health = { state: 'disconnected', folderName: null, detail: null };
    })
    .catch((error: unknown) => {
      health = {
        state: 'error',
        folderName: currentHandle?.name ?? null,
        detail: error instanceof Error ? error.message : String(error)
      };
    })
    .finally(() => {
      busy = false;
      render();
    });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  const change = changes[MIRROR_RUNTIME_STATUS_KEY];
  if (!change) return;
  runtimeStatus = (change.newValue as MirrorRuntimeStatus | undefined) ?? null;
  render();
});

render();
void refresh();
