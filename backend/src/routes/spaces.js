import { Router } from 'express';
import { db, createId, nowIso, parseJson, spaceRowToObject, logActivity } from '../db.js';
import { canAccessSpace, canManageSpace, spaceFilter } from '../access.js';
import {
  ADMIN_PROJECT_ROLE, ALL_MEMBER_ROLE, FIELD_RULES, PERMISSION_GROUPS, can, denied, grantsFor,
  memberContext, projectRules, resetRules, saveRules, validateRules
} from '../projectPermissions.js';

const router = Router();
export const MAX_PINNED_SPACES = 5;
/** Project tabs that can be switched off in Project Settings > Features (Summary always stays). */
export const TOGGLEABLE_FEATURES = ['Timeline', 'Board', 'List', 'Backlog', 'Active Sprints', 'Teams'];

function hiddenFeatures(spaceId) {
  return db.prepare('SELECT feature_key FROM space_features WHERE space_id = ? AND enabled = 0').all(spaceId)
    .map((row) => row.feature_key)
    .filter((key) => TOGGLEABLE_FEATURES.includes(key))
    .sort((a, b) => TOGGLEABLE_FEATURES.indexOf(a) - TOGGLEABLE_FEATURES.indexOf(b));
}

/** The project lead: the owner (or, for older projects, the stored owner / creator name). */
function leadOf(row, data) {
  const owner = row.owner_id ? db.prepare('SELECT id, full_name, username FROM users WHERE id = ?').get(row.owner_id) : null;
  if (owner) return { id: owner.id, name: owner.full_name || owner.username };
  const stored = data.owner && typeof data.owner === 'object' ? data.owner : null;
  if (stored?.name) return { id: stored.id || null, name: stored.name };
  return data.createdBy ? { id: null, name: String(data.createdBy) } : null;
}

/**
 * Space as returned to a user, with what that user may do in it:
 *   manage  - delete the project (owner or system admin)
 *   admin   - "Admin Project": every permission, edits the permission rules
 *   grants  - per permission { all, fields } (fields: work item fields that grant it)
 */
function spaceForUser(row, user) {
  const space = spaceRowToObject(row);
  const context = memberContext(user, row.id);
  const pin = db.prepare('SELECT created_at FROM space_pins WHERE user_id = ? AND space_id = ?').get(user.id, row.id);
  const involved = row.owner_id === user.id || Boolean(db.prepare('SELECT 1 FROM space_members WHERE space_id = ? AND user_id = ?').get(row.id, user.id));
  return {
    ...space,
    lead: leadOf(row, parseJson(row.data_json, {})),
    involved,
    pinned: Boolean(pin),
    pinnedAt: pin?.created_at || null,
    hiddenFeatures: hiddenFeatures(row.id),
    permissions: {
      manage: canManageSpace(user, row.id),
      admin: context.isProjectAdmin,
      owner: context.isOwner,
      roles: context.roles,
      grants: grantsFor(context)
    }
  };
}

function memberRecord(user, roles) {
  return {
    id: user.id,
    userId: user.id,
    name: user.full_name,
    fullName: user.full_name,
    username: user.username,
    email: user.email,
    roles,
    role: roles.join(', ')
  };
}

/**
 * Validates project role names against the roles managed in System Settings.
 * "All Member" is implicit and cannot be given; "Admin Project" only by a project admin.
 */
function readRoles(value, actorIsProjectAdmin) {
  const names = (Array.isArray(value) ? value : []).map((role) => String(role || '').trim()).filter(Boolean);
  if (!names.length) return { error: 'Choose at least one project role.' };
  const known = db.prepare('SELECT name FROM project_roles').all().map((row) => row.name);
  const roles = [];
  for (const name of names) {
    const match = known.find((role) => role.toLowerCase() === name.toLowerCase());
    if (!match) return { error: `Unknown project role: ${name}.` };
    if (match === ALL_MEMBER_ROLE) return { error: 'Every member has the All Member role automatically.' };
    if (match === ADMIN_PROJECT_ROLE && !actorIsProjectAdmin) return { error: 'Only a project admin can give the Admin Project role.', status: 403 };
    if (!roles.includes(match)) roles.push(match);
  }
  return { roles };
}

function hasAdminRole(spaceId, userId) {
  const row = db.prepare('SELECT member_json FROM space_members WHERE space_id = ? AND user_id = ?').get(spaceId, userId);
  const roles = row ? parseJson(row.member_json, {}).roles : [];
  return Array.isArray(roles) && roles.some((role) => String(role).toLowerCase() === ADMIN_PROJECT_ROLE.toLowerCase());
}

router.get('/', (req, res) => {
  const filter = spaceFilter(req.user, 'id');
  const rows = db.prepare(`SELECT * FROM spaces WHERE ${filter.sql} ORDER BY created_at DESC`).all(...filter.params);
  res.json(rows.map((row) => spaceForUser(row, req.user)));
});

router.post('/', (req, res, next) => {
  try {
    const body = req.body || {};
    const code = String(body.code || '').trim().toUpperCase();
    const name = String(body.name || '').trim();
    if (!code || !name) return res.status(400).json({ error: 'Code and Name are required.' });

    const creator = db.prepare('SELECT id, username, email, full_name FROM users WHERE id = ?').get(req.user.id);
    const id = createId('space');
    const now = nowIso();
    // Members and ownership come from the signed-in user, never from the request body.
    const rest = { ...body };
    delete rest.members;
    delete rest.ownerId;
    delete rest.owner;
    const data = {
      ...rest,
      id, code, name,
      taskKeyPrefix: String(body.taskKeyPrefix || code).toUpperCase(),
      createdBy: creator.full_name,
      owner: { id: creator.id, name: creator.full_name },
      createdAt: now, updatedAt: now
    };
    const creatorRole = ADMIN_PROJECT_ROLE;
    db.transaction(() => {
      db.prepare(`INSERT INTO spaces (id, code, task_key_prefix, name, owner_id, visibility, created_at, updated_at, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, code, data.taskKeyPrefix, name, creator.id, data.visibility || null, now, now, JSON.stringify(data));
      db.prepare('INSERT INTO space_members (space_id, user_id, member_json, created_at) VALUES (?, ?, ?, ?)')
        .run(id, creator.id, JSON.stringify(memberRecord(creator, [creatorRole])), now);
      for (const team of (Array.isArray(body.teams) ? body.teams : [])) {
        db.prepare('INSERT INTO teams (id, space_id, name, data_json, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(String(team.id || createId('team')), id, String(team.name || team.label || team), JSON.stringify(team), now);
      }
      for (const release of (Array.isArray(body.releases) ? body.releases : [])) {
        db.prepare('INSERT INTO releases (id, space_id, name, data_json, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(String(release.id || createId('release')), id, String(release.name || release.label || release), JSON.stringify(release), now);
      }
      logActivity({ spaceId: id, actorName: creator.full_name, description: 'created this space' });
    })();

    res.status(201).json(spaceForUser(db.prepare('SELECT * FROM spaces WHERE id = ?').get(id), req.user));
  } catch (error) { next(error); }
});

router.get('/:spaceId', (req, res) => {
  if (!canAccessSpace(req.user, req.params.spaceId)) return res.status(404).json({ error: 'Space not found.' });
  res.json(spaceForUser(db.prepare('SELECT * FROM spaces WHERE id = ?').get(req.params.spaceId), req.user));
});

router.patch('/:spaceId', (req, res, next) => {
  try {
    if (!canAccessSpace(req.user, req.params.spaceId)) return res.status(404).json({ error: 'Space not found.' });
    if (!can(req.user, req.params.spaceId, 'project.setting')) return denied(res, 'project.setting');
    const current = db.prepare('SELECT * FROM spaces WHERE id = ?').get(req.params.spaceId);
    const updates = req.body || {};
    const previousData = parseJson(current.data_json, {});
    const safeUpdates = { ...updates };
    delete safeUpdates.teams; // teams have their own API (see routes/teams.js)
    delete safeUpdates.members; // members have their own endpoints below
    delete safeUpdates.ownerId; // ownership is not changed through settings
    delete safeUpdates.owner;
    delete safeUpdates.permissions;
    delete safeUpdates.hiddenFeatures; // feature visibility has its own endpoint (PUT /:spaceId/features)
    const nextData = { ...previousData, ...safeUpdates, updatedAt: nowIso() };
    const code = String(nextData.code || current.code).trim().toUpperCase();
    const name = String(nextData.name || current.name).trim();
    const prefix = String(nextData.taskKeyPrefix || code).trim().toUpperCase();

    db.transaction(() => {
      db.prepare(`UPDATE spaces SET code = ?, task_key_prefix = ?, name = ?, visibility = ?, updated_at = ?, data_json = ? WHERE id = ?`)
        .run(code, prefix, name, nextData.visibility ?? current.visibility, nextData.updatedAt, JSON.stringify(nextData), current.id);

      if (Array.isArray(updates.releases)) {
        db.prepare('DELETE FROM releases WHERE space_id = ?').run(current.id);
        for (const release of updates.releases) {
          db.prepare('INSERT INTO releases (id, space_id, name, data_json, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(String(release.id || createId('release')), current.id, String(release.name || release.label || release), JSON.stringify(release), nowIso());
        }
      }
      logActivity({ spaceId: current.id, actorName: req.user.fullName || 'You', description: `updated ${Object.keys(safeUpdates).join(', ') || 'space details'}` });
    })();

    res.json(spaceForUser(db.prepare('SELECT * FROM spaces WHERE id = ?').get(current.id), req.user));
  } catch (error) { next(error); }
});

// Shows or hides project features (tabs). Body: { features: { Timeline: false, Board: true, ... } }.
router.put('/:spaceId/features', (req, res, next) => {
  try {
    const { spaceId } = req.params;
    if (!canAccessSpace(req.user, spaceId)) return res.status(404).json({ error: 'Space not found.' });
    if (!can(req.user, spaceId, 'project.setting')) return denied(res, 'project.setting');
    const features = req.body?.features;
    if (!features || typeof features !== 'object' || Array.isArray(features) || !Object.keys(features).length) {
      return res.status(400).json({ error: 'Send the features to change, e.g. { "features": { "Timeline": false } }.' });
    }
    for (const [key, enabled] of Object.entries(features)) {
      if (key === 'Summary') return res.status(400).json({ error: 'Summary is always shown.' });
      if (!TOGGLEABLE_FEATURES.includes(key)) return res.status(400).json({ error: `Unknown feature: ${key}.` });
      if (typeof enabled !== 'boolean') return res.status(400).json({ error: `${key}: enabled must be true or false.` });
    }
    const now = nowIso();
    db.transaction(() => {
      const upsert = db.prepare(`INSERT INTO space_features (space_id, feature_key, enabled, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(space_id, feature_key) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`);
      for (const [key, enabled] of Object.entries(features)) upsert.run(spaceId, key, enabled ? 1 : 0, now);
      const summary = Object.entries(features).map(([key, enabled]) => `${enabled ? 'showed' : 'hid'} ${key}`).join(', ');
      logActivity({ spaceId, actorName: req.user.fullName || 'You', description: `${summary} in project features` });
    })();
    res.json(spaceForUser(db.prepare('SELECT * FROM spaces WHERE id = ?').get(spaceId), req.user));
  } catch (error) { next(error); }
});

router.delete('/:spaceId', (req, res) => {
  if (!canAccessSpace(req.user, req.params.spaceId)) return res.status(404).json({ error: 'Space not found.' });
  if (!canManageSpace(req.user, req.params.spaceId)) return res.status(403).json({ error: 'Only the project owner or an administrator can delete this project.' });
  db.prepare('DELETE FROM spaces WHERE id = ?').run(req.params.spaceId);
  res.status(204).end();
});

// Add a member or change their roles. Body: { userId, roles } (or legacy { user: { id }, roles }).
router.post('/:spaceId/members', (req, res, next) => {
  try {
    const spaceId = req.params.spaceId;
    if (!canAccessSpace(req.user, spaceId)) return res.status(404).json({ error: 'Space not found.' });
    if (!can(req.user, spaceId, 'project.setting')) return denied(res, 'project.setting');
    const actorIsProjectAdmin = memberContext(req.user, spaceId).isProjectAdmin;
    const userId = String(req.body?.userId || req.body?.user?.id || '');
    const user = db.prepare('SELECT id, username, email, full_name FROM users WHERE id = ? AND is_active = 1').get(userId);
    if (!user) return res.status(400).json({ error: 'Choose an active user.' });
    if (!actorIsProjectAdmin && hasAdminRole(spaceId, user.id)) return res.status(403).json({ error: 'Only a project admin can change the roles of a project admin.' });
    const { roles, error, status } = readRoles(req.body?.roles, actorIsProjectAdmin);
    if (error) return res.status(status || 400).json({ error });
    const existing = db.prepare('SELECT created_at FROM space_members WHERE space_id = ? AND user_id = ?').get(spaceId, user.id);
    db.prepare('INSERT OR REPLACE INTO space_members (space_id, user_id, member_json, created_at) VALUES (?, ?, ?, ?)')
      .run(spaceId, user.id, JSON.stringify(memberRecord(user, roles)), existing?.created_at || nowIso());
    logActivity({ spaceId, actorName: req.user.fullName || 'You', description: `${existing ? 'updated' : 'added'} member ${user.full_name}` });
    res.status(existing ? 200 : 201).json(spaceRowToObject(db.prepare('SELECT * FROM spaces WHERE id = ?').get(spaceId)).members);
  } catch (error) { next(error); }
});

// Adds several people at once with the same project roles. Body: { userIds: [], roles: [] }.
/** Lower-case text without Vietnamese/other diacritics, so "pham" matches "Phạm". */
function searchable(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}

// "Add people" search: active users who are not members yet, matching name, username or email.
// GET /:spaceId/member-candidates?q=anh&limit=8
router.get('/:spaceId/member-candidates', (req, res, next) => {
  try {
    const { spaceId } = req.params;
    if (!canAccessSpace(req.user, spaceId)) return res.status(404).json({ error: 'Space not found.' });
    if (!can(req.user, spaceId, 'project.setting')) return denied(res, 'project.setting');
    const words = searchable(req.query.q).split(/\s+/).filter(Boolean);
    if (!words.length) return res.json([]);
    const limit = Math.min(Math.max(Number(req.query.limit) || 8, 1), 25);
    const memberIds = new Set(db.prepare('SELECT user_id FROM space_members WHERE space_id = ?').all(spaceId).map((row) => row.user_id));
    const owner = db.prepare('SELECT owner_id FROM spaces WHERE id = ?').get(spaceId)?.owner_id;
    if (owner) memberIds.add(owner);
    const rows = db.prepare('SELECT id, username, email, full_name, avatar_url FROM users WHERE is_active = 1 ORDER BY lower(full_name), lower(username)').all();
    const matches = rows
      .filter((user) => !memberIds.has(user.id))
      .filter((user) => {
        const text = searchable(`${user.full_name} ${user.username} ${user.email}`);
        return words.every((word) => text.includes(word));
      })
      .slice(0, limit)
      .map((user) => ({ id: user.id, username: user.username, email: user.email, fullName: user.full_name, avatarUrl: user.avatar_url }));
    res.json(matches);
  } catch (error) { next(error); }
});

router.post('/:spaceId/members/bulk', (req, res, next) => {
  try {
    const spaceId = req.params.spaceId;
    if (!canAccessSpace(req.user, spaceId)) return res.status(404).json({ error: 'Space not found.' });
    if (!can(req.user, spaceId, 'project.setting')) return denied(res, 'project.setting');
    const actorIsProjectAdmin = memberContext(req.user, spaceId).isProjectAdmin;
    const userIds = [...new Set((Array.isArray(req.body?.userIds) ? req.body.userIds : []).map(String))];
    if (!userIds.length) return res.status(400).json({ error: 'Choose at least one person.' });
    if (userIds.length > 200) return res.status(400).json({ error: 'Add at most 200 people at a time.' });
    const { roles, error, status } = readRoles(req.body?.roles, actorIsProjectAdmin);
    if (error) return res.status(status || 400).json({ error });
    const users = [];
    for (const userId of userIds) {
      const user = db.prepare('SELECT id, username, email, full_name FROM users WHERE id = ? AND is_active = 1').get(userId);
      if (!user) return res.status(400).json({ error: 'Only active users can be added.' });
      if (db.prepare('SELECT 1 FROM space_members WHERE space_id = ? AND user_id = ?').get(spaceId, user.id)) {
        return res.status(409).json({ error: `${user.full_name} is already a member of this project.` });
      }
      users.push(user);
    }
    const now = nowIso();
    db.transaction(() => {
      const insert = db.prepare('INSERT INTO space_members (space_id, user_id, member_json, created_at) VALUES (?, ?, ?, ?)');
      users.forEach((user) => insert.run(spaceId, user.id, JSON.stringify(memberRecord(user, roles)), now));
      logActivity({ spaceId, actorName: req.user.fullName || 'You', description: `added ${users.map((user) => user.full_name).join(', ')} as ${roles.join(', ')}` });
    })();
    res.status(201).json(spaceRowToObject(db.prepare('SELECT * FROM spaces WHERE id = ?').get(spaceId)).members);
  } catch (error) { next(error); }
});

router.delete('/:spaceId/members/:userId', (req, res) => {
  const { spaceId, userId } = req.params;
  if (!canAccessSpace(req.user, spaceId)) return res.status(404).json({ error: 'Space not found.' });
  if (!can(req.user, spaceId, 'project.setting')) return denied(res, 'project.setting');
  if (!memberContext(req.user, spaceId).isProjectAdmin && hasAdminRole(spaceId, userId)) return res.status(403).json({ error: 'Only a project admin can remove a project admin.' });
  const owner = db.prepare('SELECT owner_id FROM spaces WHERE id = ?').get(spaceId)?.owner_id;
  if (owner && owner === userId) return res.status(400).json({ error: 'The project owner cannot be removed.' });
  const result = db.prepare('DELETE FROM space_members WHERE space_id = ? AND user_id = ?').run(spaceId, userId);
  if (result.changes) db.prepare('DELETE FROM space_pins WHERE space_id = ? AND user_id = ?').run(spaceId, userId);
  if (!result.changes) return res.status(404).json({ error: 'Member not found.' });
  logActivity({ spaceId, actorName: req.user.fullName || 'You', description: 'removed a member' });
  res.json(spaceRowToObject(db.prepare('SELECT * FROM spaces WHERE id = ?').get(spaceId)).members);
});

// ---- Saved projects (sidebar Spaces) ------------------------------------------------
// Body: { pinned: boolean }. A user saves at most MAX_PINNED_SPACES projects.
router.put('/:spaceId/pin', (req, res) => {
  const { spaceId } = req.params;
  if (!canAccessSpace(req.user, spaceId)) return res.status(404).json({ error: 'Space not found.' });
  if (req.body?.pinned) {
    const already = db.prepare('SELECT 1 FROM space_pins WHERE user_id = ? AND space_id = ?').get(req.user.id, spaceId);
    // Pins of projects the user can no longer open (removed from them) do not count.
    const count = db.prepare('SELECT space_id FROM space_pins WHERE user_id = ?').all(req.user.id)
      .filter((pin) => canAccessSpace(req.user, pin.space_id)).length;
    if (!already && count >= MAX_PINNED_SPACES) {
      return res.status(409).json({ error: `You can save up to ${MAX_PINNED_SPACES} projects. Unstar a saved project first.` });
    }
    db.prepare('INSERT OR IGNORE INTO space_pins (user_id, space_id, created_at) VALUES (?, ?, ?)').run(req.user.id, spaceId, nowIso());
  } else {
    db.prepare('DELETE FROM space_pins WHERE user_id = ? AND space_id = ?').run(req.user.id, spaceId);
  }
  res.json(spaceForUser(db.prepare('SELECT * FROM spaces WHERE id = ?').get(spaceId), req.user));
});

// ---- Project permissions ----------------------------------------------------------
// Members may read the rules; only project admins (Admin Project) may change them.

function permissionsPayload(spaceId, user) {
  const context = memberContext(user, spaceId);
  return {
    groups: PERMISSION_GROUPS,
    rules: projectRules(spaceId),
    roles: db.prepare('SELECT id, name, description, is_system FROM project_roles ORDER BY position, lower(name)').all()
      .map((row) => ({ id: row.id, name: row.name, description: row.description, isSystem: Boolean(row.is_system) })),
    fields: Object.entries(FIELD_RULES).map(([value, field]) => ({ value, ...field })),
    adminRole: ADMIN_PROJECT_ROLE,
    allMemberRole: ALL_MEMBER_ROLE,
    canEdit: context.isProjectAdmin,
    grants: grantsFor(context)
  };
}

router.get('/:spaceId/permissions', (req, res) => {
  if (!canAccessSpace(req.user, req.params.spaceId)) return res.status(404).json({ error: 'Space not found.' });
  res.json(permissionsPayload(req.params.spaceId, req.user));
});

router.put('/:spaceId/permissions/:key', (req, res) => {
  const { spaceId, key } = req.params;
  if (!canAccessSpace(req.user, spaceId)) return res.status(404).json({ error: 'Space not found.' });
  if (!memberContext(req.user, spaceId).isProjectAdmin) return res.status(403).json({ error: 'Only a project admin can change project permissions.' });
  const { rules, error } = validateRules(key, req.body?.rules);
  if (error) return res.status(400).json({ error });
  saveRules(spaceId, key, rules);
  logActivity({ spaceId, actorName: req.user.fullName || 'You', description: `changed the access rules of ${key}` });
  res.json(permissionsPayload(spaceId, req.user));
});

router.post('/:spaceId/permissions/reset', (req, res) => {
  const { spaceId } = req.params;
  if (!canAccessSpace(req.user, spaceId)) return res.status(404).json({ error: 'Space not found.' });
  if (!memberContext(req.user, spaceId).isProjectAdmin) return res.status(403).json({ error: 'Only a project admin can change project permissions.' });
  resetRules(spaceId);
  logActivity({ spaceId, actorName: req.user.fullName || 'You', description: 'reset the project permissions to the defaults' });
  res.json(permissionsPayload(spaceId, req.user));
});

export default router;
