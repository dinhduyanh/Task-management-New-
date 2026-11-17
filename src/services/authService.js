import { API_BASE_URL, json, request } from './api';

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

function startLocalSession(user) {
  if (!user || typeof user !== 'object') {
    throw new Error('Sign-in response did not include a valid user.');
  }
  storeUser(user);
  safeStorage(() => localStorage.setItem(AUTH_FLAG_KEY, 'true'));
  return user;
}

/** Messages for the ?auth_error=... codes the server sends after Google sign-in. */
export const GOOGLE_ERROR_MESSAGES = {
  google_not_configured: 'Google sign-in is not set up on this server yet. Ask your administrator to add a Google OAuth client.',
  google_cancelled: 'Google sign-in was cancelled.',
  google_state: 'That Google sign-in link has expired or was opened in another browser. Please try again.',
  google_failed: 'Google sign-in failed. Please try again.',
  google_account_mismatch: 'This email is already linked to a different Google account.',
  signup_disabled: 'No account uses this Google email, and sign-up is turned off. Ask an administrator to invite you.',
  account_disabled: 'This account has been deactivated. Contact your administrator.'
};

export const authService = {
  /** Which sign-in methods the server offers: { password, google, signup }. */
  async providers() {
    return request('/auth/providers');
  },

  /** Full-page redirect to Google; the server sends the browser back to the app afterwards. */
  googleSignInUrl() {
    return `${API_BASE_URL}/auth/google/start`;
  },

  /** After the redirect back from Google the session cookie is set: load the user. */
  async completeGoogleSignIn() {
    const payload = await request('/users/me');
    return startLocalSession(payload?.user);
  },

  async register({ fullName, email, password }) {
    const payload = await request('/auth/register', json('POST', {
      fullName: String(fullName || '').trim(),
      email: String(email || '').trim(),
      password
    }));
    return startLocalSession(payload?.user);
  },

  async login(usernameOrEmail, password) {
    const payload = await request('/auth/login', json('POST', {
      username: String(usernameOrEmail || '').trim(),
      password
    }));
    return startLocalSession(payload?.user);
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
