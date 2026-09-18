const MOBILE_BREAKPOINT = '(max-width: 760px)';

function element<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing mobile Library element: ${selector}`);
  return node;
}

const sidebar = element<HTMLElement>('.sidebar');
const sidebarHeader = element<HTMLElement>('.sidebar-header');
const searchInput = element<HTMLInputElement>('#search');
const actionBlock = element<HTMLElement>('.action-block');
const heading = element<HTMLElement>('.heading');
const media = window.matchMedia(MOBILE_BREAKPOINT);

if (!sidebar.id) sidebar.id = 'mobile-library-panel';

const appbar = document.createElement('header');
appbar.className = 'mobile-appbar';

const libraryToggle = document.createElement('button');
libraryToggle.type = 'button';
libraryToggle.className = 'mobile-nav-button';
libraryToggle.setAttribute('aria-controls', sidebar.id);
libraryToggle.setAttribute('aria-expanded', 'false');
libraryToggle.setAttribute('aria-label', 'Open saved conversations');
libraryToggle.textContent = 'Chats';

const appbarTitle = document.createElement('div');
appbarTitle.className = 'mobile-appbar-title';
appbarTitle.textContent = 'LLM Chat History';

const appbarStatus = document.createElement('span');
appbarStatus.className = 'mobile-appbar-status';
appbarStatus.textContent = 'Local';

appbar.append(libraryToggle, appbarTitle, appbarStatus);
document.body.prepend(appbar);

const scrim = document.createElement('button');
scrim.type = 'button';
scrim.className = 'mobile-scrim';
scrim.setAttribute('aria-label', 'Close saved conversations');
document.body.append(scrim);

const drawerClose = document.createElement('button');
drawerClose.type = 'button';
drawerClose.className = 'mobile-drawer-close';
drawerClose.setAttribute('aria-label', 'Close saved conversations');
drawerClose.textContent = 'Close';
sidebarHeader.append(drawerClose);

const actionsToggle = document.createElement('button');
actionsToggle.type = 'button';
actionsToggle.className = 'mobile-actions-toggle';
actionsToggle.setAttribute('aria-expanded', 'false');
actionsToggle.setAttribute('aria-controls', 'mobile-conversation-actions');
actionsToggle.textContent = 'Actions';
actionBlock.id = 'mobile-conversation-actions';
heading.after(actionsToggle);

let drawerOpen = false;
let actionsOpen = false;

function setDrawerOpen(open: boolean, restoreFocus = false): void {
  drawerOpen = media.matches && open;
  sidebar.classList.toggle('mobile-open', drawerOpen);
  scrim.classList.toggle('is-visible', drawerOpen);
  document.body.classList.toggle('mobile-library-open', drawerOpen);
  libraryToggle.setAttribute('aria-expanded', String(drawerOpen));

  if (drawerOpen) {
    setActionsOpen(false);
    window.requestAnimationFrame(() => searchInput.focus());
  } else if (restoreFocus && media.matches) {
    libraryToggle.focus();
  }
}

function setActionsOpen(open: boolean, restoreFocus = false): void {
  actionsOpen = media.matches && open;
  actionBlock.classList.toggle('mobile-open', actionsOpen);
  actionsToggle.setAttribute('aria-expanded', String(actionsOpen));

  if (actionsOpen) {
    setDrawerOpen(false);
  } else if (restoreFocus && media.matches) {
    actionsToggle.focus();
  }
}

libraryToggle.addEventListener('click', () => setDrawerOpen(!drawerOpen));
drawerClose.addEventListener('click', () => setDrawerOpen(false, true));
scrim.addEventListener('click', () => setDrawerOpen(false, true));
actionsToggle.addEventListener('click', () => setActionsOpen(!actionsOpen));

sidebar.addEventListener('click', (event) => {
  if (!media.matches) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest('button.conversation, button.search-result')) {
    window.setTimeout(() => setDrawerOpen(false), 0);
  }
});

actionBlock.addEventListener('click', (event) => {
  if (!media.matches) return;
  const target = event.target;
  if (target instanceof HTMLButtonElement && !target.disabled) {
    window.setTimeout(() => setActionsOpen(false), 0);
  }
});

const onKeydown = (event: KeyboardEvent) => {
  if (!media.matches) return;

  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
    setDrawerOpen(true);
    return;
  }

  if (event.key !== 'Escape') return;
  if (drawerOpen) {
    event.preventDefault();
    setDrawerOpen(false, true);
  } else if (actionsOpen) {
    event.preventDefault();
    setActionsOpen(false, true);
  }
};

const onMediaChange = () => {
  if (!media.matches) {
    setDrawerOpen(false);
    setActionsOpen(false);
    document.body.classList.remove('mobile-library-open');
  }
};

window.addEventListener('keydown', onKeydown);
media.addEventListener('change', onMediaChange);

window.addEventListener(
  'pagehide',
  () => {
    window.removeEventListener('keydown', onKeydown);
    media.removeEventListener('change', onMediaChange);
  },
  { once: true }
);
