export {};

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
const focusableSelector = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

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
scrim.tabIndex = -1;
scrim.setAttribute('aria-hidden', 'true');
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

function drawerFocusableElements(): HTMLElement[] {
  return [...sidebar.querySelectorAll<HTMLElement>(focusableSelector)].filter(
    (element) => !element.hasAttribute('disabled') && element.getClientRects().length > 0
  );
}

function syncResponsiveAccessibility(): void {
  if (media.matches) {
    sidebar.toggleAttribute('inert', !drawerOpen);
    sidebar.setAttribute('aria-hidden', String(!drawerOpen));
    sidebar.setAttribute('role', 'dialog');
    if (drawerOpen) sidebar.setAttribute('aria-modal', 'true');
    else sidebar.removeAttribute('aria-modal');

    actionBlock.setAttribute('aria-hidden', String(!actionsOpen));
  } else {
    sidebar.removeAttribute('inert');
    sidebar.removeAttribute('aria-hidden');
    sidebar.removeAttribute('role');
    sidebar.removeAttribute('aria-modal');
    actionBlock.removeAttribute('aria-hidden');
  }
}

function setDrawerOpen(open: boolean, restoreFocus = false): void {
  drawerOpen = media.matches && open;
  sidebar.classList.toggle('mobile-open', drawerOpen);
  scrim.classList.toggle('is-visible', drawerOpen);
  document.body.classList.toggle('mobile-library-open', drawerOpen);
  libraryToggle.setAttribute('aria-expanded', String(drawerOpen));
  syncResponsiveAccessibility();

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
  syncResponsiveAccessibility();

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
  if (target.closest('button.conversation')) {
    window.setTimeout(() => setDrawerOpen(false, true), 0);
  } else if (target.closest('button.search-result')) {
    window.setTimeout(() => setDrawerOpen(false), 0);
  }
});

actionBlock.addEventListener('click', (event) => {
  if (!media.matches) return;
  const target = event.target;
  if (target instanceof HTMLButtonElement && !target.disabled) {
    window.setTimeout(() => setActionsOpen(false, true), 0);
  }
});

const onKeydown = (event: KeyboardEvent) => {
  if (!media.matches) return;

  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    setDrawerOpen(true);
    return;
  }

  if (drawerOpen && event.key === 'Tab') {
    const focusable = drawerFocusableElements();
    if (!focusable.length) {
      event.preventDefault();
      searchInput.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !sidebar.contains(active))) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && (active === last || !sidebar.contains(active))) {
      event.preventDefault();
      first?.focus();
    }
    return;
  }

  if (event.key !== 'Escape') return;
  if (event.target === searchInput && searchInput.value) return;
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
    drawerOpen = false;
    actionsOpen = false;
    sidebar.classList.remove('mobile-open');
    scrim.classList.remove('is-visible');
    actionBlock.classList.remove('mobile-open');
    libraryToggle.setAttribute('aria-expanded', 'false');
    actionsToggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('mobile-library-open');
  }
  syncResponsiveAccessibility();
};

syncResponsiveAccessibility();
window.addEventListener('keydown', onKeydown, true);
media.addEventListener('change', onMediaChange);

window.addEventListener(
  'pagehide',
  () => {
    window.removeEventListener('keydown', onKeydown, true);
    media.removeEventListener('change', onMediaChange);
  },
  { once: true }
);
