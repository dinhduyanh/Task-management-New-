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
  /** Replaces a work item in the app state with the server's copy (e.g. after an upload). */
  replaceWorkItem: () => {}
});

export function useAppShell() {
  return useContext(AppShellContext);
}
