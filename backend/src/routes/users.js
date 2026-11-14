import { Router } from 'express';
import { randomUUID, scrypt as scryptCallback, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { db, nowIso } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const scrypt = promisify(scryptCallback);
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{6,}$/;

function publicUser(row) {
  return {
    id: row.id, username: row.username, email: row.email,
    fullName: row.full_name, avatarUrl: row.avatar_url,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}
async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

router.use(requireAuth);

router.get('/me', (req, res) => {
  const row = db.prepare(`SELECT id, username, email, full_name, avatar_url, created_at, updated_at
    FROM users WHERE id = ?`).get(req.user.id);
  if (!row) return res.status(404).json({ error: 'User not found.' });
  res.json({ user: publicUser(row) });
});

router.patch('/me', (req, res, next) => {
  try {
    const fullName = String(req.body?.fullName || '').trim();
    if (!fullName) return res.status(400).json({ error: 'Full name is required.' });
    if (fullName.length > 120) return res.status(400).json({ error: 'Full name must be 120 characters or fewer.' });
    const now = nowIso();
    db.prepare('UPDATE users SET full_name = ?, updated_at = ? WHERE id = ?').run(fullName, now, req.user.id);
    const row = db.prepare(`SELECT id, username, email, full_name, avatar_url, created_at, updated_at
      FROM users WHERE id = ?`).get(req.user.id);
    res.json({ user: publicUser(row) });
  } catch (error) { next(error); }
});

router.post('/me/avatar', (req, res, next) => {
  try {
    const dataUrl = String(req.body?.dataUrl || '');
    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match || !ALLOWED_MIME.has(match[1])) return res.status(400).json({ error: 'Avatar must be PNG, JPG, WEBP or GIF.' });
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > MAX_AVATAR_BYTES) return res.status(400).json({ error: 'Avatar must not exceed 2MB.' });
    const now = nowIso();
    db.prepare('UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?')
      .run(dataUrl, now, req.user.id);
    res.json({ avatarUrl: dataUrl });
  } catch (error) { next(error); }
});

router.delete('/me/avatar', (req, res) => {
  db.prepare('UPDATE users SET avatar_url = NULL, updated_at = ? WHERE id = ?').run(nowIso(), req.user.id);
  res.json({ avatarUrl: null });
});

router.post('/change-password', async (req, res, next) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password are required.' });
    if (!PASSWORD_RULE.test(newPassword)) {
      return res.status(400).json({ error: 'New password must be at least 6 characters and include uppercase, lowercase, number and special character.' });
    }
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    const { timingSafeEqual } = await import('node:crypto');
    const [algorithm, saltHex, hashHex] = String(user?.password_hash || '').split('$');
    if (algorithm !== 'scrypt' || !saltHex || !hashHex) return res.status(400).json({ error: 'This account has no supported password hash. Ask an administrator to initialize its password.' });
    const oldHash = Buffer.from(hashHex, 'hex');
    const oldAttempt = await scrypt(currentPassword, Buffer.from(saltHex, 'hex'), oldHash.length);
    if (oldAttempt.length !== oldHash.length || !timingSafeEqual(oldAttempt, oldHash)) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(await hashPassword(newPassword), nowIso(), req.user.id);
    // Revoke all sessions; user must sign in again.
    db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(req.user.id);
    res.setHeader('Set-Cookie', 'taskflow_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
    res.json({ success: true, message: 'Password changed. Please sign in again.' });
  } catch (error) { next(error); }
});

export default router;
