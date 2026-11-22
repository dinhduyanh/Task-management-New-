// Log work: time spent on a work item, for one day or a From..To range (one row per day).
// The rules (range of at most 31 days, 0 < duration <= 12h per day, at most 12h per
// person and day across all work items) come from shared/worklog.js and are checked
// here again inside a transaction, whatever the client sent.
import { Router } from 'express';
import { db, createId, nowIso, logActivity } from '../db.js';
import { requireSpaceAccess, spaceIdOf } from '../access.js';
import { allowed } from '../workItemPermissions.js';
import { denied, memberContext } from '../projectPermissions.js';
import { MAX_MINUTES_PER_DAY, effectiveTo, formatDay, formatDuration, parseDay, todayIn, validateWorkLog } from '../../../shared/worklog.js';

const router = Router();
const itemAccess = requireSpaceAccess((req) => spaceIdOf.workItem(req.params.id), 'Work item not found.');

function present(row, req) {
  const user = row.user_id ? db.prepare('SELECT id, full_name, email, avatar_url FROM users WHERE id = ?').get(row.user_id) : null;
  const own = String(row.user_id) === String(req.user.id);
  return {
    id: row.id,
    workItemId: row.work_item_id,
    workDate: row.work_date,
    minutes: row.minutes,
    description: row.description,
    batchId: row.batch_id,
    user: user ? { id: user.id, fullName: user.full_name, name: user.full_name, email: user.email, avatarUrl: user.avatar_url || '' } : { id: row.user_id, fullName: row.user_name, name: row.user_name },
    createdAt: row.created_at,
    permissions: { delete: mayDelete(req, row, own) }
  };
}

function mayDelete(req, row, own = String(row.user_id) === String(req.user.id)) {
  if (own) return allowed(req, row.space_id, 'task.worklog', { assignee_id: null, creator_id: null, ...db.prepare('SELECT assignee_id, creator_id FROM work_items WHERE id = ?').get(row.work_item_id) });
  return memberContext(req.user, row.space_id).isProjectAdmin;
}

function listFor(req, workItemId) {
  const rows = db.prepare('SELECT * FROM work_logs WHERE work_item_id = ? ORDER BY work_date DESC, created_at DESC').all(workItemId);
  return {
    entries: rows.map((row) => present(row, req)),
    totalMinutes: rows.reduce((sum, row) => sum + row.minutes, 0)
  };
}

/** Minutes the user already logged per day in from..to (all work items). */
function dailyTotals(userId, from, to) {
  return Object.fromEntries(db.prepare(`SELECT work_date, SUM(minutes) AS minutes FROM work_logs
    WHERE user_id = ? AND work_date BETWEEN ? AND ? GROUP BY work_date`).all(userId, from, to).map((row) => [row.work_date, row.minutes]));
}

router.get('/work-items/:id/worklogs', itemAccess, (req, res) => {
  res.json(listFor(req, req.params.id));
});

// POST { fromDate, toDate?, hours, minutes, description, timezoneOffset }
// No toDate = the fromDate day only. Days must be within one month up to the user's today.
router.post('/work-items/:id/worklogs', itemAccess, (req, res, next) => {
  try {
    const item = db.prepare('SELECT * FROM work_items WHERE id = ?').get(req.params.id);
    if (!allowed(req, item.space_id, 'task.worklog', item)) return denied(res, 'task.worklog');
    const body = req.body || {};
    const input = {
      fromDate: String(body.fromDate || ''),
      toDate: effectiveTo(String(body.fromDate || ''), String(body.toDate || '')),
      hours: body.hours ?? '',
      minutes: body.minutes ?? '',
      description: String(body.description ?? '')
    };
    const name = req.user.fullName || req.user.username;
    const created = db.transaction(() => {
      // Read the day totals inside the transaction, so two saves cannot both pass.
      const existing = parseDay(input.fromDate) !== null && parseDay(input.toDate) !== null ? dailyTotals(req.user.id, input.fromDate, input.toDate) : {};
      const offset = Number(body.timezoneOffset);
      const today = todayIn(Number.isFinite(offset) && Math.abs(offset) <= 14 * 60 ? offset : 0);
      const check = validateWorkLog(input, existing, today);
      if (!check.ok) return { errors: check.errors };
      const batch = check.dates.length > 1 ? createId('wlb') : null;
      const now = nowIso();
      const insert = db.prepare(`INSERT INTO work_logs (id, work_item_id, space_id, user_id, user_name, work_date, minutes, description, batch_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      check.dates.forEach((date) => insert.run(createId('wl'), item.id, item.space_id, req.user.id, name, date, check.minutesPerDay, input.description.trim(), batch, now, now));
      const when = check.dates.length > 1 ? `${formatDay(check.dates[0])} - ${formatDay(check.dates[check.dates.length - 1])} (${check.dates.length} days)` : formatDay(check.dates[0]);
      logActivity({ spaceId: item.space_id, workItemId: item.id, actorName: name, description: `logged ${formatDuration(check.minutesPerDay)}${check.dates.length > 1 ? '/day' : ''} on ${item.issue_key} for ${when}` });
      return { days: check.dates.length, minutesPerDay: check.minutesPerDay };
    })();
    if (created.errors) {
      const message = created.errors.range || created.errors.duration || created.errors.daily || created.errors.description;
      return res.status(400).json({ error: message, errors: created.errors });
    }
    res.status(201).json({ ...listFor(req, item.id), created });
  } catch (error) { next(error); }
});

router.delete('/worklogs/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM work_logs WHERE id = ?').get(req.params.id);
  if (!row || !requireAccess(req, row.space_id)) return res.status(404).json({ error: 'Work log not found.' });
  if (!mayDelete(req, row)) return res.status(403).json({ error: 'You can only delete your own work log.' });
  db.prepare('DELETE FROM work_logs WHERE id = ?').run(row.id);
  res.json(listFor(req, row.work_item_id));
});

function requireAccess(req, spaceId) {
  const context = memberContext(req.user, spaceId);
  return context.exists && context.isMember;
}

// The user's logged minutes per day, for the 12h check while filling the form.
// GET /worklogs/daily-totals?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/worklogs/daily-totals', (req, res) => {
  const from = String(req.query.from || '');
  const to = String(req.query.to || from);
  if (parseDay(from) === null || parseDay(to) === null || parseDay(to) < parseDay(from)) return res.status(400).json({ error: 'Invalid date range.' });
  res.json({ totals: dailyTotals(req.user.id, from, to), limitMinutes: MAX_MINUTES_PER_DAY });
});

export default router;
