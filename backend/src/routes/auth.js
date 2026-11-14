import { Router } from 'express';
import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { db, nowIso } from '../db.js';

const router = Router();
const scrypt = promisify(scryptCallback);
const COOKIE_NAME = 'taskflow_session';
const SESSION_DAYS = 7;

async function verifyPassword(password, stored) {
  if (!stored) return false;
  // Stored format: scrypt$<salt hex>$<hash hex>
  const [algorithm, salt, expectedHex] = String(stored).split('$');
  if (algorithm !== 'scrypt' || !salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = await scrypt(password, Buffer.from(salt, 'hex'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`);
}

router.post('/login', async (req, res, next) => {
  try {
    const identity = String(req.body?.username || req.body?.email || '').trim();
    const password = String(req.body?.password || '');
    if (!identity || !password) return res.status(400).json({ error: 'Username/Email and password are required.' });

    const user = db.prepare(`SELECT id, username, email, full_name, password_hash, avatar_url, is_active
      FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?) LIMIT 1`).get(identity, identity);
    if (!user || !user.is_active || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Username/Email or password is incorrect.' });
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const now = new Date();
    const expires = new Date(now.getTime() + SESSION_DAYS * 86400000).toISOString();
    db.prepare('INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(tokenHash, user.id, now.toISOString(), expires);
    setSessionCookie(res, token);

    res.json({ user: {
      id: user.id, username: user.username, email: user.email,
      fullName: user.full_name, avatarUrl: user.avatar_url
    }});
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
