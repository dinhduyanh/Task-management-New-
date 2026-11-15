import { createContext, useContext } from 'react';

/**
 * Session-wide values the layout (Header / user menu) needs on every page,
 * provided once by App so individual pages don't have to forward them.
 */
export const AppShellContext = createContext({
  user: null,
  theme: 'light',
  setTheme: () => {},
  navigate: () => {},
  signOut: () => {},
  /** System role check for showing admin-only UI; the API enforces it independently. */
  isAdmin: false,
  /** Replaces a work item in the app state with the server's copy (e.g. after an upload). */
  replaceWorkItem: () => {},
  /** Dashboards the user can open, and helpers to keep that list in sync. */
  dashboards: [],
  reloadDashboards: () => {},
  upsertDashboard: () => {},
  removeDashboard: () => {}
});

export function useAppShell() {
  return useContext(AppShellContext);
}
