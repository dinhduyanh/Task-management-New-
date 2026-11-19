// Read-only data every signed-in user may use: the project role list (for adding project
// members) and the dashboard widgets visible to them.
import { Router } from 'express';
import { db } from '../db.js';
import { isAdmin } from '../access.js';
import { runWidgetSql } from '../widgetQuery.js';
import { widgetRowToObject } from './admin.js';

const router = Router();

router.get('/project-roles', (_req, res) => {
  res.json(db.prepare('SELECT id, name, description, is_system FROM project_roles ORDER BY position, lower(name)').all()
    .map((row) => ({ id: row.id, name: row.name, description: row.description, isSystem: Boolean(row.is_system) })));
});

/** Active widgets the user may see. Regular users never receive the SQL text. */
export function visibleWidgets(user) {
  const rows = isAdmin(user)
    ? db.prepare('SELECT * FROM dashboard_widgets WHERE is_active = 1 ORDER BY position, created_at').all()
    : db.prepare("SELECT * FROM dashboard_widgets WHERE is_active = 1 AND visibility = 'everyone' ORDER BY position, created_at").all();
  return rows.map((row) => widgetRowToObject(row, { includeSql: isAdmin(user) }));
}

router.get('/dashboard/widgets', (req, res) => {
  res.json(visibleWidgets(req.user));
});

router.get('/dashboard/widgets/:id/data', (req, res) => {
  const widget = visibleWidgets(req.user).find((item) => item.id === req.params.id);
  if (!widget) return res.status(404).json({ error: 'Widget not found.' });
  const row = db.prepare('SELECT sql_query FROM dashboard_widgets WHERE id = ?').get(widget.id);
  try {
    res.json(runWidgetSql(row.sql_query, { viewerId: req.user.id }));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
