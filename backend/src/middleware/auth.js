import { db } from '../db.js';
import { createHash } from 'node:crypto';

function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

/**
 * The signed-in user for this request, read fresh from the database on every request so a
 * deactivated account or a changed role takes effect immediately.
 */
function sessionUser(req) {
  const token = readCookie(req.headers.cookie, 'taskflow_session');
  if (!token) return null;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const session = db.prepare(`
    SELECT s.user_id, u.username, u.email, u.full_name, u.avatar_url, u.is_active, u.role
    FROM auth_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(tokenHash, new Date().toISOString());
  if (!session || !session.is_active) return null;
  return {
    id: session.user_id,
    username: session.username,
    email: session.email,
    fullName: session.full_name,
    avatarUrl: session.avatar_url,
    role: session.role === 'admin' ? 'admin' : 'user'
  };
}

/** Sets req.user when a valid session cookie is present; never rejects the request. */
export function optionalAuth(req, _res, next) {
  req.user = sessionUser(req);
  next();
}

export function requireAuth(req, res, next) {
  const user = sessionUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required.' });
  req.user = user;
  next();
}

/** Use after requireAuth. System settings and other admin-only APIs. */
export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Administrator access required.' });
  next();
}
