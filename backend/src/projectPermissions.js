// Project-level permissions.
//
// Each project (Space) has an access rule list per permission. A rule is either
//   { type: 'role',  value: '<project role name>' }   -> members holding that role
//   { type: 'field', value: 'assignee' | 'creator' }   -> the work item's assignee / creator
//   { type: 'user',  value: '<user id>' }               -> one project member
// Two built-in project roles exist:
//   "Admin Project" - the project owner, system administrators and members given this role.
//                     They always hold every permission (the rule cannot be removed).
//   "All Member"    - every member of the project.
// Projects without a saved rule list for a permission use DEFAULT_RULES.
import { db, nowIso, parseJson } from './db.js';
import { isAdmin } from './access.js';

export const ADMIN_PROJECT_ROLE = 'Admin Project';
export const ALL_MEMBER_ROLE = 'All Member';
export const FIELD_RULES = {
  assignee: { label: 'Assignee', description: 'The person the work item is assigned to' },
  creator: { label: 'Creator / Reporter', description: 'The person who created (reported) the work item' }
};

// scope 'task': checked against one work item; a "User in Field" rule means the person in that
//   field of that item.
// scope 'project': not tied to one work item; a "User in Field" rule means anyone who is in that
//   field (assignee / creator) of at least one work item of the project.
export const PERMISSION_GROUPS = [
  {
    id: 'project', label: 'Project permissions', permissions: [
      { key: 'project.setting', label: 'Project Setting', description: 'Access and change the project settings and members.', scope: 'project' },
      { key: 'sprint.create', label: 'Sprint create', description: 'Create new sprints.', scope: 'project' },
      { key: 'sprint.update', label: 'Sprint update', description: 'Edit, start or complete sprints.', scope: 'project' },
      { key: 'sprint.delete', label: 'Sprint delete', description: 'Delete sprints.', scope: 'project' },
      { key: 'team', label: 'Team', description: 'Create, edit and delete teams in the project.', scope: 'project' }
    ]
  },
  {
    id: 'issue', label: 'Issue permissions', permissions: [
      { key: 'task.clone', label: 'Clone task', description: 'Make a copy of a work item.', scope: 'task' },
      { key: 'task.create', label: 'Create task', description: 'Create new work items.', scope: 'project' },
      { key: 'task.update', label: 'Update task', description: 'Edit work item details (title, description, priority, dates…).', scope: 'task' },
      { key: 'task.delete', label: 'Task delete', description: 'Delete work items.', scope: 'task' },
      { key: 'task.link', label: 'Task linked', description: 'Link work items together.', scope: 'task' },
      { key: 'task.worklog', label: 'Task worklog', description: 'Log time spent on work items.', scope: 'task' },
      { key: 'task.assign', label: 'Assign issue', description: 'Assign work items to people.', scope: 'task' },
      { key: 'task.move', label: 'Move task', description: 'Change the status of work items or move them between sprints.', scope: 'task' }
    ]
  },
  {
    id: 'comment', label: 'Comment permissions', permissions: [
      { key: 'comment.add', label: 'Task add comment', description: 'Add comments to work items.', scope: 'task' },
      { key: 'comment.view', label: 'Task view comment', description: 'See the comments of work items.', scope: 'task' },
      { key: 'comment.edit_own', label: 'Edit owner comment', description: 'Edit your own comments.', scope: 'task' },
      { key: 'comment.delete_own', label: 'Delete owner comment', description: 'Delete your own comments.', scope: 'task' },
      { key: 'comment.edit_all', label: 'Edit all comment', description: 'Edit anyone’s comments.', scope: 'task' },
      { key: 'comment.delete_all', label: 'Delete all comment', description: 'Delete anyone’s comments.', scope: 'task' }
    ]
  },
  {
    id: 'attachment', label: 'Attachment permissions', permissions: [
      { key: 'attachment.add', label: 'Task add attachment', description: 'Attach files to work items.', scope: 'task' },
      { key: 'attachment.delete_own', label: 'Task delete owner attachment', description: 'Delete files you uploaded.', scope: 'task' },
      { key: 'attachment.delete_all', label: 'Task delete all attachment', description: 'Delete any file attached to work items.', scope: 'task' }
    ]
  }
];

export const PERMISSIONS = PERMISSION_GROUPS.flatMap((group) => group.permissions.map((permission) => ({ ...permission, group: group.id })));
export const PERMISSION_KEYS = PERMISSIONS.map((permission) => permission.key);
const PERMISSION_BY_KEY = Object.fromEntries(PERMISSIONS.map((permission) => [permission.key, permission]));

// Everything a project member could do before permissions existed stays open to "All Member";
// settings and other people's comments/files are for project admins only.
const ADMIN_ONLY = new Set(['project.setting', 'comment.edit_all', 'comment.delete_all', 'attachment.delete_all']);
export function defaultRules(key) {
  return ADMIN_ONLY.has(key) ? [] : [{ type: 'role', value: ALL_MEMBER_ROLE }];
}

function cleanRules(rules) {
  return (Array.isArray(rules) ? rules : [])
    .filter((rule) => rule && (rule.type === 'role' || rule.type === 'field' || rule.type === 'user'))
    .map((rule) => ({ type: rule.type, value: String(rule.value) }))
    .filter((rule) => rule.value && rule.value !== ADMIN_PROJECT_ROLE);
}

/** Saved or default rules for every permission of a project (Admin Project not listed). */
export function projectRules(spaceId) {
  const saved = Object.fromEntries(db.prepare('SELECT permission_key, rules_json FROM project_permissions WHERE space_id = ?')
    .all(String(spaceId)).map((row) => [row.permission_key, cleanRules(parseJson(row.rules_json, []))]));
  return Object.fromEntries(PERMISSION_KEYS.map((key) => [key, saved[key] || defaultRules(key)]));
}

/**
 * Validates a rule list for one permission. Returns { rules } or { error }.
 * Role rules must name an existing project role; field rules only apply to work item permissions.
 */
export function validateRules(key, rules, spaceId = null) {
  const permission = PERMISSION_BY_KEY[key];
  if (!permission) return { error: 'Unknown permission.' };
  if (!Array.isArray(rules)) return { error: 'Rules must be a list.' };
  const roleNames = db.prepare('SELECT name FROM project_roles').all().map((row) => row.name);
  const result = [];
  for (const rule of rules) {
    const type = rule?.type;
    const value = String(rule?.value || '').trim();
    if (type === 'role') {
      const match = roleNames.find((name) => name.toLowerCase() === value.toLowerCase());
      if (!match) return { error: `Unknown project role: ${value || '(empty)'}.` };
      if (match === ADMIN_PROJECT_ROLE) continue; // always included
      if (!result.some((item) => item.type === 'role' && item.value === match)) result.push({ type, value: match });
    } else if (type === 'field') {
      if (!FIELD_RULES[value]) return { error: `Unknown field: ${value || '(empty)'}.` };
      if (!result.some((item) => item.type === 'field' && item.value === value)) result.push({ type, value });
    } else if (type === 'user') {
      // Only project members: permissions never apply to people outside the project.
      const user = db.prepare('SELECT id, is_active FROM users WHERE id = ?').get(value);
      const space = spaceId ? db.prepare('SELECT owner_id FROM spaces WHERE id = ?').get(String(spaceId)) : null;
      const member = spaceId && (space?.owner_id === value || db.prepare('SELECT 1 FROM space_members WHERE space_id = ? AND user_id = ?').get(String(spaceId), value));
      if (!user || !user.is_active || !member) return { error: 'User rules can only name active members of this project.' };
      if (!result.some((item) => item.type === 'user' && item.value === value)) result.push({ type, value });
    } else {
      return { error: 'Each rule must be a Role, a User or a User in Field rule.' };
    }
  }
  return { rules: result };
}

export function saveRules(spaceId, key, rules) {
  db.prepare(`INSERT INTO project_permissions (space_id, permission_key, rules_json, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(space_id, permission_key) DO UPDATE SET rules_json = excluded.rules_json, updated_at = excluded.updated_at`)
    .run(String(spaceId), key, JSON.stringify(rules), nowIso());
}

export function resetRules(spaceId) {
  db.prepare('DELETE FROM project_permissions WHERE space_id = ?').run(String(spaceId));
}

/** Removes a person's User rules from a project (when they leave it). Defaults are untouched. */
export function removeUserFromRules(spaceId, userId) {
  const update = db.prepare('UPDATE project_permissions SET rules_json = ?, updated_at = ? WHERE space_id = ? AND permission_key = ?');
  for (const row of db.prepare('SELECT permission_key, rules_json FROM project_permissions WHERE space_id = ?').all(String(spaceId))) {
    const rules = cleanRules(parseJson(row.rules_json, []));
    const next = rules.filter((rule) => !(rule.type === 'user' && rule.value === String(userId)));
    if (next.length !== rules.length) update.run(JSON.stringify(next), nowIso(), String(spaceId), row.permission_key);
  }
}

/** Renames (or, with newName null, removes) a project role inside every saved rule list. */
export function renameRoleInRules(oldName, newName) {
  const update = db.prepare('UPDATE project_permissions SET rules_json = ? WHERE space_id = ? AND permission_key = ?');
  for (const row of db.prepare('SELECT space_id, permission_key, rules_json FROM project_permissions').all()) {
    const rules = cleanRules(parseJson(row.rules_json, []));
    if (!rules.some((rule) => rule.type === 'role' && rule.value.toLowerCase() === oldName.toLowerCase())) continue;
    const next = newName
      ? rules.map((rule) => (rule.type === 'role' && rule.value.toLowerCase() === oldName.toLowerCase() ? { ...rule, value: newName } : rule))
      : rules.filter((rule) => !(rule.type === 'role' && rule.value.toLowerCase() === oldName.toLowerCase()));
    update.run(JSON.stringify(next), row.space_id, row.permission_key);
  }
}

/**
 * The current user's standing in a project: whether they are a member, a project admin,
 * and their project roles. Cached on the request (req.permissionCache) when given.
 */
export function memberContext(user, spaceId, cache = null) {
  const id = String(spaceId || '');
  if (cache?.has(id)) return cache.get(id);
  const space = db.prepare('SELECT id, owner_id FROM spaces WHERE id = ?').get(id);
  let context = { spaceId: id, userId: user ? String(user.id) : null, exists: Boolean(space), isMember: false, isProjectAdmin: false, isOwner: false, roles: [] };
  if (space && user) {
    const member = db.prepare('SELECT member_json FROM space_members WHERE space_id = ? AND user_id = ?').get(id, user.id);
    const record = member ? parseJson(member.member_json, {}) : null;
    const roles = Array.isArray(record?.roles) ? record.roles.map(String) : [];
    const isOwner = Boolean(space.owner_id) && space.owner_id === user.id;
    const isMember = Boolean(member) || isOwner;
    const isProjectAdmin = isAdmin(user) || isOwner || roles.some((role) => role.toLowerCase() === ADMIN_PROJECT_ROLE.toLowerCase());
    const held = db.prepare(`SELECT
        EXISTS(SELECT 1 FROM work_items WHERE space_id = ? AND assignee_id = ?) AS assignee,
        EXISTS(SELECT 1 FROM work_items WHERE space_id = ? AND creator_id = ?) AS creator`).get(id, user.id, id, user.id);
    const fieldsHeld = { assignee: Boolean(held.assignee), creator: Boolean(held.creator) };
    context = { spaceId: id, userId: String(user.id), fieldsHeld, exists: true, isMember: isMember || isAdmin(user), isProjectAdmin, isOwner, roles, rules: projectRules(id) };
  }
  cache?.set(id, context);
  return context;
}

/**
 * What the user is granted for each permission: { all: true } when unconditional,
 * otherwise the work item fields that grant it ({ all: false, fields: ['assignee'] }).
 */
export function grantsFor(context) {
  const grants = {};
  for (const key of PERMISSION_KEYS) {
    if (context.isProjectAdmin) { grants[key] = { all: true, fields: [] }; continue; }
    if (!context.isMember) { grants[key] = { all: false, fields: [] }; continue; }
    const rules = context.rules[key] || [];
    const roles = context.roles.map((role) => role.toLowerCase());
    const all = rules.some((rule) => (rule.type === 'role'
      && (rule.value === ALL_MEMBER_ROLE || roles.includes(rule.value.toLowerCase())))
      || (rule.type === 'user' && rule.value === context.userId));
    const fields = rules.filter((rule) => rule.type === 'field').map((rule) => rule.value);
    // Project-level permissions: holding the field on any work item of the project is enough.
    const byField = PERMISSION_BY_KEY[key].scope === 'project' && fields.some((field) => context.fieldsHeld?.[field]);
    grants[key] = { all: all || byField, fields: all || byField ? [] : fields };
  }
  return grants;
}

/** The assignee / creator user ids of a work item row (or a prospective item). */
function fieldUserId(item, field) {
  if (!item) return null;
  if (field === 'assignee') return item.assignee_id ?? item.assigneeId ?? null;
  if (field === 'creator') return item.creator_id ?? item.creatorId ?? null;
  return null;
}

/** Does the user hold `key` in the project (for the given work item, when it is item-scoped)? */
export function can(user, spaceId, key, item = null, cache = null) {
  const context = memberContext(user, spaceId, cache);
  if (!context.exists || !context.isMember) return false;
  if (context.isProjectAdmin) return true;
  const grant = grantsFor(context)[key];
  if (!grant) return false;
  if (grant.all) return true;
  return Boolean(item && user && grant.fields.some((field) => String(fieldUserId(item, field) || '') === String(user.id)));
}

/** Express helper: 403 with a readable message. */
export function denied(res, key) {
  const label = PERMISSION_BY_KEY[key]?.label || key;
  return res.status(403).json({ error: `You do not have the "${label}" permission in this project.`, permission: key });
}

export function permissionLabel(key) {
  return PERMISSION_BY_KEY[key]?.label || key;
}

/** Middleware: 403 unless the user holds a project-scoped permission (run after the access check). */
export function requirePermission(key, resolveSpaceId) {
  return (req, res, next) => {
    if (!can(req.user, resolveSpaceId(req), key)) return denied(res, key);
    next();
  };
}
