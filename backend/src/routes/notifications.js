// The signed-in user's notifications (header bell).
import { Router } from 'express';
import { db, nowIso } from '../db.js';
import { presentNotification } from '../notifications.js';

const router = Router();

function unreadCount(userId) {
  return db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE recipient_id = ? AND is_read = 0').get(userId).count;
}

// GET /api/notifications?filter=unread&limit=30&offset=0
router.get('/', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  const params = [req.user.id];
  let where = 'recipient_id = ?';
  if (req.query.filter === 'unread') where += ' AND is_read = 0';
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const rows = db.prepare(`SELECT * FROM notifications WHERE ${where} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`).all(...params, limit + 1, offset);
  res.json({ items: rows.slice(0, limit).map(presentNotification), hasMore: rows.length > limit, unreadCount: unreadCount(req.user.id) });
});

router.get('/unread-count', (req, res) => res.json({ unreadCount: unreadCount(req.user.id) }));

router.post('/read-all', (req, res) => {
  const result = db.prepare('UPDATE notifications SET is_read = 1, read_at = ? WHERE recipient_id = ? AND is_read = 0').run(nowIso(), req.user.id);
  res.json({ updated: result.changes, unreadCount: 0 });
});

// PATCH /api/notifications/:id { isRead } (default true)
router.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM notifications WHERE id = ? AND recipient_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Notification not found.' });
  const isRead = req.body?.isRead !== false;
  db.prepare('UPDATE notifications SET is_read = ?, read_at = ? WHERE id = ?').run(isRead ? 1 : 0, isRead ? nowIso() : null, row.id);
  res.json({ notification: presentNotification(db.prepare('SELECT * FROM notifications WHERE id = ?').get(row.id)), unreadCount: unreadCount(req.user.id) });
});

export default router;
