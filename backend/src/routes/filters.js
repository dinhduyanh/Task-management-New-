// Filters: search work items with TQL, the values for the filter dropdowns and
// auto-complete, saved filters (CRUD) and natural language -> TQL.
import { Router } from 'express';
import { db, createId, nowIso, parseJson } from '../db.js';
import { isAdmin, spaceFilter } from '../access.js';
import { presentItem } from '../workItemPermissions.js';
import { searchWorkItems } from '../tqlQuery.js';
import { TqlError, configToTql, tqlToConfig, validate } from '../../../shared/tql.js';
import { naturalLanguageToTql } from '../ai/tqlAssistant.js';

const router = Router();

/* ----------------------------------------------------- system defaults */

const OPEN = 'statusCategory NOT IN ("Done", "Closed")';
export const SYSTEM_FILTERS = [
  { id: 'sys-my-open', name: 'My open tasks', description: 'Work assigned to me that is not finished yet.', tql: `assignee = currentUser() AND ${OPEN} ORDER BY updated DESC` },
  { id: 'sys-reported', name: 'Reported by me', description: 'Work items I created.', tql: 'creator = currentUser() ORDER BY created DESC' },
  { id: 'sys-overdue', name: 'Overdue tasks', description: 'Unfinished work whose due date has passed.', tql: `dueDate < startOfDay() AND ${OPEN} ORDER BY dueDate ASC` },
  { id: 'sys-due-week', name: 'Due this week', description: 'Unfinished work due between today and Sunday.', tql: `dueDate >= startOfDay() AND dueDate <= endOfWeek() AND ${OPEN} ORDER BY dueDate ASC` },
  { id: 'sys-done', name: 'Done tasks', description: 'Finished work, most recently updated first.', tql: 'statusCategory = "Done" ORDER BY updated DESC' },
  { id: 'sys-unassigned', name: 'Unassigned open tasks', description: 'Unfinished work that nobody is assigned to.', tql: `assignee IS EMPTY AND ${OPEN} ORDER BY priority DESC` },
  { id: 'sys-recent', name: 'Recently updated', description: 'Work changed in the last 7 days.', tql: 'updated >= -7d ORDER BY updated DESC' }
];

export function ensureSystemFilters() {
  const now = nowIso();
  const upsert = db.prepare(`INSERT INTO saved_filters (id, name, description, tql_query, filter_config_json, owner_id, visibility, is_system_default, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, NULL, 'public', 1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, tql_query = excluded.tql_query,
      filter_config_json = excluded.filter_config_json, position = excluded.position`);
  db.transaction(() => SYSTEM_FILTERS.forEach((filter, index) => {
    const { config } = tqlToConfig(filter.tql);
    upsert.run(filter.id, filter.name, filter.description, filter.tql, config ? JSON.stringify(config) : null, index, now, now);
  }))();
}
ensureSystemFilters();

/* --------------------------------------------------------------- search */

function tzOffsetOf(req) {
  const value = Number(req.body?.timezoneOffset ?? req.query?.timezoneOffset ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function queryError(res, error) {
  return res.status(400).json({ error: error.message, position: { start: error.start, end: error.end } });
}

// POST /api/filters/search { tql | filters, page, pageSize, timezoneOffset }
// `filters` is the Default-mode object; it is turned into TQL first.
router.post('/search', (req, res, next) => {
  try {
    const tql = typeof req.body?.tql === 'string' ? req.body.tql : req.body?.filters ? configToTql(req.body.filters) : '';
    const result = searchWorkItems({ user: req.user, tql, page: req.body?.page, pageSize: req.body?.pageSize, tzOffset: tzOffsetOf(req) });
    res.json({
      tql,
      items: result.rows.map((row) => presentItem(req, row)),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      orderBy: result.orderBy
    });
  } catch (error) {
    if (error instanceof TqlError) return queryError(res, error);
    next(error);
  }
});

// Values for the dropdowns and TQL auto-complete (only from projects the user can open).
router.get('/meta', (req, res) => {
  const access = spaceFilter(req.user, 'id');
  const projects = db.prepare(`SELECT id, code, name, task_key_prefix FROM spaces WHERE ${access.sql} ORDER BY name COLLATE NOCASE`).all(...access.params);
  const itemAccess = spaceFilter(req.user, 'space_id');
  const statuses = [...new Set([
    ...db.prepare('SELECT DISTINCT name FROM workflow_states ORDER BY position').all().map((row) => row.name),
    ...db.prepare(`SELECT DISTINCT status FROM work_items WHERE ${itemAccess.sql}`).all(...itemAccess.params).map((row) => row.status)
  ].filter(Boolean))];
  const types = [...new Set([
    'Epic', 'Feature', 'Story', 'Task', 'Bug', 'Improvement', 'Sub-task',
    ...db.prepare(`SELECT DISTINCT issue_type FROM work_items WHERE ${itemAccess.sql}`).all(...itemAccess.params).map((row) => row.issue_type)
  ].filter(Boolean))];
  const sprints = db.prepare(`SELECT s.id, s.name, s.status, sp.code AS project FROM sprints s JOIN spaces sp ON sp.id = s.space_id WHERE ${spaceFilter(req.user, 's.space_id').sql} ORDER BY sp.code, s.position`)
    .all(...spaceFilter(req.user, 's.space_id').params);
  const labels = new Set();
  db.prepare(`SELECT labels_json FROM work_items WHERE ${itemAccess.sql} AND labels_json <> '[]'`).all(...itemAccess.params)
    .forEach((row) => parseJson(row.labels_json, []).forEach((label) => { const name = typeof label === 'object' ? label?.name : label; if (name) labels.add(String(name)); }));
  const users = db.prepare('SELECT id, username, email, full_name, avatar_url FROM users WHERE is_active = 1 ORDER BY full_name COLLATE NOCASE').all()
    .map((user) => ({ id: user.id, username: user.username, email: user.email, fullName: user.full_name, name: user.full_name, avatarUrl: user.avatar_url || '' }));
  res.json({
    projects: projects.map((project) => ({ id: project.id, code: project.code, name: project.name })),
    statuses,
    statusCategories: ['To Do', 'In Progress', 'Done', 'Closed'],
    types,
    priorities: ['Highest', 'High', 'Medium', 'Low', 'Lowest'],
    sprints,
    labels: [...labels].sort((a, b) => a.localeCompare(b)),
    users
  });
});

// POST /api/filters/ai { text, timezoneOffset } -> { tql, explanation, provider }
router.post('/ai', async (req, res, next) => {
  try {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Describe what you are looking for.' });
    if (text.length > 500) return res.status(400).json({ error: 'Please keep the request under 500 characters.' });
    const access = spaceFilter(req.user, 'id');
    const projects = db.prepare(`SELECT code, name FROM spaces WHERE ${access.sql}`).all(...access.params);
    const statuses = db.prepare('SELECT DISTINCT name FROM workflow_states').all().map((row) => row.name);
    const result = await naturalLanguageToTql(text, { projects, statuses, types: ['Epic', 'Feature', 'Story', 'Task', 'Bug', 'Improvement', 'Sub-task'] });
    res.json(result);
  } catch (error) { next(error); }
});

/* -------------------------------------------------------- saved filters */

function presentFilter(req, row) {
  const owner = row.owner_id ? db.prepare('SELECT id, full_name, email, avatar_url FROM users WHERE id = ?').get(row.owner_id) : null;
  const mine = Boolean(row.owner_id) && String(row.owner_id) === String(req.user.id);
  const manage = !row.is_system_default && (mine || isAdmin(req.user));
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    tql: row.tql_query,
    config: row.filter_config_json ? parseJson(row.filter_config_json, null) : null,
    visibility: row.is_system_default ? 'public' : row.visibility,
    isSystem: Boolean(row.is_system_default),
    isMine: mine,
    owner: owner ? { id: owner.id, fullName: owner.full_name, name: owner.full_name, email: owner.email, avatarUrl: owner.avatar_url || '' } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    permissions: { edit: manage, delete: manage }
  };
}

function visibleFilter(req, id) {
  const row = db.prepare('SELECT * FROM saved_filters WHERE id = ?').get(String(id));
  if (!row) return null;
  if (row.is_system_default || row.visibility === 'public' || String(row.owner_id) === String(req.user.id) || isAdmin(req.user)) return row;
  return null;
}

/** Validates name / description / tql / visibility. Returns { values } or { error, status }. */
function readFilterBody(req, current = null) {
  const body = req.body || {};
  const values = {
    name: body.name !== undefined ? String(body.name).trim() : current?.name,
    description: body.description !== undefined ? String(body.description).trim() : (current?.description ?? ''),
    tql: body.tql !== undefined ? String(body.tql).trim() : current?.tql_query,
    visibility: body.visibility !== undefined ? String(body.visibility) : (current?.visibility || 'private')
  };
  if (!values.name) return { error: 'Give the filter a name.' };
  if (values.name.length > 80) return { error: 'The name can have at most 80 characters.' };
  if (values.description.length > 500) return { error: 'The description can have at most 500 characters.' };
  if (!['private', 'public'].includes(values.visibility)) return { error: 'Visibility must be private or public.' };
  const check = validate(values.tql || '');
  if (!check.ok) return { error: `The query has an error: ${check.error.message}`, position: check.error };
  const duplicate = db.prepare('SELECT id FROM saved_filters WHERE owner_id = ? AND lower(name) = lower(?) AND id <> ?').get(req.user.id, values.name, current?.id || '');
  if (duplicate) return { error: `You already have a filter named "${values.name}".`, status: 409 };
  const { config } = tqlToConfig(values.tql || '');
  values.config = config ? JSON.stringify(config) : null;
  return { values };
}

router.get('/saved', (req, res) => {
  const rows = db.prepare(`SELECT * FROM saved_filters
    WHERE is_system_default = 1 OR owner_id = ? OR visibility = 'public'
    ORDER BY is_system_default DESC, position, (owner_id = ?) DESC, lower(name)`).all(req.user.id, req.user.id);
  res.json(rows.map((row) => presentFilter(req, row)));
});

router.get('/saved/:id', (req, res) => {
  const row = visibleFilter(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'Filter not found.' });
  res.json(presentFilter(req, row));
});

router.post('/saved', (req, res) => {
  const { values, error, status, position } = readFilterBody(req);
  if (error) return res.status(status || 400).json({ error, position });
  const id = createId('filter');
  const now = nowIso();
  db.prepare(`INSERT INTO saved_filters (id, name, description, tql_query, filter_config_json, owner_id, visibility, is_system_default, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
    .run(id, values.name, values.description, values.tql || '', values.config, req.user.id, values.visibility, now, now);
  res.status(201).json(presentFilter(req, db.prepare('SELECT * FROM saved_filters WHERE id = ?').get(id)));
});

router.patch('/saved/:id', (req, res) => {
  const row = visibleFilter(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'Filter not found.' });
  if (!presentFilter(req, row).permissions.edit) {
    return res.status(403).json({ error: row.is_system_default ? 'Default filters cannot be changed. Save a copy instead.' : 'Only the owner can change this filter.' });
  }
  const { values, error, status, position } = readFilterBody(req, row);
  if (error) return res.status(status || 400).json({ error, position });
  db.prepare('UPDATE saved_filters SET name = ?, description = ?, tql_query = ?, filter_config_json = ?, visibility = ?, updated_at = ? WHERE id = ?')
    .run(values.name, values.description, values.tql || '', values.config, values.visibility, nowIso(), row.id);
  res.json(presentFilter(req, db.prepare('SELECT * FROM saved_filters WHERE id = ?').get(row.id)));
});

router.delete('/saved/:id', (req, res) => {
  const row = visibleFilter(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'Filter not found.' });
  if (!presentFilter(req, row).permissions.delete) return res.status(403).json({ error: row.is_system_default ? 'Default filters cannot be deleted.' : 'Only the owner can delete this filter.' });
  db.prepare('DELETE FROM saved_filters WHERE id = ?').run(row.id);
  res.status(204).end();
});

// Copy: a private filter of the current user, named "<name> (copy)", "<name> (copy 2)"...
router.post('/saved/:id/copy', (req, res) => {
  const row = visibleFilter(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'Filter not found.' });
  const base = String(req.body?.name || `${row.name} (copy)`).trim().slice(0, 80);
  let name = base;
  for (let n = 2; db.prepare('SELECT 1 FROM saved_filters WHERE owner_id = ? AND lower(name) = lower(?)').get(req.user.id, name); n += 1) name = `${base.slice(0, 72)} ${n}`;
  const id = createId('filter');
  const now = nowIso();
  db.prepare(`INSERT INTO saved_filters (id, name, description, tql_query, filter_config_json, owner_id, visibility, is_system_default, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'private', 0, ?, ?)`)
    .run(id, name, row.description, row.tql_query, row.filter_config_json, req.user.id, now, now);
  res.status(201).json(presentFilter(req, db.prepare('SELECT * FROM saved_filters WHERE id = ?').get(id)));
});

export default router;
