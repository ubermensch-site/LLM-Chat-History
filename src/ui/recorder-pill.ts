import type {
  AdapterHealthState,
  RecorderCommand,
  RecorderState
} from '../shared/types';
import {
  advanceStopConfirmation,
  isStopConfirmationArmed,
  transitionRecorderVisibility,
  type RecorderVisibility,
  type StopConfirmationState
} from './recorder-ui-state';

export type StorageHealthState = 'unknown' | 'healthy' | 'error';

export interface RecorderPillState {
  health: AdapterHealthState;
  healthCode: string | null;
  healthDetail: string | null;
  recordingState: RecorderState;
  turnCount: number;
  storageHealth: StorageHealthState;
  lastSavedAt: string | null;
}

export interface RecorderPillOptions {
  onCommand?: (command: RecorderCommand) => void | Promise<void>;
  onCheckpoint?: (name: string, note: string | null) => void | Promise<void>;
  onOpenLibrary?: () => void | Promise<void>;
}

export interface RecorderPillHandle {
  update(next: Partial<RecorderPillState>): void;
  show(): void;
  hide(): void;
  destroy(): void;
}

const HOST_ID = 'llm-chat-history-recorder-host';
const STOP_CONFIRMATION_MS = 5_000;

export function mountRecorderPill(options: RecorderPillOptions = {}): RecorderPillHandle {
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.position = 'fixed';
  host.style.right = '16px';
  host.style.bottom = '84px';
  host.style.zIndex = '2147483647';
  host.style.pointerEvents = 'auto';
  document.documentElement.append(host);

  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .wrap { font-family: Roboto, Arial, sans-serif; color: #1d1b20; }
    button { font: inherit; }
    button:focus-visible { outline: 3px solid #6750a4; outline-offset: 2px; }
    .pill {
      border: 0; border-radius: 999px; min-height: 40px; padding: 0 14px;
      background: #e8def8; color: #1d192b; box-shadow: 0 2px 8px rgba(0,0,0,.18);
      cursor: pointer; display: inline-flex; align-items: center; gap: 8px;
      font-size: 13px; font-weight: 600;
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #2e7d32; }
    .dot.paused, .dot.degraded { background: #b26a00; }
    .dot.stopped { background: #79747e; }
    .dot.error { background: #b3261e; }
    .panel {
      width: 300px; margin-bottom: 8px; padding: 14px; border-radius: 16px;
      background: #fffbfe; color: #1d1b20; box-shadow: 0 4px 18px rgba(0,0,0,.22);
      border: 1px solid #cac4d0;
    }
    .panel[hidden] { display: none; }
    .header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .header-actions { display: flex; align-items: center; gap: 2px; }
    .title { font-size: 14px; font-weight: 700; }
    .icon-button {
      border: 0; background: transparent; border-radius: 999px; min-width: 32px; min-height: 32px;
      cursor: pointer; color: #49454f;
    }
    .meta { margin-top: 6px; font-size: 12px; line-height: 1.45; color: #49454f; }
    .adapter-health {
      margin-top: 8px; padding: 8px 10px; border-radius: 10px; background: #f3edf7;
      font-size: 11px; line-height: 1.35; color: #49454f; overflow-wrap: anywhere;
    }
    .adapter-health.degraded { background: #fff3e0; color: #6d4c00; }
    .adapter-health.error { background: #f9dedc; color: #8c1d18; }
    .storage {
      margin-top: 8px; padding: 8px 10px; border-radius: 10px; background: #f3edf7;
      font-size: 11px; line-height: 1.35; color: #49454f;
    }
    .storage.error { background: #f9dedc; color: #8c1d18; }
    .actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
    .action {
      border: 1px solid #79747e; background: #fffbfe; color: #49454f;
      border-radius: 999px; min-height: 36px; padding: 0 14px; cursor: pointer; font-weight: 600;
    }
    .action.primary { background: #6750a4; border-color: #6750a4; color: #fff; }
    .action.danger { color: #b3261e; border-color: #b3261e; }
    .action.confirm { background: #b3261e; border-color: #b3261e; color: #fff; }
    .action:disabled { opacity: .55; cursor: default; }
    .hint { margin-top: 10px; font-size: 11px; line-height: 1.35; color: #625b71; }
  `;

  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.hidden = true;

  const header = document.createElement('div');
  header.className = 'header';
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = 'LLM Chat History';

  const headerActions = document.createElement('div');
  headerActions.className = 'header-actions';
  const minimize = document.createElement('button');
  minimize.type = 'button';
  minimize.className = 'icon-button';
  minimize.textContent = '—';
  minimize.setAttribute('aria-label', 'Minimize recorder to compact pill');
  const hide = document.createElement('button');
  hide.type = 'button';
  hide.className = 'icon-button';
  hide.textContent = '×';
  hide.setAttribute('aria-label', 'Hide recorder controls; recording continues');
  headerActions.append(minimize, hide);
  header.append(title, headerActions);

  const meta = document.createElement('div');
  meta.className = 'meta';
  const adapterHealth = document.createElement('div');
  adapterHealth.className = 'adapter-health';
  adapterHealth.setAttribute('aria-live', 'polite');
  const storage = document.createElement('div');
  storage.className = 'storage';
  storage.setAttribute('aria-live', 'polite');

  const actions = document.createElement('div');
  actions.className = 'actions';
  const primary = document.createElement('button');
  primary.type = 'button';
  primary.className = 'action primary';
  const checkpoint = document.createElement('button');
  checkpoint.type = 'button';
  checkpoint.className = 'action';
  checkpoint.textContent = 'Checkpoint';
  checkpoint.setAttribute('aria-label', 'Add a named checkpoint to this local conversation archive');
  const stop = document.createElement('button');
  stop.type = 'button';
  stop.className = 'action danger';
  const library = document.createElement('button');
  library.type = 'button';
  library.className = 'action';
  library.textContent = 'Library';
  library.setAttribute('aria-label', 'Open local chat archive library');

  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = 'Minimize or Hide only changes this UI. Recording stops only after explicit Stop confirmation. Checkpoints are explicit local notes and can be added while paused or stopped. Click the extension toolbar icon to restore a hidden recorder.';
  actions.append(primary, checkpoint, stop, library);
  panel.append(header, meta, adapterHealth, storage, actions, hint);

  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'pill';
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  pill.append(dot, label);
  wrap.append(panel, pill);
  shadow.append(style, wrap);

  let state: RecorderPillState = {
    health: 'healthy',
    healthCode: null,
    healthDetail: null,
    recordingState: 'recording',
    turnCount: 0,
    storageHealth: 'unknown',
    lastSavedAt: null
  };
  let visibility: RecorderVisibility = 'collapsed';
  let busy = false;
  let stopConfirmation: StopConfirmationState = { deadlineMs: null };
  let stopResetTimer: number | null = null;

  const resetStopConfirmation = () => {
    stopConfirmation = { deadlineMs: null };
    if (stopResetTimer !== null) {
      window.clearTimeout(stopResetTimer);
      stopResetTimer = null;
    }
  };

  const statusLabel = (): string => {
    if (state.health === 'error' || state.recordingState === 'error') return 'ERROR';
    if (state.recordingState === 'paused') return 'PAUSED';
    if (state.recordingState === 'stopped') return 'STOPPED';
    return state.health === 'degraded' ? 'REC !' : 'REC';
  };

  const storageLabel = (): string => {
    if (state.storageHealth === 'error') return 'Local archive: save failed. Recording needs attention.';
    if (state.storageHealth === 'unknown' || !state.lastSavedAt) return 'Local archive: waiting for first confirmed save.';
    const date = new Date(state.lastSavedAt);
    const saved = Number.isNaN(date.getTime()) ? state.lastSavedAt : date.toLocaleTimeString();
    return `Local archive: saved successfully at ${saved}.`;
  };

  const adapterLabel = (): string => {
    const code = state.healthCode ? ` · ${state.healthCode}` : '';
    const detail = state.healthDetail ? ` — ${state.healthDetail}` : '';
    return `Adapter: ${state.health}${code}${detail}`;
  };

  const render = () => {
    if (state.recordingState === 'stopped') resetStopConfirmation();

    const visualState = state.health === 'error' || state.recordingState === 'error'
      ? 'error'
      : state.recordingState === 'paused'
        ? 'paused'
        : state.recordingState === 'stopped'
          ? 'stopped'
          : state.health === 'degraded'
            ? 'degraded'
            : 'recording';

    host.style.display = visibility === 'hidden' ? 'none' : 'block';
    dot.className = `dot ${visualState}`;
    label.textContent = `${statusLabel()} · ${state.turnCount}`;
    pill.setAttribute('aria-label', `LLM Chat History: ${statusLabel()}, ${state.turnCount} rendered turns`);
    panel.hidden = visibility !== 'expanded';
    pill.setAttribute('aria-expanded', String(visibility === 'expanded'));

    meta.textContent = `Recorder: ${state.recordingState} · Rendered turns: ${state.turnCount}`;
    adapterHealth.className = `adapter-health ${state.health}`;
    adapterHealth.textContent = adapterLabel();
    storage.className = `storage${state.storageHealth === 'error' ? ' error' : ''}`;
    storage.textContent = storageLabel();

    if (state.recordingState === 'recording') {
      primary.textContent = 'Pause';
      primary.dataset.command = 'pause';
    } else if (state.recordingState === 'paused') {
      primary.textContent = 'Resume';
      primary.dataset.command = 'resume';
    } else {
      primary.textContent = 'Start';
      primary.dataset.command = 'start';
    }

    const stopArmed = isStopConfirmationArmed(stopConfirmation, Date.now());
    stop.textContent = stopArmed ? 'Confirm stop' : 'Stop';
    stop.className = `action danger${stopArmed ? ' confirm' : ''}`;
    stop.setAttribute(
      'aria-label',
      stopArmed ? 'Confirm stopping conversation recording' : 'Prepare to stop conversation recording'
    );

    primary.disabled = busy;
    checkpoint.disabled = busy || !options.onCheckpoint;
    stop.disabled = busy || state.recordingState === 'stopped';
    library.disabled = busy;
  };

  const runCommand = async (command: RecorderCommand) => {
    if (!options.onCommand || busy) return;
    busy = true;
    render();
    try {
      await options.onCommand(command);
    } catch {
      // The content-script transport updates visible health state; avoid an unhandled UI promise.
    } finally {
      busy = false;
      render();
    }
  };

  const createCheckpoint = async () => {
    if (!options.onCheckpoint || busy) return;
    const name = window.prompt('Checkpoint name');
    if (name === null || !name.trim()) return;
    const note = window.prompt('Optional checkpoint note', '');
    if (note === null) return;
    busy = true;
    render();
    try {
      await options.onCheckpoint(name.trim(), note.trim() || null);
    } catch {
      // The content-script transport updates visible health state; avoid an unhandled UI promise.
    } finally {
      busy = false;
      render();
    }
  };

  const armOrConfirmStop = () => {
    if (busy || state.recordingState === 'stopped') return;
    const result = advanceStopConfirmation(stopConfirmation, Date.now(), STOP_CONFIRMATION_MS);
    stopConfirmation = result.state;

    if (result.confirmed) {
      resetStopConfirmation();
      void runCommand('stop');
      return;
    }

    if (stopResetTimer !== null) window.clearTimeout(stopResetTimer);
    stopResetTimer = window.setTimeout(() => {
      resetStopConfirmation();
      render();
    }, STOP_CONFIRMATION_MS + 50);
    render();
  };

  pill.addEventListener('click', () => {
    visibility = transitionRecorderVisibility(visibility, 'toggle');
    render();
  });
  minimize.addEventListener('click', () => {
    visibility = transitionRecorderVisibility(visibility, 'minimize');
    render();
  });
  hide.addEventListener('click', () => {
    visibility = transitionRecorderVisibility(visibility, 'hide');
    render();
  });
  primary.addEventListener('click', () => {
    const command = primary.dataset.command as RecorderCommand | undefined;
    if (command) void runCommand(command);
  });
  checkpoint.addEventListener('click', () => {
    void createCheckpoint();
  });
  stop.addEventListener('click', armOrConfirmStop);
  library.addEventListener('click', () => {
    if (!options.onOpenLibrary || busy) return;
    void Promise.resolve(options.onOpenLibrary()).catch(() => undefined);
  });

  render();

  return {
    update(next) {
      state = { ...state, ...next };
      render();
    },
    show() {
      visibility = transitionRecorderVisibility(visibility, 'show');
      render();
    },
    hide() {
      visibility = transitionRecorderVisibility(visibility, 'hide');
      render();
    },
    destroy() {
      resetStopConfirmation();
      host.remove();
    }
  };
}
