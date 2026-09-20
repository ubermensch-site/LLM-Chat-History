export {};

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing premium Library shell element: #${id}`);
  return node as T;
}

const openButton = element<HTMLButtonElement>('settings-open');
const closeButton = element<HTMLButtonElement>('settings-close');
const drawer = element<HTMLElement>('settings-drawer');
const scrim = element<HTMLButtonElement>('settings-scrim');

const focusableSelector = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

let open = false;

function focusableElements(): HTMLElement[] {
  return [...drawer.querySelectorAll<HTMLElement>(focusableSelector)].filter(
    (node) => node.getClientRects().length > 0
  );
}

function setOpen(next: boolean, restoreFocus = false): void {
  open = next;
  drawer.classList.toggle('is-open', open);
  scrim.classList.toggle('is-visible', open);
  drawer.setAttribute('aria-hidden', String(!open));
  openButton.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('settings-open', open);

  if (open) {
    window.requestAnimationFrame(() => closeButton.focus());
  } else if (restoreFocus) {
    openButton.focus();
  }
}

openButton.addEventListener('click', () => setOpen(!open));
closeButton.addEventListener('click', () => setOpen(false, true));
scrim.addEventListener('click', () => setOpen(false, true));

const onKeydown = (event: KeyboardEvent) => {
  if (!open) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    setOpen(false, true);
    return;
  }

  if (event.key !== 'Tab') return;
  const focusable = focusableElements();
  if (!focusable.length) {
    event.preventDefault();
    closeButton.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;

  if (event.shiftKey && active === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first?.focus();
  }
};

window.addEventListener('keydown', onKeydown, true);

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (!target.closest('.action-menu-panel')) return;
  const menu = target.closest<HTMLDetailsElement>('details.action-menu');
  if (menu && target instanceof HTMLButtonElement && !target.disabled) {
    window.setTimeout(() => {
      menu.open = false;
    }, 0);
  }
});

window.addEventListener(
  'pagehide',
  () => {
    window.removeEventListener('keydown', onKeydown, true);
  },
  { once: true }
);
