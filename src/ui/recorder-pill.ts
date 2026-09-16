import type { AdapterHealthState } from '../shared/types';

export interface RecorderPillState {
  health: AdapterHealthState;
  turnCount: number;
  expanded: boolean;
}

const HOST_ID = 'llm-chat-history-recorder-host';

export function mountRecorderPill(): {
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
    .wrap {
      font-family: Roboto, Arial, sans-serif;
      color: #1d1b20;
    }
    button {
      font: inherit;
    }
    .pill {
      border: 0;
      border-radius: 999px;
      min-height: 40px;
      padding: 0 14px;
      background: #e8def8;
      color: #1d192b;
      box-shadow: 0 2px 8px rgba(0,0,0,.18);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      font-weight: 600;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #2e7d32;
    }
    .dot.degraded { background: #b26a00; }
    .dot.error { background: #b3261e; }
    .panel {
      width: 260px;
      margin-bottom: 8px;
      padding: 14px;
      border-radius: 16px;
      background: #fffbfe;
      color: #1d1b20;
      box-shadow: 0 4px 18px rgba(0,0,0,.22);
      border: 1px solid #cac4d0;
    }
    .panel[hidden] { display: none; }
    .title { font-size: 14px; font-weight: 700; margin-bottom: 6px; }
    .meta { font-size: 12px; line-height: 1.45; color: #49454f; }
    .hint { margin-top: 10px; font-size: 11px; line-height: 1.35; color: #625b71; }
  `;

  const wrap = document.createElement('div');
  wrap.className = 'wrap';

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.hidden = true;

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = 'LLM Chat History';

  const meta = document.createElement('div');
  meta.className = 'meta';

  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = 'Foundation build: recorder controls and persistence arrive in the next tasks.';

  panel.append(title, meta, hint);

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

  let state: RecorderPillState = { health: 'healthy', turnCount: 0, expanded: false };

  const render = () => {
    dot.className = `dot ${state.health === 'healthy' ? '' : state.health}`.trim();
    label.textContent = `REC · ${state.turnCount}`;
    panel.hidden = !state.expanded;
    meta.textContent = `Adapter: ${state.health} · Rendered turns: ${state.turnCount}`;
    pill.setAttribute('aria-expanded', String(state.expanded));
  };

  pill.addEventListener('click', () => {
    state = { ...state, expanded: !state.expanded };
    render();
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
