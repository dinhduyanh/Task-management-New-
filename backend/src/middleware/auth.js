import { db } from '../db.js';
import { createHash } from 'node:crypto';

function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

export function requireAuth(req, res, next) {
  const token = readCookie(req.headers.cookie, 'taskflow_session');
  if (!token) return res.status(401).json({ error: 'Authentication required.' });

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const session = db.prepare(`
    SELECT s.user_id, u.username, u.email, u.full_name, u.avatar_url, u.is_active
    FROM auth_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(tokenHash, new Date().toISOString());

  if (!session || !session.is_active) {
    return res.status(401).json({ error: 'Session expired or invalid.' });
  }

  req.user = {
    id: session.user_id,
    username: session.username,
    email: session.email,
    fullName: session.full_name,
    avatarUrl: session.avatar_url
  };
  next();
}
