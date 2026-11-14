const STORAGE_KEY = 'taskflow-theme';

export function getInitialTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'dark' ? 'dark' : 'light';
  } catch { return 'light'; }
}

export function applyTheme(theme) {
  const normalized = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = normalized;
  try { localStorage.setItem(STORAGE_KEY, normalized); } catch { /* storage may be unavailable */ }
  return normalized;
}
