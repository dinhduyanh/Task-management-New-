import { Router } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import process from 'node:process';
import { db, createId, nowIso } from '../db.js';
import { PASSWORD_RULE, PASSWORD_RULE_MESSAGE, hashPassword, verifyPassword } from '../passwords.js';
import {
  authorizationUrl, exchangeCodeForProfile, googleConfig, googleEnabled, randomToken, sha256
} from '../googleAuth.js';

const router = Router();
const COOKIE_NAME = 'taskflow_session';
const SESSION_DAYS = 7;

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.append('Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`);
}

const USERNAME_RE = /^[A-Za-z0-9._-]{3,40}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OAUTH_COOKIE = 'taskflow_oauth';
const OAUTH_MINUTES = 10;
const USER_SELECT = 'SELECT id, username, email, full_name, avatar_url, is_active, role, google_sub FROM users';

/** New accounts (email sign-up and first-time Google sign-in) are allowed unless ALLOW_SIGNUP=false. */
const signupAllowed = () => String(process.env.ALLOW_SIGNUP ?? 'true').toLowerCase() !== 'false';

function publicUser(user) {
  return {
    id: user.id, username: user.username, email: user.email,
    fullName: user.full_name, avatarUrl: user.avatar_url,
    role: user.role === 'admin' ? 'admin' : 'user'
  };
}

/** Creates a session for the user and sets the HttpOnly session cookie. */
function startSession(res, userId) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400000).toISOString();
  db.prepare('INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(tokenHash, userId, now.toISOString(), expires);
  setSessionCookie(res, token);
}

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

/** A free username based on an email address ("anh.nguyen", "anh.nguyen2", ...). */
function uniqueUsername(email) {
  let base = String(email).split('@')[0].replace(/[^A-Za-z0-9._-]+/g, '.').replace(/^[._-]+|[._-]+$/g, '').slice(0, 34);
  if (base.length < 3) base = `${base || 'user'}${'user'.slice(0, 3 - base.length)}`.slice(0, 34);
  const taken = (name) => db.prepare('SELECT 1 FROM users WHERE lower(username) = lower(?)').get(name);
  if (!taken(base)) return base;
  for (let n = 2; n < 10000; n += 1) if (!taken(`${base}${n}`)) return `${base}${n}`;
  return `${base}${randomToken(3)}`;
}

/** Which sign-in methods the server offers (the sign-in page reads this). */
router.get('/providers', (_req, res) => {
  res.json({ password: true, google: googleEnabled(), signup: signupAllowed() });
});

/** Email sign-up: creates a regular user (role "user") and signs them in. */
router.post('/register', async (req, res, next) => {
  try {
    if (!signupAllowed()) return res.status(403).json({ error: 'Sign-up is turned off. Ask an administrator for an account.' });
    const body = req.body || {};
    const fullName = String(body.fullName || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const username = String(body.username || '').trim() || uniqueUsername(email);
    if (!fullName) return res.status(400).json({ error: 'Full name is required.' });
    if (fullName.length > 120) return res.status(400).json({ error: 'Full name must be 120 characters or fewer.' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'Username must be 3-40 letters, numbers, ".", "_" or "-".' });
    if (!PASSWORD_RULE.test(password)) return res.status(400).json({ error: PASSWORD_RULE_MESSAGE });
    if (db.prepare('SELECT 1 FROM users WHERE lower(email) = ?').get(email)) {
      return res.status(409).json({ error: 'An account with this email already exists. Sign in instead, or continue with Google.' });
    }
    if (db.prepare('SELECT 1 FROM users WHERE lower(username) = lower(?)').get(username)) {
      return res.status(409).json({ error: 'This username is already taken.' });
    }
    const id = createId('user');
    const now = nowIso();
    const passwordHash = await hashPassword(password);
    db.prepare(`INSERT INTO users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'user', 1, ?, ?)`).run(id, username, email, fullName, passwordHash, now, now);
    startSession(res, id);
    res.status(201).json({ user: publicUser(db.prepare(`${USER_SELECT} WHERE id = ?`).get(id)) });
  } catch (error) { next(error); }
});

// ---- Google sign-in -------------------------------------------------------------------
function backToApp(res, config, params) {
  res.redirect(302, `${config.appUrl}/?${new URLSearchParams(params)}`);
}

function setOauthCookie(res, value, maxAge) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  // Lax: sent on the top-level redirect back from Google, never on cross-site sub-requests.
  res.append('Set-Cookie', `${OAUTH_COOKIE}=${encodeURIComponent(value)}; HttpOnly; Path=/api/auth/google; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

/** Step 1: send the browser to Google's account chooser. */
router.get('/google/start', (_req, res) => {
  const config = googleConfig();
  if (!googleEnabled(config)) return backToApp(res, config, { auth_error: 'google_not_configured' });
  const state = randomToken();
  const codeVerifier = randomToken(48);
  const nonce = randomToken();
  const now = new Date();
  db.prepare('DELETE FROM oauth_states WHERE expires_at < ?').run(now.toISOString());
  db.prepare('INSERT INTO oauth_states (state_hash, provider, code_verifier, nonce, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sha256(state), 'google', codeVerifier, nonce, now.toISOString(), new Date(now.getTime() + OAUTH_MINUTES * 60000).toISOString());
  // The same state must come back in this browser's cookie, so a sign-in link started
  // elsewhere cannot log this browser into someone else's account.
  setOauthCookie(res, state, OAUTH_MINUTES * 60);
  res.redirect(302, authorizationUrl(config, { state, codeVerifier, nonce }));
});

/** Finds the user for a Google profile: by Google id, else links by verified email, else creates one. */
function userForGoogleProfile(profile) {
  const bySub = db.prepare(`${USER_SELECT} WHERE google_sub = ?`).get(profile.sub);
  if (bySub) {
    if (!bySub.avatar_url && profile.picture) db.prepare('UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?').run(profile.picture, nowIso(), bySub.id);
    return { user: db.prepare(`${USER_SELECT} WHERE id = ?`).get(bySub.id) };
  }
  const byEmail = db.prepare(`${USER_SELECT} WHERE lower(email) = ?`).get(profile.email);
  if (byEmail) {
    if (byEmail.google_sub && byEmail.google_sub !== profile.sub) return { error: 'google_account_mismatch' };
    db.prepare('UPDATE users SET google_sub = ?, avatar_url = COALESCE(avatar_url, ?), updated_at = ? WHERE id = ?')
      .run(profile.sub, profile.picture, nowIso(), byEmail.id);
    return { user: db.prepare(`${USER_SELECT} WHERE id = ?`).get(byEmail.id), linked: true };
  }
  if (!signupAllowed()) return { error: 'signup_disabled' };
  const id = createId('user');
  const now = nowIso();
  const fullName = (profile.name || profile.email.split('@')[0]).slice(0, 120);
  db.prepare(`INSERT INTO users (id, username, email, full_name, password_hash, avatar_url, role, is_active, google_sub, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, ?, 'user', 1, ?, ?, ?)`).run(id, uniqueUsername(profile.email), profile.email, fullName, profile.picture, profile.sub, now, now);
  return { user: db.prepare(`${USER_SELECT} WHERE id = ?`).get(id), created: true };
}

/** Step 2: Google sends the browser back here with a one-time code. */
router.get('/google/callback', async (req, res) => {
  const config = googleConfig();
  const state = String(req.query.state || '');
  const cookieState = readCookie(req, OAUTH_COOKIE);
  setOauthCookie(res, '', 0);
  const attempt = state ? db.prepare('SELECT * FROM oauth_states WHERE state_hash = ?').get(sha256(state)) : null;
  if (attempt) db.prepare('DELETE FROM oauth_states WHERE state_hash = ?').run(attempt.state_hash); // single use

  if (req.query.error) return backToApp(res, config, { auth_error: req.query.error === 'access_denied' ? 'google_cancelled' : 'google_failed' });
  if (!googleEnabled(config)) return backToApp(res, config, { auth_error: 'google_not_configured' });
  if (!attempt || !cookieState || cookieState !== state || attempt.expires_at < new Date().toISOString() || !req.query.code) {
    return backToApp(res, config, { auth_error: 'google_state' });
  }
  try {
    const profile = await exchangeCodeForProfile(config, { code: String(req.query.code), codeVerifier: attempt.code_verifier, nonce: attempt.nonce });
    const { user, error, created } = userForGoogleProfile(profile);
    if (error) return backToApp(res, config, { auth_error: error });
    if (!user.is_active) return backToApp(res, config, { auth_error: 'account_disabled' });
    startSession(res, user.id);
    backToApp(res, config, { auth: 'google', ...(created ? { new: '1' } : {}) });
  } catch (error) {
    console.warn(`Google sign-in failed: ${error.message}`);
    backToApp(res, config, { auth_error: 'google_failed' });
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const identity = String(req.body?.username || req.body?.email || '').trim();
    const password = String(req.body?.password || '');
    if (!identity || !password) return res.status(400).json({ error: 'Username/Email and password are required.' });

    const user = db.prepare(`SELECT id, username, email, full_name, password_hash, avatar_url, is_active, role
      FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?) LIMIT 1`).get(identity, identity);
    if (!user || !user.is_active || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Username/Email or password is incorrect.' });
    }

    startSession(res, user.id);
    res.json({ user: publicUser(user) });
  } catch (error) { next(error); }
});

router.post('/logout', (req, res) => {
  const cookie = String(req.headers.cookie || '').split(';').map(v => v.trim())
    .find(v => v.startsWith(`${COOKIE_NAME}=`));
  if (cookie) {
    const token = decodeURIComponent(cookie.slice(COOKIE_NAME.length + 1));
    const hash = createHash('sha256').update(token).digest('hex');
    db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(hash);
  }
  clearSessionCookie(res);
  res.json({ success: true });
});

export default router;
