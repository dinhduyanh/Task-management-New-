// System administration (mounted at /api/admin behind requireAuth + requireAdmin):
// user accounts and system roles, project roles, dashboard SQL widgets.
import { Router } from 'express';
import { db, createId, nowIso } from '../db.js';
import { ALL_MEMBER_ROLE, renameRoleInRules } from '../projectPermissions.js';
import { PASSWORD_RULE, PASSWORD_RULE_MESSAGE, hashPassword } from '../passwords.js';
import { CHART_TYPES, runWidgetSql, validateWidgetSql } from '../widgetQuery.js';

const router = Router();
const USERNAME_RE = /^[A-Za-z0-9._-]{3,40}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = new Set(['admin', 'user']);
const VISIBILITY = new Set(['admins', 'everyone']);

// ---- Users ------------------------------------------------------------------------

function adminUser(row) {
  const projects = db.prepare(`SELECT COUNT(*) AS count FROM spaces s
    WHERE s.owner_id = ? OR EXISTS (SELECT 1 FROM space_members m WHERE m.space_id = s.id AND m.user_id = ?)`).get(row.id, row.id).count;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
    role: row.role === 'admin' ? 'admin' : 'user',
    isActive: Boolean(row.is_active),
    hasPassword: Boolean(row.password_hash),
    projectCount: projects,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const USER_COLUMNS = 'id, username, email, full_name, avatar_url, role, is_active, password_hash, created_at, updated_at';
const getUser = (id) => db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(String(id));

function otherActiveAdmins(userId) {
  return db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = 1 AND id <> ?").get(userId).count;
}

/** Validates editable profile fields. Returns { values } or { error, status }. */
function readUserFields(body, current = null) {
  const values = {};
  if (!current || body.fullName !== undefined) {
    const fullName = String(body.fullName || '').trim();
    if (!fullName) return { error: 'Full name is required.' };
    if (fullName.length > 120) return { error: 'Full name must be 120 characters or fewer.' };
    values.full_name = fullName;
  }
  if (!current) {
    const username = String(body.username || '').trim();
    if (!USERNAME_RE.test(username)) return { error: 'Username must be 3-40 letters, numbers, ".", "_" or "-".' };
    if (db.prepare('SELECT 1 FROM users WHERE lower(username) = lower(?)').get(username)) return { error: 'This username is already taken.', status: 409 };
    values.username = username;
  }
  if (!current || body.email !== undefined) {
    const email = String(body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return { error: 'Enter a valid email address.' };
    if (db.prepare('SELECT 1 FROM users WHERE lower(email) = ? AND id <> ?').get(email, current?.id || '')) return { error: 'This email is already used by another account.', status: 409 };
    values.email = email;
  }
  if (!current || body.role !== undefined) {
    const role = body.role === undefined ? 'user' : String(body.role);
    if (!ROLES.has(role)) return { error: 'Role must be admin or user.' };
    values.role = role;
  }
  if (current && body.isActive !== undefined) values.is_active = body.isActive ? 1 : 0;
  return { values };
}

router.get('/users', (_req, res) => {
  const rows = db.prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY lower(full_name), lower(username)`).all();
  res.json(rows.map(adminUser));
});

router.post('/users', async (req, res, next) => {
  try {
    const body = req.body || {};
    const { values, error, status } = readUserFields(body);
    if (error) return res.status(status || 400).json({ error });
    const password = String(body.password || '');
    if (!PASSWORD_RULE.test(password)) return res.status(400).json({ error: PASSWORD_RULE_MESSAGE });
    const id = createId('user');
    const now = nowIso();
    db.prepare(`INSERT INTO users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`)
      .run(id, values.username, values.email, values.full_name, await hashPassword(password), values.role, now, now);
    res.status(201).json(adminUser(getUser(id)));
  } catch (error) { next(error); }
});

router.patch('/users/:id', (req, res, next) => {
  try {
    const current = getUser(req.params.id);
    if (!current) return res.status(404).json({ error: 'User not found.' });
    const { values, error, status } = readUserFields(req.body || {}, current);
    if (error) return res.status(status || 400).json({ error });
    const losesAdmin = current.role === 'admin' && current.is_active &&
      ((values.role && values.role !== 'admin') || values.is_active === 0);
    if (losesAdmin && current.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot remove your own administrator access or deactivate your own account.' });
    }
    if (losesAdmin && !otherActiveAdmins(current.id)) {
      return res.status(400).json({ error: 'The system needs at least one active administrator.' });
    }
    const entries = Object.entries(values);
    if (entries.length) {
      db.transaction(() => {
        db.prepare(`UPDATE users SET ${entries.map(([column]) => `${column} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
          .run(...entries.map(([, value]) => value), nowIso(), current.id);
        // A deactivated account is signed out everywhere.
        if (values.is_active === 0) db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(current.id);
      })();
    }
    res.json(adminUser(getUser(current.id)));
  } catch (error) { next(error); }
});

// Sets a new password and signs the user out of every session.
router.post('/users/:id/password', async (req, res, next) => {
  try {
    const current = getUser(req.params.id);
    if (!current) return res.status(404).json({ error: 'User not found.' });
    const password = String(req.body?.password || '');
    if (!PASSWORD_RULE.test(password)) return res.status(400).json({ error: PASSWORD_RULE_MESSAGE });
    const hash = await hashPassword(password);
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hash, nowIso(), current.id);
      if (current.id !== req.user.id) db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(current.id);
    })();
    res.json(adminUser(getUser(current.id)));
  } catch (error) { next(error); }
});

// ---- Project roles ------------------------------------------------------------------

function roleUsage(name) {
  // Members store their role names in member_json.roles.
  return db.prepare('SELECT member_json FROM space_members').all()
    .filter((row) => {
      try { return (JSON.parse(row.member_json).roles || []).some((role) => String(role).toLowerCase() === name.toLowerCase()); } catch { return false; }
    }).length;
}

function projectRole(row) {
  return { id: row.id, name: row.name, description: row.description, position: row.position, isSystem: Boolean(row.is_system), memberCount: row.name === ALL_MEMBER_ROLE ? null : roleUsage(row.name), createdAt: row.created_at, updatedAt: row.updated_at };
}

function readRole(body, current = null) {
  const values = {};
  if (!current || body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (!name) return { error: 'Role name is required.' };
    if (name.length > 60) return { error: 'Role name must be 60 characters or fewer.' };
    if (db.prepare('SELECT 1 FROM project_roles WHERE name = ? COLLATE NOCASE AND id <> ?').get(name, current?.id || '')) {
      return { error: `A project role named "${name}" already exists.`, status: 409 };
    }
    values.name = name;
  }
  if (body.description !== undefined) {
    const description = String(body.description || '').trim();
    if (description.length > 300) return { error: 'Description must be 300 characters or fewer.' };
    values.description = description;
  }
  return { values };
}

router.get('/project-roles', (_req, res) => {
  res.json(db.prepare('SELECT * FROM project_roles ORDER BY position, lower(name)').all().map(projectRole));
});

router.post('/project-roles', (req, res) => {
  const { values, error, status } = readRole(req.body || {});
  if (error) return res.status(status || 400).json({ error });
  const id = createId('prole');
  const now = nowIso();
  const position = (db.prepare('SELECT MAX(position) AS max FROM project_roles').get().max ?? -1) + 1;
  db.prepare('INSERT INTO project_roles (id, name, description, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, values.name, values.description || '', position, now, now);
  res.status(201).json(projectRole(db.prepare('SELECT * FROM project_roles WHERE id = ?').get(id)));
});

// Renaming a role also renames it for every project member who has it.
router.patch('/project-roles/:id', (req, res) => {
  const current = db.prepare('SELECT * FROM project_roles WHERE id = ?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Project role not found.' });
  if (current.is_system && req.body?.name !== undefined && String(req.body.name).trim() !== current.name) {
    return res.status(400).json({ error: `"${current.name}" is a built-in role and cannot be renamed.` });
  }
  const { values, error, status } = readRole(req.body || {}, current);
  if (error) return res.status(status || 400).json({ error });
  db.transaction(() => {
    db.prepare('UPDATE project_roles SET name = ?, description = ?, updated_at = ? WHERE id = ?')
      .run(values.name ?? current.name, values.description ?? current.description, nowIso(), current.id);
    if (values.name && values.name !== current.name) {
      const update = db.prepare('UPDATE space_members SET member_json = ? WHERE space_id = ? AND user_id = ?');
      for (const row of db.prepare('SELECT space_id, user_id, member_json FROM space_members').all()) {
        let member;
        try { member = JSON.parse(row.member_json); } catch { continue; }
        if (!Array.isArray(member.roles) || !member.roles.some((role) => String(role).toLowerCase() === current.name.toLowerCase())) continue;
        member.roles = member.roles.map((role) => (String(role).toLowerCase() === current.name.toLowerCase() ? values.name : role));
        member.role = member.roles.join(', ');
        update.run(JSON.stringify(member), row.space_id, row.user_id);
      }
      renameRoleInRules(current.name, values.name);
    }
  })();
  res.json(projectRole(db.prepare('SELECT * FROM project_roles WHERE id = ?').get(current.id)));
});

router.delete('/project-roles/:id', (req, res) => {
  const current = db.prepare('SELECT * FROM project_roles WHERE id = ?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Project role not found.' });
  if (current.is_system) return res.status(400).json({ error: `"${current.name}" is a built-in role and cannot be deleted.` });
  const usage = roleUsage(current.name);
  if (usage) return res.status(409).json({ error: `"${current.name}" is assigned to ${usage} project member${usage === 1 ? '' : 's'}. Change their role first.` });
  db.transaction(() => {
    db.prepare('DELETE FROM project_roles WHERE id = ?').run(current.id);
    renameRoleInRules(current.name, null);
  })();
  res.status(204).end();
});

// ---- Dashboard SQL widgets ----------------------------------------------------------

export function widgetRowToObject(row, { includeSql = true } = {}) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    chartType: row.chart_type,
    visibility: row.visibility,
    isActive: Boolean(row.is_active),
    position: row.position,
    ...(includeSql ? { sql: row.sql_query } : {}),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function readWidget(body, current = null) {
  const values = {};
  if (!current || body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (!name) return { error: 'Widget name is required.' };
    if (name.length > 80) return { error: 'Widget name must be 80 characters or fewer.' };
    values.name = name;
  }
  if (body.description !== undefined) values.description = String(body.description || '').trim().slice(0, 300);
  if (!current || body.chartType !== undefined) {
    const chartType = String(body.chartType || 'table');
    if (!CHART_TYPES.includes(chartType)) return { error: `Display type must be one of: ${CHART_TYPES.join(', ')}.` };
    values.chart_type = chartType;
  }
  if (!current || body.visibility !== undefined) {
    const visibility = String(body.visibility || 'admins');
    if (!VISIBILITY.has(visibility)) return { error: 'Visibility must be admins or everyone.' };
    values.visibility = visibility;
  }
  if (body.isActive !== undefined) values.is_active = body.isActive ? 1 : 0;
  if (!current || body.sql !== undefined) {
    try { validateWidgetSql(body.sql); } catch (error) { return { error: error.message }; }
    values.sql_query = String(body.sql).trim().replace(/;+\s*$/, '');
  }
  return { values };
}

router.get('/widgets', (_req, res) => {
  res.json(db.prepare('SELECT * FROM dashboard_widgets ORDER BY position, created_at').all().map((row) => widgetRowToObject(row)));
});

router.post('/widgets', (req, res) => {
  const { values, error } = readWidget(req.body || {});
  if (error) return res.status(400).json({ error });
  const id = createId('widget');
  const now = nowIso();
  const position = (db.prepare('SELECT MAX(position) AS max FROM dashboard_widgets').get().max ?? -1) + 1;
  db.prepare(`INSERT INTO dashboard_widgets (id, name, description, chart_type, sql_query, visibility, is_active, position, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, values.name, values.description || '', values.chart_type, values.sql_query, values.visibility, values.is_active ?? 1, position, req.user.fullName || req.user.username, now, now);
  res.status(201).json(widgetRowToObject(db.prepare('SELECT * FROM dashboard_widgets WHERE id = ?').get(id)));
});

router.patch('/widgets/:id', (req, res) => {
  const current = db.prepare('SELECT * FROM dashboard_widgets WHERE id = ?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Widget not found.' });
  const { values, error } = readWidget(req.body || {}, current);
  if (error) return res.status(400).json({ error });
  const entries = Object.entries(values);
  if (entries.length) {
    db.prepare(`UPDATE dashboard_widgets SET ${entries.map(([column]) => `${column} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...entries.map(([, value]) => value), nowIso(), current.id);
  }
  res.json(widgetRowToObject(db.prepare('SELECT * FROM dashboard_widgets WHERE id = ?').get(current.id)));
});

router.delete('/widgets/:id', (req, res) => {
  const result = db.prepare('DELETE FROM dashboard_widgets WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Widget not found.' });
  res.status(204).end();
});

// Runs SQL without saving it (the "Run query" button in the widget editor).
router.post('/widgets/preview', (req, res) => {
  try {
    res.json(runWidgetSql(req.body?.sql, { viewerId: req.user.id }));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
