import type {
  AdapterHealthState,
  RecorderCommand,
  RecorderState
} from '../shared/types';

export interface RecorderPillState {
  health: AdapterHealthState;
  recordingState: RecorderState;
  turnCount: number;
  expanded: boolean;
}

export interface RecorderPillOptions {
  onCommand?: (command: RecorderCommand) => void | Promise<void>;
  onOpenLibrary?: () => void | Promise<void>;
}

const HOST_ID = 'llm-chat-history-recorder-host';

export function mountRecorderPill(options: RecorderPillOptions = {}): {
  update(next: Partial<RecorderPillState>): void;
  destroy(): void;
} {
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
      width: 292px; margin-bottom: 8px; padding: 14px; border-radius: 16px;
      background: #fffbfe; color: #1d1b20; box-shadow: 0 4px 18px rgba(0,0,0,.22);
      border: 1px solid #cac4d0;
    }
    .panel[hidden] { display: none; }
    .header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .title { font-size: 14px; font-weight: 700; }
    .icon-button {
      border: 0; background: transparent; border-radius: 999px; min-width: 32px; min-height: 32px;
      cursor: pointer; color: #49454f;
    }
    .meta { margin-top: 6px; font-size: 12px; line-height: 1.45; color: #49454f; }
    .actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
    .action {
      border: 1px solid #79747e; background: #fffbfe; color: #49454f;
      border-radius: 999px; min-height: 36px; padding: 0 14px; cursor: pointer; font-weight: 600;
    }
    .action.primary { background: #6750a4; border-color: #6750a4; color: #fff; }
    .action.danger { color: #b3261e; border-color: #b3261e; }
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
  const minimize = document.createElement('button');
  minimize.type = 'button';
  minimize.className = 'icon-button';
  minimize.textContent = '—';
  minimize.setAttribute('aria-label', 'Minimize recorder panel');
  header.append(title, minimize);

  const meta = document.createElement('div');
  meta.className = 'meta';
  const actions = document.createElement('div');
  actions.className = 'actions';
  const primary = document.createElement('button');
  primary.type = 'button';
  primary.className = 'action primary';
  const stop = document.createElement('button');
  stop.type = 'button';
  stop.className = 'action danger';
  stop.textContent = 'Stop';
  const library = document.createElement('button');
  library.type = 'button';
  library.className = 'action';
  library.textContent = 'Library';
  library.setAttribute('aria-label', 'Open local chat archive library');
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = 'Minimizing this panel never changes recording state.';
  actions.append(primary, stop, library);
  panel.append(header, meta, actions, hint);

  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'pill';
  pill.setAttribute('aria-label', 'LLM Chat History recorder status');
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  pill.append(dot, label);
  wrap.append(panel, pill);
  shadow.append(style, wrap);

  let state: RecorderPillState = {
    health: 'healthy',
    recordingState: 'recording',
    turnCount: 0,
    expanded: false
  };
  let busy = false;

  const statusLabel = (): string => {
    if (state.health === 'error') return 'ERROR';
    if (state.recordingState === 'paused') return 'PAUSED';
    if (state.recordingState === 'stopped') return 'STOPPED';
    if (state.recordingState === 'error') return 'ERROR';
    return state.health === 'degraded' ? 'REC !' : 'REC';
  };

  const render = () => {
    const visualState = state.health === 'error' || state.recordingState === 'error'
      ? 'error'
      : state.recordingState === 'paused'
        ? 'paused'
        : state.recordingState === 'stopped'
          ? 'stopped'
          : state.health === 'degraded'
            ? 'degraded'
            : 'recording';

    dot.className = `dot ${visualState}`;
    label.textContent = `${statusLabel()} · ${state.turnCount}`;
    panel.hidden = !state.expanded;
    meta.textContent = `Recorder: ${state.recordingState} · Adapter: ${state.health} · Rendered turns: ${state.turnCount}`;
    pill.setAttribute('aria-expanded', String(state.expanded));

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

    primary.disabled = busy;
    stop.disabled = busy || state.recordingState === 'stopped';
    library.disabled = busy;
  };

  const runCommand = async (command: RecorderCommand) => {
    if (!options.onCommand || busy) return;
    busy = true;
    render();
    try {
      await options.onCommand(command);
    } finally {
      busy = false;
      render();
    }
  };

  pill.addEventListener('click', () => {
    state = { ...state, expanded: !state.expanded };
    render();
  });
  minimize.addEventListener('click', () => {
    state = { ...state, expanded: false };
    render();
  });
  primary.addEventListener('click', () => {
    const command = primary.dataset.command as RecorderCommand | undefined;
    if (command) void runCommand(command);
  });
  stop.addEventListener('click', () => void runCommand('stop'));
  library.addEventListener('click', () => {
    if (!options.onOpenLibrary || busy) return;
    void options.onOpenLibrary();
  });

  render();

  return {
    update(next) {
      state = { ...state, ...next };
      render();
    },
    destroy() {
      host.remove();
    }
  };
}
