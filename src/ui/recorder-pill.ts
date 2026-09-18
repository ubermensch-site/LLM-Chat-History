import type {
  AdapterHealthState,
  RecorderCommand,
  RecorderState
} from '../shared/types';
import {
  RECORDER_POSITION_STORAGE_KEY,
  clampRecorderPosition,
  normalizeRecorderPosition,
  type RecorderPosition
} from './recorder-position';
import {
  advanceStopConfirmation,
  isStopConfirmationArmed,
  transitionRecorderVisibility,
  type RecorderVisibility,
  type StopConfirmationState
} from './recorder-ui-state';
import {
  THEME_STORAGE_KEY,
  normalizeThemePreference,
  readThemePreference,
  resolveTheme,
  writeThemePreference,
  type ThemePreference
} from './theme-preference';

export type StorageHealthState = 'unknown' | 'healthy' | 'error';

export interface HistoricalImportSummary {
  windowsScanned: number;
  uniqueTurnsSeen: number;
  complete: boolean;
  truncated: boolean;
}

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
  onImportHistory?: () => Promise<HistoricalImportSummary>;
  onDownloadLiveQaReport?: () => void | Promise<void>;
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
const DRAG_THRESHOLD_PX = 4;

function readRecorderPosition(): Promise<RecorderPosition | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(RECORDER_POSITION_STORAGE_KEY, (result) => {
      resolve(normalizeRecorderPosition(result[RECORDER_POSITION_STORAGE_KEY]));
    });
  });
}

function writeRecorderPosition(position: RecorderPosition): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [RECORDER_POSITION_STORAGE_KEY]: position }, () => resolve());
  });
}

function button(text: string, className = 'action'): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = text;
  return element;
}

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
    .wrap {
      --accent: #2f6b55;
      --accent-strong: #285a49;
      --accent-soft: #e8f1ec;
      --surface: #fffdf8;
      --surface-raised: #ffffff;
      --surface-soft: #f6f2e9;
      --text: #23251f;
      --muted: #6d7068;
      --outline: #d9d6cc;
      --outline-strong: #b9b6ab;
      --good: #2f6b55;
      --warn: #a36a18;
      --bad: #a44339;
      --shadow: 0 18px 48px rgba(38, 39, 34, .18), 0 3px 12px rgba(38, 39, 34, .08);
      font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--text);
      color-scheme: light;
      font-size: 13px;
      line-height: 1.45;
    }
    .wrap[data-theme="dark"] {
      --accent: #8fc7aa;
      --accent-strong: #a9d6bf;
      --accent-soft: #263b31;
      --surface: #181a17;
      --surface-raised: #20231f;
      --surface-soft: #262a25;
      --text: #f0f0ea;
      --muted: #b3b6ae;
      --outline: #3c413a;
      --outline-strong: #5d645a;
      --good: #8fc7aa;
      --warn: #e3b267;
      --bad: #ef9a91;
      --shadow: 0 18px 50px rgba(0, 0, 0, .42), 0 3px 12px rgba(0, 0, 0, .3);
      color-scheme: dark;
    }
    button, summary { font: inherit; }
    button:focus-visible, summary:focus-visible {
      outline: 3px solid color-mix(in srgb, var(--accent) 42%, transparent);
      outline-offset: 2px;
    }
    .pill {
      min-height: 42px;
      max-width: min(320px, calc(100vw - 24px));
      padding: 0 13px;
      border: 1px solid var(--outline);
      border-radius: 999px;
      background: var(--surface-raised);
      color: var(--text);
      box-shadow: 0 8px 28px rgba(38, 39, 34, .15), 0 2px 8px rgba(38, 39, 34, .08);
      cursor: grab;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      font-weight: 750;
      letter-spacing: -.01em;
      user-select: none;
      touch-action: none;
      white-space: nowrap;
    }
    .pill:hover { border-color: var(--outline-strong); }
    .pill:active, .drag-handle:active { cursor: grabbing; }
    .pill::after {
      content: "⌄";
      display: inline-block;
      margin-left: 1px;
      color: var(--muted);
      font-size: 14px;
      transform: translateY(-1px);
      transition: transform .16s ease;
    }
    .pill[aria-expanded="true"]::after { transform: rotate(180deg) translateY(-1px); }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--good);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--good) 14%, transparent);
      flex: 0 0 auto;
    }
    .dot.paused, .dot.degraded {
      background: var(--warn);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--warn) 14%, transparent);
    }
    .dot.stopped {
      background: var(--outline-strong);
      box-shadow: none;
    }
    .dot.error {
      background: var(--bad);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--bad) 14%, transparent);
    }
    .panel {
      width: min(368px, calc(100vw - 24px));
      max-height: min(640px, calc(100vh - 32px));
      overflow: auto;
      margin-bottom: 8px;
      padding: 16px;
      border: 1px solid var(--outline);
      border-radius: 20px;
      background: var(--surface);
      color: var(--text);
      box-shadow: var(--shadow);
      scrollbar-width: thin;
    }
    .panel[hidden] { display: none; }
    .header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .drag-handle {
      min-width: 0;
      flex: 1;
      cursor: grab;
      user-select: none;
      touch-action: none;
    }
    .title {
      font-family: Poppins, Inter, ui-sans-serif, sans-serif;
      font-size: 15px;
      line-height: 1.25;
      font-weight: 700;
      letter-spacing: -.02em;
    }
    .move-help {
      margin-top: 3px;
      font-size: 10px;
      color: var(--muted);
    }
    .header-actions {
      display: flex;
      gap: 5px;
      flex: 0 0 auto;
    }
    .small-button {
      min-height: 30px;
      padding: 0 9px;
      border: 1px solid transparent;
      border-radius: 999px;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      font-size: 10px;
      font-weight: 700;
    }
    .small-button:hover {
      border-color: var(--outline);
      background: var(--surface-soft);
      color: var(--text);
    }
    .status-card {
      margin-top: 14px;
      padding: 12px 13px;
      border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--outline));
      border-radius: 14px;
      background: var(--accent-soft);
      color: var(--text);
      font-size: 12px;
      line-height: 1.45;
    }
    .status-card strong {
      display: block;
      margin-bottom: 3px;
      font-family: Poppins, Inter, ui-sans-serif, sans-serif;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: -.01em;
    }
    .storage {
      margin-top: 8px;
      padding: 0 2px;
      color: var(--muted);
      font-size: 10.5px;
      line-height: 1.4;
    }
    .storage strong {
      display: inline;
      margin-right: 4px;
      color: var(--text);
      font-weight: 700;
    }
    .storage.error {
      padding: 8px 10px;
      border: 1px solid color-mix(in srgb, var(--bad) 55%, var(--outline));
      border-radius: 10px;
      color: var(--bad);
    }
    .history-status {
      margin-top: 10px;
      padding: 9px 10px;
      border-radius: 10px;
      background: var(--surface-soft);
      color: var(--muted);
      font-size: 11px;
      line-height: 1.42;
    }
    .history-status.error {
      border: 1px solid color-mix(in srgb, var(--bad) 55%, var(--outline));
      color: var(--bad);
    }
    .history-status[hidden] { display: none; }
    .actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-top: 14px;
    }
    .action {
      min-height: 42px;
      padding: 7px 10px;
      border: 1px solid var(--outline);
      border-radius: 11px;
      background: var(--surface-raised);
      color: var(--text);
      cursor: pointer;
      font-weight: 700;
      line-height: 1.2;
    }
    .action:hover:not(:disabled) {
      border-color: var(--outline-strong);
      background: var(--surface-soft);
    }
    .action.primary {
      border-color: var(--accent);
      background: var(--accent);
      color: #fff;
    }
    .wrap[data-theme="dark"] .action.primary { color: #13251d; }
    .action.primary:hover:not(:disabled) {
      border-color: var(--accent-strong);
      background: var(--accent-strong);
    }
    .action.library {
      grid-column: 1 / -1;
      border-color: color-mix(in srgb, var(--accent) 45%, var(--outline));
      color: var(--accent-strong);
    }
    .wrap[data-theme="dark"] .action.library { color: var(--accent); }
    .action.danger {
      color: var(--bad);
      border-color: color-mix(in srgb, var(--bad) 55%, var(--outline));
    }
    .action.confirm {
      background: var(--bad);
      border-color: var(--bad);
      color: #fff;
    }
    .action.wide { grid-column: 1 / -1; }
    .action:disabled { opacity: .45; cursor: default; }
    .helper {
      margin-top: 10px;
      color: var(--muted);
      font-size: 10.5px;
      line-height: 1.45;
    }
    details.disclosure {
      margin-top: 12px;
      border-top: 1px solid var(--outline);
      padding-top: 11px;
      color: var(--muted);
      font-size: 11px;
    }
    details.disclosure > summary {
      list-style: none;
      cursor: pointer;
      color: var(--text);
      font-weight: 750;
    }
    details.disclosure > summary::-webkit-details-marker { display: none; }
    details.disclosure > summary::after {
      content: "+";
      float: right;
      color: var(--muted);
      font-size: 15px;
      font-weight: 500;
      line-height: 1;
    }
    details.disclosure[open] > summary::after { content: "−"; }
    .advanced-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-top: 10px;
    }
    .appearance {
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px solid var(--outline);
    }
    .appearance-title {
      color: var(--text);
      font-size: 11px;
      font-weight: 750;
    }
    .appearance-help {
      margin-top: 2px;
      color: var(--muted);
      font-size: 10px;
      line-height: 1.4;
    }
    .theme-buttons {
      display: flex;
      gap: 5px;
      margin-top: 7px;
    }
    .theme-button {
      flex: 1;
      min-height: 32px;
      border: 1px solid var(--outline);
      border-radius: 9px;
      background: var(--surface-raised);
      color: var(--muted);
      cursor: pointer;
      font-size: 10px;
      font-weight: 700;
    }
    .theme-button.selected {
      border-color: var(--accent);
      background: var(--accent-soft);
      color: var(--accent-strong);
    }
    .technical {
      margin-top: 8px;
      padding: 9px 10px;
      border-radius: 9px;
      background: var(--surface-soft);
      color: var(--muted);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 9.5px;
      line-height: 1.45;
    }
    .qa-action { margin-top: 8px; width: 100%; }
    @media (max-width: 420px) {
      .panel { padding: 14px; border-radius: 17px; }
      .actions, .advanced-actions { grid-template-columns: 1fr; }
      .action.library, .action.wide { grid-column: 1; }
      .move-help { display: none; }
      .small-button { padding: 0 7px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .pill::after { transition: none; }
    }
  `;

  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  wrap.dataset.theme = 'light';

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.hidden = true;

  const header = document.createElement('div');
  header.className = 'header';
  const dragHandle = document.createElement('div');
  dragHandle.className = 'drag-handle';
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = 'LLM Chat History';
  const moveHelp = document.createElement('div');
  moveHelp.className = 'move-help';
  moveHelp.textContent = 'Local recorder · Drag to move';
  dragHandle.append(title, moveHelp);

  const headerActions = document.createElement('div');
  headerActions.className = 'header-actions';
  const minimize = button('Collapse', 'small-button');
  minimize.setAttribute('aria-label', 'Make this recorder small. Saving will continue.');
  const hide = button('Hide', 'small-button');
  hide.setAttribute('aria-label', 'Hide this recorder. Saving will continue.');
  headerActions.append(minimize, hide);
  header.append(dragHandle, headerActions);

  const statusCard = document.createElement('div');
  statusCard.className = 'status-card';
  statusCard.setAttribute('aria-live', 'polite');
  const storage = document.createElement('div');
  storage.className = 'storage';
  storage.setAttribute('aria-live', 'polite');
  const historyStatus = document.createElement('div');
  historyStatus.className = 'history-status';
  historyStatus.setAttribute('aria-live', 'polite');
  historyStatus.hidden = true;

  const actions = document.createElement('div');
  actions.className = 'actions';
  const primary = button('Pause saving', 'action primary');
  const checkpoint = button('Add bookmark');
  checkpoint.setAttribute('aria-label', 'Save a named bookmark at this point in the chat.');
  const importHistory = button('Bring in older messages');
  importHistory.setAttribute(
    'aria-label',
    'Temporarily scroll through this chat to save older messages that are not currently on screen.'
  );
  const qaReport = button('Download test report');
  qaReport.setAttribute(
    'aria-label',
    'Download a private test report with counts and saving status. It does not include your chat text.'
  );
  const stop = button('Stop saving', 'action danger');
  const library = button('Open saved chats', 'action library');
  library.setAttribute('aria-label', 'Open the chats saved on this computer.');
  actions.append(primary, checkpoint, library);

  const moreOptions = document.createElement('details');
  moreOptions.className = 'disclosure';
  const moreOptionsSummary = document.createElement('summary');
  moreOptionsSummary.textContent = 'More options';
  const advancedActions = document.createElement('div');
  advancedActions.className = 'advanced-actions';
  advancedActions.append(importHistory, stop);
  moreOptions.append(moreOptionsSummary, advancedActions);

  const helper = document.createElement('div');
  helper.className = 'helper';
  helper.textContent =
    'Collapsing, moving, or hiding this control does not stop recording. Pause for a private break; Stop keeps recording off until you start it again.';

  const appearance = document.createElement('div');
  appearance.className = 'appearance';
  const appearanceTitle = document.createElement('div');
  appearanceTitle.className = 'appearance-title';
  appearanceTitle.textContent = 'Appearance';
  const appearanceHelp = document.createElement('div');
  appearanceHelp.className = 'appearance-help';
  appearanceHelp.textContent = 'Auto follows your computer, or choose a fixed theme.';
  const themeButtons = document.createElement('div');
  themeButtons.className = 'theme-buttons';
  const systemTheme = button('Auto', 'theme-button');
  const lightTheme = button('Light', 'theme-button');
  const darkTheme = button('Dark', 'theme-button');
  themeButtons.append(systemTheme, lightTheme, darkTheme);
  appearance.append(appearanceTitle, appearanceHelp, themeButtons);

  moreOptions.append(appearance);

  const technicalDetails = document.createElement('details');
  technicalDetails.className = 'disclosure';
  const technicalSummary = document.createElement('summary');
  technicalSummary.textContent = 'Troubleshooting';
  const technical = document.createElement('div');
  technical.className = 'technical';
  qaReport.className = 'action qa-action';
  technicalDetails.append(technicalSummary, technical, qaReport);

  panel.append(
    header,
    statusCard,
    storage,
    historyStatus,
    actions,
    helper,
    moreOptions,
    technicalDetails
  );

  const pill = button('', 'pill');
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
  let historyMessage: string | null = null;
  let historyError = false;
  let stopConfirmation: StopConfirmationState = { deadlineMs: null };
  let stopResetTimer: number | null = null;
  let themePreference: ThemePreference = 'system';
  let destroyed = false;
  let dragMoved = false;
  let suppressNextPillClick = false;
  let activeDragCleanup: (() => void) | null = null;

  const media = window.matchMedia('(prefers-color-scheme: dark)');

  const applyTheme = () => {
    wrap.dataset.theme = resolveTheme(themePreference, media.matches);
    systemTheme.classList.toggle('selected', themePreference === 'system');
    lightTheme.classList.toggle('selected', themePreference === 'light');
    darkTheme.classList.toggle('selected', themePreference === 'dark');
    systemTheme.setAttribute('aria-pressed', String(themePreference === 'system'));
    lightTheme.setAttribute('aria-pressed', String(themePreference === 'light'));
    darkTheme.setAttribute('aria-pressed', String(themePreference === 'dark'));
  };

  const statusLabel = (): string => {
    if (state.health === 'error' || state.recordingState === 'error') return 'Needs attention';
    if (state.recordingState === 'paused') return 'Paused';
    if (state.recordingState === 'stopped') return 'Stopped';
    return state.health === 'degraded' ? 'Recording · check' : 'Recording';
  };

  const statusExplanation = (): string => {
    if (state.recordingState === 'paused') {
      return 'Saving is paused. Messages shown while paused will not be stored or added later.';
    }
    if (state.recordingState === 'stopped') {
      return 'Saving is off. Nothing new will be stored until you press “Start saving”.';
    }
    if (state.health === 'error' || state.recordingState === 'error') {
      return 'This recorder cannot safely save right now. Open troubleshooting details below.';
    }
    if (state.health === 'degraded') {
      return 'Saving is still on, but ChatGPT changed something the recorder is watching. Check the details below.';
    }
    return 'New visible ChatGPT messages are being recorded to your local archive.';
  };

  const storageExplanation = (): string => {
    if (state.storageHealth === 'error') {
      return 'Latest save was not confirmed. Keep this tab open and check Troubleshooting.';
    }
    if (state.storageHealth === 'unknown' || !state.lastSavedAt) {
      return 'Waiting for the first confirmed local save.';
    }
    const date = new Date(state.lastSavedAt);
    const saved = Number.isNaN(date.getTime()) ? state.lastSavedAt : date.toLocaleTimeString();
    return `Saved locally at ${saved}.`;
  };

  const resetStopConfirmation = () => {
    stopConfirmation = { deadlineMs: null };
    if (stopResetTimer !== null) {
      window.clearTimeout(stopResetTimer);
      stopResetTimer = null;
    }
  };

  const render = () => {
    if (destroyed) return;
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
    label.textContent = `${statusLabel()} · ${state.turnCount} ${state.turnCount === 1 ? 'turn' : 'turns'}`;
    pill.setAttribute(
      'aria-label',
      `${statusLabel()}. ${state.turnCount} visible ${state.turnCount === 1 ? 'turn' : 'turns'}. Drag to move; click to open.`
    );
    panel.hidden = visibility !== 'expanded';
    pill.setAttribute('aria-expanded', String(visibility === 'expanded'));

    statusCard.replaceChildren();
    const statusStrong = document.createElement('strong');
    statusStrong.textContent = `${statusLabel()} · ${state.turnCount} visible ${state.turnCount === 1 ? 'turn' : 'turns'}`;
    const statusText = document.createElement('span');
    statusText.textContent = statusExplanation();
    statusCard.append(statusStrong, statusText);

    storage.className = `storage${state.storageHealth === 'error' ? ' error' : ''}`;
    storage.replaceChildren();
    const storageStrong = document.createElement('strong');
    storageStrong.textContent = 'Local save';
    const storageText = document.createElement('span');
    storageText.textContent = storageExplanation();
    storage.append(storageStrong, storageText);

    historyStatus.hidden = !historyMessage;
    historyStatus.className = `history-status${historyError ? ' error' : ''}`;
    historyStatus.textContent = historyMessage ?? '';

    if (state.recordingState === 'recording') {
      primary.textContent = 'Pause saving';
      primary.dataset.command = 'pause';
      primary.setAttribute(
        'aria-label',
        'Pause saving. Messages shown while paused will not be stored or added later.'
      );
    } else if (state.recordingState === 'paused') {
      primary.textContent = 'Resume saving';
      primary.dataset.command = 'resume';
      primary.setAttribute('aria-label', 'Resume saving new ChatGPT messages on this computer.');
    } else {
      primary.textContent = 'Start saving';
      primary.dataset.command = 'start';
      primary.setAttribute('aria-label', 'Start saving new ChatGPT messages on this computer.');
    }

    const stopArmed = isStopConfirmationArmed(stopConfirmation, Date.now());
    stop.textContent = stopArmed ? 'Yes, stop saving' : 'Stop saving';
    stop.className = `action danger${stopArmed ? ' confirm' : ''}`;
    stop.setAttribute(
      'aria-label',
      stopArmed
        ? 'Confirm that saving should stay off until you start it again.'
        : 'Prepare to stop saving. You will be asked to confirm.'
    );

    primary.disabled = busy;
    checkpoint.disabled = busy || !options.onCheckpoint;
    importHistory.disabled =
      busy ||
      state.recordingState !== 'recording' ||
      state.health === 'error' ||
      !options.onImportHistory;
    qaReport.disabled = busy || !options.onDownloadLiveQaReport;
    stop.disabled = busy || state.recordingState === 'stopped';
    library.disabled = busy || !options.onOpenLibrary;

    technical.textContent = [
      `Recorder state: ${state.recordingState}`,
      `ChatGPT reader: ${state.health}${state.healthCode ? ` (${state.healthCode})` : ''}`,
      state.healthDetail ? `Details: ${state.healthDetail}` : null,
      `Local save status: ${state.storageHealth}`
    ].filter(Boolean).join('\n');

    applyTheme();
  };

  const runCommand = async (command: RecorderCommand) => {
    if (!options.onCommand || busy) return;
    busy = true;
    render();
    try {
      await options.onCommand(command);
    } catch {
      historyError = true;
      historyMessage = 'That change could not be saved. Please try again.';
    } finally {
      busy = false;
      render();
    }
  };

  const createCheckpoint = async () => {
    if (!options.onCheckpoint || busy) return;
    const name = window.prompt('Name this bookmark. Example: “Good answer about pricing”');
    if (name === null || !name.trim()) return;
    const note = window.prompt('Optional note. Leave this blank if you do not need one.', '');
    if (note === null) return;
    busy = true;
    historyError = false;
    historyMessage = 'Saving your bookmark…';
    render();
    try {
      await options.onCheckpoint(name.trim(), note.trim() || null);
      historyMessage = 'Bookmark saved.';
    } catch {
      historyError = true;
      historyMessage = 'Could not save the bookmark. Please try again.';
    } finally {
      busy = false;
      render();
    }
  };

  const importHistoricalTurns = async () => {
    if (!options.onImportHistory || busy || state.recordingState !== 'recording') return;
    const confirmed = window.confirm(
      'Bring in older messages?\n\nThis page will scroll through the chat for a moment so older messages can be saved. When it finishes, you will be returned to about the same place. Nothing is sent anywhere.'
    );
    if (!confirmed) return;

    busy = true;
    historyError = false;
    historyMessage = 'Bringing in older messages… ChatGPT may scroll for a moment.';
    render();
    try {
      const result = await options.onImportHistory();
      if (result.truncated) {
        historyMessage = `Saved ${result.uniqueTurnsSeen} messages before reaching the safety limit. You can run this again if needed.`;
      } else if (result.complete) {
        historyMessage = `Done. Found ${result.uniqueTurnsSeen} unique messages while checking ${result.windowsScanned} screen positions.`;
      } else {
        historyMessage = `Finished with ${result.uniqueTurnsSeen} unique messages. Some older history may still be unavailable.`;
      }
    } catch (error) {
      historyError = true;
      historyMessage = `Could not bring in older messages: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      busy = false;
      render();
    }
  };

  const downloadQaReport = async () => {
    if (!options.onDownloadLiveQaReport || busy) return;
    busy = true;
    historyError = false;
    historyMessage = 'Making a private test report…';
    render();
    try {
      await options.onDownloadLiveQaReport();
      historyMessage = 'Test report downloaded. It contains counts and saving status, not your chat text.';
    } catch (error) {
      historyError = true;
      historyMessage = `Could not make the test report: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      busy = false;
      render();
    }
  };

  const openLibrary = async () => {
    if (!options.onOpenLibrary || busy) return;
    busy = true;
    render();
    try {
      await options.onOpenLibrary();
    } catch {
      historyError = true;
      historyMessage = 'Could not open your saved chats. Please try again.';
    } finally {
      busy = false;
      render();
    }
  };

  const setTheme = async (next: ThemePreference) => {
    themePreference = next;
    applyTheme();
    try {
      await writeThemePreference(next);
    } catch {
      historyError = true;
      historyMessage = 'Your appearance choice could not be saved. It will reset next time.';
      render();
    }
  };

  const applyPosition = (position: RecorderPosition) => {
    host.style.right = 'auto';
    host.style.bottom = 'auto';
    host.style.left = `${position.x}px`;
    host.style.top = `${position.y}px`;
  };

  const clampCurrentPosition = (): RecorderPosition | null => {
    if (!host.style.left || !host.style.top || host.style.display === 'none') return null;
    const rect = host.getBoundingClientRect();
    const current = {
      x: Number.parseFloat(host.style.left),
      y: Number.parseFloat(host.style.top)
    };
    if (!Number.isFinite(current.x) || !Number.isFinite(current.y)) return null;
    const clamped = clampRecorderPosition(
      current,
      rect.width,
      rect.height,
      window.innerWidth,
      window.innerHeight
    );
    applyPosition(clamped);
    return clamped;
  };

  const beginDrag = (event: PointerEvent, source: HTMLElement) => {
    if (event.button !== 0 || visibility === 'hidden') return;
    activeDragCleanup?.();
    dragMoved = false;
    const startPointer = { x: event.clientX, y: event.clientY };
    const rect = host.getBoundingClientRect();
    const startHost = { x: rect.left, y: rect.top };
    source.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startPointer.x;
      const dy = moveEvent.clientY - startPointer.y;
      if (!dragMoved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      dragMoved = true;
      const hostRect = host.getBoundingClientRect();
      const next = clampRecorderPosition(
        { x: startHost.x + dx, y: startHost.y + dy },
        hostRect.width,
        hostRect.height,
        window.innerWidth,
        window.innerHeight
      );
      applyPosition(next);
      moveEvent.preventDefault();
    };

    const finish = (finishEvent: PointerEvent) => {
      source.removeEventListener('pointermove', move);
      source.removeEventListener('pointerup', finish);
      source.removeEventListener('pointercancel', finish);
      if (source.hasPointerCapture(finishEvent.pointerId)) {
        source.releasePointerCapture(finishEvent.pointerId);
      }
      if (dragMoved) {
        suppressNextPillClick = source === pill;
        const position = clampCurrentPosition();
        if (position) void writeRecorderPosition(position);
      }
      activeDragCleanup = null;
    };

    source.addEventListener('pointermove', move);
    source.addEventListener('pointerup', finish);
    source.addEventListener('pointercancel', finish);
    activeDragCleanup = () => {
      source.removeEventListener('pointermove', move);
      source.removeEventListener('pointerup', finish);
      source.removeEventListener('pointercancel', finish);
    };
  };

  pill.addEventListener('pointerdown', (event) => beginDrag(event, pill));
  dragHandle.addEventListener('pointerdown', (event) => beginDrag(event, dragHandle));

  pill.addEventListener('click', () => {
    if (suppressNextPillClick) {
      suppressNextPillClick = false;
      return;
    }
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

  checkpoint.addEventListener('click', () => void createCheckpoint());
  importHistory.addEventListener('click', () => void importHistoricalTurns());
  qaReport.addEventListener('click', () => void downloadQaReport());
  library.addEventListener('click', () => void openLibrary());

  stop.addEventListener('click', () => {
    if (busy || state.recordingState === 'stopped') return;
    const result = advanceStopConfirmation(stopConfirmation, Date.now(), STOP_CONFIRMATION_MS);
    stopConfirmation = result.state;
    if (result.confirmed) {
      void runCommand('stop');
      return;
    }
    historyError = false;
    historyMessage = 'Press “Yes, stop saving” within 5 seconds. Saving stays on until you confirm.';
    if (stopResetTimer !== null) window.clearTimeout(stopResetTimer);
    stopResetTimer = window.setTimeout(() => {
      resetStopConfirmation();
      historyMessage = null;
      render();
    }, STOP_CONFIRMATION_MS);
    render();
  });

  systemTheme.addEventListener('click', () => void setTheme('system'));
  lightTheme.addEventListener('click', () => void setTheme('light'));
  darkTheme.addEventListener('click', () => void setTheme('dark'));

  const onMediaChange = () => {
    if (themePreference === 'system') applyTheme();
  };
  media.addEventListener('change', onMediaChange);

  const onStorageChange = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ) => {
    if (areaName !== 'local') return;
    const changed = changes[THEME_STORAGE_KEY];
    if (!changed) return;
    themePreference = normalizeThemePreference(changed.newValue);
    applyTheme();
  };
  chrome.storage.onChanged.addListener(onStorageChange);

  const onResize = () => {
    const position = clampCurrentPosition();
    if (position) void writeRecorderPosition(position);
  };
  window.addEventListener('resize', onResize);

  void readThemePreference().then((preference) => {
    if (destroyed) return;
    themePreference = preference;
    applyTheme();
  });

  void readRecorderPosition().then((position) => {
    if (destroyed || !position) return;
    window.requestAnimationFrame(() => {
      if (destroyed) return;
      const rect = host.getBoundingClientRect();
      applyPosition(
        clampRecorderPosition(
          position,
          rect.width,
          rect.height,
          window.innerWidth,
          window.innerHeight
        )
      );
    });
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
      window.requestAnimationFrame(() => clampCurrentPosition());
    },
    hide() {
      visibility = transitionRecorderVisibility(visibility, 'hide');
      render();
    },
    destroy() {
      destroyed = true;
      activeDragCleanup?.();
      resetStopConfirmation();
      media.removeEventListener('change', onMediaChange);
      chrome.storage.onChanged.removeListener(onStorageChange);
      window.removeEventListener('resize', onResize);
      host.remove();
    }
  };
}
