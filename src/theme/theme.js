export const THEME_STORAGE_KEY = 'taskflow.theme';
const LEGACY_STORAGE_KEY = 'taskflow-theme';

export const THEMES = ['light', 'dark'];

function normalize(theme) {
  return theme === 'dark' ? 'dark' : 'light';
}

/** Light is the default; a previously chosen theme is restored from localStorage. */
export function getInitialTheme() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    return normalize(saved);
  } catch {
    return 'light';
  }
}

/** Applies the theme to <html data-theme> (which switches the CSS variables) and persists it. */
export function applyTheme(theme) {
  const normalized = normalize(theme);
  document.documentElement.dataset.theme = normalized;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, normalized);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Storage may be unavailable; the theme still applies for this visit.
  }
  return normalized;
}
