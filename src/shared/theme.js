// Shared light/dark theme handling for the hub and every tool.
//
// Theme resolution order:
//   1. explicit choice saved in localStorage ('stlmill-theme' = 'light' | 'dark')
//   2. otherwise the OS preference via prefers-color-scheme (handled in base.css)
//
// An explicit choice is applied as <html data-theme="light|dark">, which
// base.css uses to override the media-query defaults.

const STORAGE_KEY = 'stlmill-theme';
const VALID = new Set(['light', 'dark']);

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return VALID.has(v) ? v : null;
  } catch {
    return null;
  }
}

function writeStored(theme) {
  try {
    if (theme) localStorage.setItem(STORAGE_KEY, theme);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable (private mode, blocked) — theme still applies for this page */
  }
}

function systemTheme() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/** Theme currently in effect ('light' | 'dark'), explicit or inherited. */
export function currentTheme() {
  const attr = document.documentElement.getAttribute('data-theme');
  return VALID.has(attr) ? attr : systemTheme();
}

/** Apply a theme. Pass null to clear the explicit choice and follow the OS. */
export function setTheme(theme) {
  const root = document.documentElement;
  if (VALID.has(theme)) {
    root.setAttribute('data-theme', theme);
  } else {
    root.removeAttribute('data-theme');
    theme = null;
  }
  writeStored(theme);
  document.dispatchEvent(
    new CustomEvent('stlmill:theme', { detail: { theme: currentTheme(), explicit: theme } })
  );
  return currentTheme();
}

/**
 * Read the saved preference and apply it. Call as early as possible
 * (ideally from a module script in <head>) to avoid a flash of the wrong theme.
 */
export function initTheme() {
  const stored = readStored();
  if (stored) document.documentElement.setAttribute('data-theme', stored);
  return currentTheme();
}

/** Flip between light and dark; the result is saved as an explicit choice. */
export function toggleTheme() {
  return setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

/**
 * Wire a button so it toggles the theme and keeps its icon/label in sync.
 * Expects optional children: [data-icon="light"], [data-icon="dark"].
 */
export function bindThemeToggle(button) {
  if (!button) return;
  const sync = () => {
    const t = currentTheme();
    const next = t === 'dark' ? 'light' : 'dark';
    button.setAttribute('aria-label', `Switch to ${next} theme`);
    button.setAttribute('title', `Switch to ${next} theme`);
    button.querySelectorAll('[data-icon]').forEach((el) => {
      el.hidden = el.dataset.icon !== t;
    });
  };
  button.addEventListener('click', () => toggleTheme());
  document.addEventListener('stlmill:theme', sync);
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', sync);
  }
  sync();
}
