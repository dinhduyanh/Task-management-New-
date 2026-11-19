// User dashboards: a named layout of SQL widgets (widgets are managed by admins).
//   private -> only the owner (and system administrators) can open it
//   public  -> every signed-in user can open it while it is active
// Only the owner or an administrator may change or delete a dashboard. Users star
// dashboards (favourites) and each opening is remembered (sidebar "recent" list).
import { Router } from 'express';
import { db, createId, nowIso, parseJson } from '../db.js';
import { isAdmin } from '../access.js';
import { visibleWidgets } from './catalog.js';

const router = Router();
const STATUSES = new Set(['active', 'inactive']);
const VISIBILITIES = new Set(['private', 'public']);
const CODE_RE = /^[A-Za-z0-9_-]{2,20}$/;
const MAX_WIDGETS = 24;

function canView(user, row) {
  if (!row) return false;
  if (isAdmin(user) || row.owner_id === user.id) return true;
  return row.visibility === 'public' && row.status === 'active';
}

function canEdit(user, row) {
  return Boolean(row) && (isAdmin(user) || row.owner_id === user.id);
}

function layoutOf(row) {
  const layout = parseJson(row.layout_json, []);
  return Array.isArray(layout) ? layout : [];
}

function toObject(row, user, { withLayout = false } = {}) {
  const owner = row.owner_id ? db.prepare('SELECT id, full_name, username FROM users WHERE id = ?').get(row.owner_id) : null;
  const star = db.prepare('SELECT created_at FROM dashboard_favorites WHERE user_id = ? AND dashboard_id = ?').get(user.id, row.id);
  const visit = db.prepare('SELECT visited_at FROM dashboard_visits WHERE user_id = ? AND dashboard_id = ?').get(user.id, row.id);
  const layout = layoutOf(row);
  const result = {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    status: row.status,
    visibility: row.visibility,
    owner: owner ? { id: owner.id, name: owner.full_name || owner.username } : null,
    widgetCount: layout.length,
    starred: Boolean(star),
    starredAt: star?.created_at || null,
    lastVisitedAt: visit?.visited_at || null,
    canEdit: canEdit(user, row),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  if (withLayout) {
    // Each slot says whether this viewer may see its widget (admin-only widgets, removed or inactive widgets).
    const available = new Map(visibleWidgets(user).map((widget) => [widget.id, widget]));
    result.layout = layout.map((slot) => {
      const widget = available.get(slot.widgetId);
      const stored = widget ? null : db.prepare('SELECT name, chart_type FROM dashboard_widgets WHERE id = ?').get(slot.widgetId);
      return {
        widgetId: slot.widgetId,
        size: slot.size,
        available: Boolean(widget),
        widget: widget
          ? { id: widget.id, name: widget.name, description: widget.description, chartType: widget.chartType }
          : { id: slot.widgetId, name: stored?.name || 'Removed widget', description: '', chartType: stored?.chart_type || 'table' }
      };
    });
  }
  return result;
}

function nextCode() {
  const numbers = db.prepare("SELECT code FROM dashboards WHERE code LIKE 'DB-%'").all()
    .map(({ code }) => Number(String(code).slice(3))).filter(Number.isFinite);
  return `DB-${String(Math.max(0, ...numbers) + 1).padStart(3, '0')}`;
}

/** Validates create/update input. Returns { values } or { error, status }. */
function readDashboard(body, user, current = null) {
  const values = {};
  if (!current || body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (!name) return { error: 'Dashboard name is required.' };
    if (name.length > 80) return { error: 'Dashboard name must be 80 characters or fewer.' };
    values.name = name;
  }
  if (body.code !== undefined || !current) {
    const code = String(body.code || '').trim().toUpperCase() || (current ? current.code : nextCode());
    if (!CODE_RE.test(code)) return { error: 'Code must be 2–20 letters, numbers, "-" or "_".' };
    if (db.prepare('SELECT 1 FROM dashboards WHERE code = ? COLLATE NOCASE AND id <> ?').get(code, current?.id || '')) {
      return { error: `A dashboard with code ${code} already exists.`, status: 409 };
    }
    values.code = code;
  }
  if (body.description !== undefined) {
    const description = String(body.description || '').trim();
    if (description.length > 300) return { error: 'Description must be 300 characters or fewer.' };
    values.description = description;
  }
  if (body.status !== undefined) {
    if (!STATUSES.has(body.status)) return { error: 'Status must be active or inactive.' };
    values.status = body.status;
  }
  if (body.visibility !== undefined) {
    if (!VISIBILITIES.has(body.visibility)) return { error: 'Publish must be private or public.' };
    values.visibility = body.visibility;
  }
  if (body.layout !== undefined) {
    if (!Array.isArray(body.layout)) return { error: 'Layout must be a list of widgets.' };
    if (body.layout.length > MAX_WIDGETS) return { error: `A dashboard can hold at most ${MAX_WIDGETS} widgets.` };
    const allowed = new Set(visibleWidgets(user).map((widget) => widget.id));
    const kept = new Set(current ? layoutOf(current).map((slot) => slot.widgetId) : []);
    const layout = [];
    for (const slot of body.layout) {
      const widgetId = String(slot?.widgetId || '');
      // New widgets must be visible to the editor; widgets already on the dashboard may stay.
      if (!allowed.has(widgetId) && !kept.has(widgetId)) return { error: 'One of the widgets is not available to you.' };
      const size = Number(slot?.size) || 1;
      if (![1, 2, 3].includes(size)) return { error: 'Widget width must be 1, 2 or 3 columns.' };
      layout.push({ widgetId, size });
    }
    values.layout_json = JSON.stringify(layout);
  }
  return { values };
}

router.get('/', (req, res) => {
  const rows = isAdmin(req.user)
    ? db.prepare('SELECT * FROM dashboards ORDER BY lower(name)').all()
    : db.prepare("SELECT * FROM dashboards WHERE owner_id = ? OR (visibility = 'public' AND status = 'active') ORDER BY lower(name)").all(req.user.id);
  res.json(rows.map((row) => toObject(row, req.user)));
});

router.post('/', (req, res) => {
  const { values, error, status } = readDashboard(req.body || {}, req.user);
  if (error) return res.status(status || 400).json({ error });
  const id = createId('dash');
  const now = nowIso();
  db.prepare(`INSERT INTO dashboards (id, code, name, description, status, visibility, owner_id, layout_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, values.code, values.name, values.description || '', values.status || 'active', values.visibility || 'private',
      req.user.id, values.layout_json || '[]', now, now);
  res.status(201).json(toObject(db.prepare('SELECT * FROM dashboards WHERE id = ?').get(id), req.user, { withLayout: true }));
});

// Opening a dashboard records the visit (sidebar "recent" ordering).
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM dashboards WHERE id = ?').get(req.params.id);
  if (!canView(req.user, row)) return res.status(404).json({ error: 'Dashboard not found.' });
  if (req.query.visit !== '0') {
    db.prepare(`INSERT INTO dashboard_visits (user_id, dashboard_id, visited_at) VALUES (?, ?, ?)
      ON CONFLICT(user_id, dashboard_id) DO UPDATE SET visited_at = excluded.visited_at`).run(req.user.id, row.id, nowIso());
  }
  res.json(toObject(row, req.user, { withLayout: true }));
});

router.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM dashboards WHERE id = ?').get(req.params.id);
  if (!canView(req.user, row)) return res.status(404).json({ error: 'Dashboard not found.' });
  if (!canEdit(req.user, row)) return res.status(403).json({ error: 'Only the owner or an administrator can change this dashboard.' });
  const { values, error, status } = readDashboard(req.body || {}, req.user, row);
  if (error) return res.status(status || 400).json({ error });
  const fields = Object.keys(values);
  if (fields.length) {
    db.prepare(`UPDATE dashboards SET ${fields.map((field) => `${field} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...fields.map((field) => values[field]), nowIso(), row.id);
  }
  res.json(toObject(db.prepare('SELECT * FROM dashboards WHERE id = ?').get(row.id), req.user, { withLayout: true }));
});

router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM dashboards WHERE id = ?').get(req.params.id);
  if (!canView(req.user, row)) return res.status(404).json({ error: 'Dashboard not found.' });
  if (!canEdit(req.user, row)) return res.status(403).json({ error: 'Only the owner or an administrator can delete this dashboard.' });
  db.prepare('DELETE FROM dashboards WHERE id = ?').run(row.id);
  res.status(204).end();
});

// Body: { starred: boolean }
router.put('/:id/star', (req, res) => {
  const row = db.prepare('SELECT * FROM dashboards WHERE id = ?').get(req.params.id);
  if (!canView(req.user, row)) return res.status(404).json({ error: 'Dashboard not found.' });
  if (req.body?.starred) {
    db.prepare('INSERT OR IGNORE INTO dashboard_favorites (user_id, dashboard_id, created_at) VALUES (?, ?, ?)').run(req.user.id, row.id, nowIso());
  } else {
    db.prepare('DELETE FROM dashboard_favorites WHERE user_id = ? AND dashboard_id = ?').run(req.user.id, row.id);
  }
  res.json(toObject(row, req.user));
});

export default router;
