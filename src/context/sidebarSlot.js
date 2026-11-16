import { createContext } from 'react';

/**
 * The app renders one persistent sidebar. Pages only tell it which item is active through this
 * setter (see <Sidebar> in components/layout/Sidebar.jsx), so the sidebar is never remounted when
 * the page changes: no flicker, no replayed animations, expanded/collapsed groups stay as they were.
 */
export const SidebarSlotContext = createContext(null);
