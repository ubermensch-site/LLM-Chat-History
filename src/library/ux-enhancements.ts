import { openArchiveDb } from '../storage/db';
import { ArchiveRepository } from '../storage/archive';
import {
  THEME_STORAGE_KEY,
  normalizeThemePreference,
  readThemePreference,
  resolveTheme,
  writeThemePreference,
  type ThemePreference
} from '../ui/theme-preference';

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

const search = byId<HTMLInputElement>('search');
const libraryStatus = byId<HTMLElement>('library-status');
const systemButton = byId<HTMLButtonElement>('theme-system');
const lightButton = byId<HTMLButtonElement>('theme-light');
const darkButton = byId<HTMLButtonElement>('theme-dark');
const media = window.matchMedia('(prefers-color-scheme: dark)');

let themePreference: ThemePreference = 'system';
let destroyed = false;
let annotationScheduled = false;
let databasePromise: Promise<IDBDatabase> | null = null;
let statusClearTimer: ReturnType<typeof setTimeout> | null = null;

function setLibraryStatus(message: string): void {
  if (!libraryStatus) return;
  if (statusClearTimer) clearTimeout(statusClearTimer);
  libraryStatus.textContent = message;
  if (!message) return;
  statusClearTimer = setTimeout(() => {
    statusClearTimer = null;
    if (libraryStatus.textContent === message) libraryStatus.textContent = '';
  }, 2400);
}

function applyTheme(): void {
  document.documentElement.dataset.theme = resolveTheme(themePreference, media.matches);
  const choices: Array<[HTMLButtonElement | null, ThemePreference]> = [
    [systemButton, 'system'],
    [lightButton, 'light'],
    [darkButton, 'dark']
  ];
  for (const [button, value] of choices) {
    if (!button) continue;
    const selected = themePreference === value;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
}

async function chooseTheme(next: ThemePreference): Promise<void> {
  themePreference = next;
  applyTheme();
  try {
    await writeThemePreference(next);
    setLibraryStatus(
      next === 'system'
        ? 'Appearance set to Auto. This page will follow your computer.'
        : `Appearance set to ${next === 'light' ? 'Light' : 'Dark'}.`
    );
  } catch {
    setLibraryStatus('Your appearance choice could not be saved. It may reset next time.');
  }
}

systemButton?.addEventListener('click', () => void chooseTheme('system'));
lightButton?.addEventListener('click', () => void chooseTheme('light'));
darkButton?.addEventListener('click', () => void chooseTheme('dark'));

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

void readThemePreference().then((preference) => {
  if (destroyed) return;
  themePreference = preference;
  applyTheme();
});

window.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
  if (event.key.toLowerCase() !== 'k') return;
  if (!search) return;
  event.preventDefault();
  search.focus();
  search.select();
  setLibraryStatus('Search is ready. Type any word you remember from a saved chat.');
});

search?.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !search.value) return;
  search.value = '';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  setLibraryStatus('Search cleared. Showing your saved chats again.');
});

const COPY_REPLACEMENTS = new Map<string, string>([
  ['Archive', 'Put away'],
  ['Unarchive', 'Bring back'],
  ['Delete', 'Delete this copy'],
  ['Confirm delete', 'Yes, delete this copy'],
  ['Local archive', 'Your saved chats'],
  ['Archived conversations', 'Chats you put away'],
  ['All projects', 'All groups'],
  ['Unsorted', 'Not in a group'],
  ['Computer folder mirror', 'Backup copies on this computer'],
  ['Adapter diagnostics', 'Troubleshooting report'],
  ['Performance & storage', 'Storage & speed check'],
  ['Live QA evidence', 'Test this extension'],
  ['Download diagnostics', 'Download troubleshooting report'],
  ['Run profile', 'Check storage & speed'],
  ['Download profile', 'Download check results'],
  ['Choose another', 'Choose another folder'],
  ['Disconnect', 'Stop folder copies'],
  ['Validate QA report', 'Check a test report'],
  ['Download summary', 'Download safe test summary'],
  [
    'Download provider health metadata only. Chat titles, URLs, prompts, answers, checkpoint notes and message bodies are excluded.',
    'Use this only if something is not saving correctly. The file contains health checks, not your chat messages, chat names, website addresses, bookmarks, or notes.'
  ],
  [
    'Run an on-demand local profile. The report contains counts, byte estimates and timing summaries only—not chat text, titles, URLs, notes or search queries.',
    'Check how much space your saved chats use and how quickly this extension is working. The check stays on this computer and does not include your chat text, chat names, website addresses, notes, or searches.'
  ],
  [
    'Validate a privacy-safe QA report locally. Nothing is uploaded. One report checks structural consistency only; scenario-level PASS still follows the live QA checklist.',
    'Choose a test report downloaded by this extension. It is checked on this computer and is never uploaded. This tells you whether the report looks healthy; it does not replace the full browser test.'
  ],
  [
    'Optional Markdown mirror. Your browser IndexedDB archive remains canonical; mirror failures never stop local capture.',
    'Optional: keep readable copies in a folder you choose. Your chats are still saved in the browser even if folder copying fails or is turned off.'
  ],
  ['No profile has been run in this Library session.', 'No storage & speed check has been run yet.'],
  ['Choose a llm-chat-history-live-qa JSON file.', 'Choose a test report file you downloaded from the recorder.'],
  ['No automatic mirror write has been recorded yet.', 'No folder copy has been made yet.'],
  ['Automatic mirroring is idle until a folder is connected.', 'Folder copies are off until you choose a folder.'],
  ['No computer folder is connected.', 'No backup folder is connected.'],
  ['Connected and write permission is currently granted.', 'Backup folder is connected and ready to receive copies.']
]);

function insideTranscript(node: Node): boolean {
  return node instanceof Element
    ? Boolean(node.closest('#transcript'))
    : Boolean(node.parentElement?.closest('#transcript'));
}

function rewriteCountText(text: string): string {
  return text
    .replace(/\bactive conversations\b/g, 'current chats')
    .replace(/\barchived conversations\b/g, 'put-away chats')
    .replace(/\bconversations\b/g, 'chats');
}

function applyGrandmaProofCopy(root: ParentNode = document): void {
  const selector = [
    'button', 'h1', 'h2', 'h3', 'label', 'option', 'p', '.brand', '.conversation-meta',
    '#count', '.count', '.mirror-health', '.mirror-runtime', '.performance-status', '.qa-evidence-status'
  ].join(', ');
  root.querySelectorAll(selector).forEach((element) => {
    if (insideTranscript(element)) return;
    if (element.matches('button.conversation, button.search-result')) return;
    const current = element.textContent?.trim();
    if (!current) return;
    const replacement = COPY_REPLACEMENTS.get(current) ?? rewriteCountText(current);
    if (replacement !== current) element.textContent = replacement;
  });
}

function selectedConversationId(): string | null {
  const selected = document.querySelector<HTMLButtonElement>('button.conversation.selected');
  return selected?.dataset.conversationId ?? null;
}

async function database(): Promise<IDBDatabase> {
  databasePromise ??= openArchiveDb();
  return databasePromise;
}

async function annotateVisibleModels(): Promise<void> {
  const conversationId = selectedConversationId();
  const cards = [...document.querySelectorAll<HTMLElement>('#transcript .message')];
  if (!conversationId || cards.length === 0) return;

  try {
    const repository = new ArchiveRepository(await database());
    const messages = await repository.listMessages(conversationId);
    cards.forEach((card, index) => {
      const message = messages[index];
      if (!message || message.role !== 'assistant') return;
      const nextText = message.modelLabel
        ? `Model shown by ChatGPT: ${message.modelLabel}`
        : 'Model: ChatGPT did not show a model name for this response.';
      let label = card.querySelector<HTMLElement>('.model-label');
      if (!label) {
        label = document.createElement('div');
        label.className = 'model-label';
        const content = card.querySelector('.content');
        card.insertBefore(label, content ?? null);
      }
      if (label.textContent !== nextText) label.textContent = nextText;
    });
  } catch (error) {
    console.debug('[LLM Chat History] visible model labels unavailable', error);
  }
}

function scheduleEnhancements(): void {
  if (annotationScheduled) return;
  annotationScheduled = true;
  queueMicrotask(() => {
    annotationScheduled = false;
    applyGrandmaProofCopy();
    void annotateVisibleModels();
  });
}

const observer = new MutationObserver(scheduleEnhancements);
observer.observe(document.body, { childList: true, subtree: true, characterData: true });
scheduleEnhancements();

window.addEventListener('pagehide', () => {
  destroyed = true;
  observer.disconnect();
  media.removeEventListener('change', onMediaChange);
  chrome.storage.onChanged.removeListener(onStorageChange);
  if (statusClearTimer) clearTimeout(statusClearTimer);
  void databasePromise?.then((db) => db.close());
}, { once: true });
