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
  signOut: () => {}
});

export function useAppShell() {
  return useContext(AppShellContext);
}
