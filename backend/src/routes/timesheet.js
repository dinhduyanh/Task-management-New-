// Timesheet: the logged work (work_logs) of everyone, for a date range, with filters.
// Like Filters, it covers every project of the system (read-only for other people's
// entries: deleting still goes through DELETE /api/worklogs/:id and its checks).
//
// GET /api/timesheet?from=YYYY-MM-DD&to=YYYY-MM-DD
//   &projects=<id,...>&users=<id,...>&teams=<id,...>&types=<Task,...>&statuses=<To Do,...>
// -> { from, to, entries: [{ id, date, minutes, description, own, user, project, workItem }] }
// GET /api/timesheet/meta -> values for the filter dropdowns
import { Router } from 'express';
import { db } from '../db.js';
import { countDays, parseDay } from '../../../shared/worklog.js';

const router = Router();
export const MAX_TIMESHEET_DAYS = 400; // a year of months, plus a margin

const list = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean).slice(0, 200);
const marks = (items) => items.map(() => '?').join(', ');

router.get('/timesheet', (req, res) => {
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  if (parseDay(from) === null || parseDay(to) === null || parseDay(to) < parseDay(from)) return res.status(400).json({ error: 'Choose a valid date range.' });
  if (countDays(from, to) > MAX_TIMESHEET_DAYS) return res.status(400).json({ error: 'The date range can be at most one year.' });

  const where = ['l.work_date BETWEEN ? AND ?'];
  const params = [from, to];
  const projects = list(req.query.projects);
  if (projects.length) { where.push(`l.space_id IN (${marks(projects)})`); params.push(...projects); }
  const users = list(req.query.users).map((id) => (id === 'me' ? req.user.id : id));
  if (users.length) { where.push(`l.user_id IN (${marks(users)})`); params.push(...users); }
  const teams = list(req.query.teams);
  if (teams.length) { where.push(`l.user_id IN (SELECT user_id FROM team_members WHERE team_id IN (${marks(teams)}))`); params.push(...teams); }
  const types = list(req.query.types);
  if (types.length) { where.push(`w.issue_type IN (${marks(types)})`); params.push(...types); }
  const statuses = list(req.query.statuses);
  if (statuses.length) { where.push(`w.status IN (${marks(statuses)})`); params.push(...statuses); }

  const rows = db.prepare(`SELECT l.id, l.work_date, l.minutes, l.description, l.user_id, l.user_name, l.created_at,
      u.full_name, u.email, u.avatar_url,
      s.id AS s_id, s.code AS s_code, s.name AS s_name,
      w.id AS w_id, w.issue_key, w.title, w.issue_type, w.status
    FROM work_logs l
    JOIN work_items w ON w.id = l.work_item_id
    JOIN spaces s ON s.id = l.space_id
    LEFT JOIN users u ON u.id = l.user_id
    WHERE ${where.join(' AND ')}
    ORDER BY l.work_date, l.created_at`).all(...params);

  res.json({
    from,
    to,
    entries: rows.map((row) => ({
      id: row.id,
      date: row.work_date,
      minutes: row.minutes,
      description: row.description,
      own: String(row.user_id) === String(req.user.id),
      createdAt: row.created_at,
      user: { id: row.user_id, fullName: row.full_name || row.user_name, name: row.full_name || row.user_name, email: row.email, avatarUrl: row.avatar_url || '' },
      project: { id: row.s_id, code: row.s_code, name: row.s_name },
      workItem: { id: row.w_id, key: row.issue_key, title: row.title, type: row.issue_type, status: row.status }
    }))
  });
});

router.get('/timesheet/meta', (_req, res) => {
  const projects = db.prepare('SELECT id, code, name FROM spaces ORDER BY name COLLATE NOCASE').all();
  const users = db.prepare('SELECT id, username, email, full_name, avatar_url FROM users WHERE is_active = 1 ORDER BY full_name COLLATE NOCASE').all()
    .map((user) => ({ id: user.id, username: user.username, email: user.email, fullName: user.full_name, name: user.full_name, avatarUrl: user.avatar_url || '' }));
  const teams = db.prepare('SELECT t.id, t.name, s.code AS project FROM teams t JOIN spaces s ON s.id = t.space_id ORDER BY lower(t.name)').all();
  const types = [...new Set(['Epic', 'Feature', 'Story', 'Task', 'Bug', 'Improvement', 'Sub-task', ...db.prepare('SELECT DISTINCT issue_type FROM work_items').all().map((row) => row.issue_type)].filter(Boolean))];
  const statuses = [...new Set([...db.prepare('SELECT DISTINCT name FROM workflow_states ORDER BY position').all().map((row) => row.name), ...db.prepare('SELECT DISTINCT status FROM work_items').all().map((row) => row.status)].filter(Boolean))];
  res.json({ projects, users, teams, types, statuses });
});

export default router;
