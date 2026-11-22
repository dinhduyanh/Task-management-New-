// Collapsed / expanded sidebar, remembered in this browser (a per-viewer convenience).
const STORAGE_KEY = 'taskflow.sidebar.collapsed';

export function getInitialSidebarCollapsed() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function applySidebarCollapsed(collapsed) {
  document.documentElement.classList.toggle('tf-sidebar-collapsed', Boolean(collapsed));
  try {
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    // Not remembered (private mode or blocked storage).
  }
}
