import { json, request } from './api';

const AUTH_FLAG_KEY = 'taskflow.authenticated';
const USER_KEY = 'taskflow.user';

// Every key that has ever held session data in this app. Signing out removes
// all of them so no stale identity survives a reload.
const SESSION_KEYS = [
  AUTH_FLAG_KEY,
  USER_KEY,
  'taskflow.token',
  'taskflow.session',
  'token',
  'accessToken',
  'refreshToken',
  'authToken',
  'session'
];

function safeStorage(action) {
  try {
    return action();
  } catch {
    // Storage can be unavailable (private mode, blocked site data).
    return null;
  }
}

export function getStoredUser() {
  return safeStorage(() => JSON.parse(localStorage.getItem(USER_KEY) || 'null'));
}

export function storeUser(user) {
  if (!user) return;
  safeStorage(() => localStorage.setItem(USER_KEY, JSON.stringify(user)));
}

export function isAuthenticated() {
  return safeStorage(() => localStorage.getItem(AUTH_FLAG_KEY) === 'true') === true;
}

export function clearSession() {
  safeStorage(() => SESSION_KEYS.forEach((key) => localStorage.removeItem(key)));
  safeStorage(() => sessionStorage.clear());
}

export const authService = {
  async login(usernameOrEmail, password) {
    const payload = await request('/auth/login', json('POST', {
      username: String(usernameOrEmail || '').trim(),
      password
    }));
    const user = payload?.user;
    if (!user || typeof user !== 'object') {
      throw new Error('Login response did not include a valid user.');
    }
    storeUser(user);
    safeStorage(() => localStorage.setItem(AUTH_FLAG_KEY, 'true'));
    return user;
  },

  /**
   * Ends the session on the server (the HttpOnly cookie is cleared there) and
   * always clears the local session, even if the server cannot be reached.
   */
  async logout() {
    try {
      await request('/auth/logout', { method: 'POST' });
    } catch (error) {
      console.warn('Server logout failed; clearing the local session anyway.', error);
    } finally {
      clearSession();
    }
  }
};
