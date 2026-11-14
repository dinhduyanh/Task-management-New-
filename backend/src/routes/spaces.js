import { Router } from 'express';
import { db, createId, nowIso, parseJson, spaceRowToObject, logActivity } from '../db.js';
import { canAccessSpace, canManageSpace, spaceFilter } from '../access.js';

const router = Router();

/** Space as returned to a user, with what that user may do in it. */
function spaceForUser(row, user) {
  const space = spaceRowToObject(row);
  return {
    ...space,
    permissions: {
      manage: canManageSpace(user, row.id) // members, deletion
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

/** Validates project role names against the roles managed in System Settings. */
function readRoles(value) {
  const names = (Array.isArray(value) ? value : []).map((role) => String(role || '').trim()).filter(Boolean);
  if (!names.length) return { error: 'Choose at least one project role.' };
  const known = db.prepare('SELECT name FROM project_roles').all().map((row) => row.name);
  const roles = [];
  for (const name of names) {
    const match = known.find((role) => role.toLowerCase() === name.toLowerCase());
    if (!match) return { error: `Unknown project role: ${name}.` };
    if (!roles.includes(match)) roles.push(match);
  }
  return { roles };
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
    const creatorRole = db.prepare("SELECT name FROM project_roles WHERE name = 'Project Manager' COLLATE NOCASE").get()?.name
      || db.prepare('SELECT name FROM project_roles ORDER BY position LIMIT 1').get()?.name || 'Owner';
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
    const current = db.prepare('SELECT * FROM spaces WHERE id = ?').get(req.params.spaceId);
    const updates = req.body || {};
    const previousData = parseJson(current.data_json, {});
    const safeUpdates = { ...updates };
    delete safeUpdates.teams; // teams have their own API (see routes/teams.js)
    delete safeUpdates.members; // members have their own endpoints below
    delete safeUpdates.ownerId; // ownership is not changed through settings
    delete safeUpdates.owner;
    delete safeUpdates.permissions;
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
    if (!canManageSpace(req.user, spaceId)) return res.status(403).json({ error: 'Only the project owner or an administrator can manage members.' });
    const userId = String(req.body?.userId || req.body?.user?.id || '');
    const user = db.prepare('SELECT id, username, email, full_name FROM users WHERE id = ? AND is_active = 1').get(userId);
    if (!user) return res.status(400).json({ error: 'Choose an active user.' });
    const { roles, error } = readRoles(req.body?.roles);
    if (error) return res.status(400).json({ error });
    const existing = db.prepare('SELECT created_at FROM space_members WHERE space_id = ? AND user_id = ?').get(spaceId, user.id);
    db.prepare('INSERT OR REPLACE INTO space_members (space_id, user_id, member_json, created_at) VALUES (?, ?, ?, ?)')
      .run(spaceId, user.id, JSON.stringify(memberRecord(user, roles)), existing?.created_at || nowIso());
    logActivity({ spaceId, actorName: req.user.fullName || 'You', description: `${existing ? 'updated' : 'added'} member ${user.full_name}` });
    res.status(existing ? 200 : 201).json(spaceRowToObject(db.prepare('SELECT * FROM spaces WHERE id = ?').get(spaceId)).members);
  } catch (error) { next(error); }
});

router.delete('/:spaceId/members/:userId', (req, res) => {
  const { spaceId, userId } = req.params;
  if (!canAccessSpace(req.user, spaceId)) return res.status(404).json({ error: 'Space not found.' });
  if (!canManageSpace(req.user, spaceId)) return res.status(403).json({ error: 'Only the project owner or an administrator can manage members.' });
  const owner = db.prepare('SELECT owner_id FROM spaces WHERE id = ?').get(spaceId)?.owner_id;
  if (owner && owner === userId) return res.status(400).json({ error: 'The project owner cannot be removed.' });
  const result = db.prepare('DELETE FROM space_members WHERE space_id = ? AND user_id = ?').run(spaceId, userId);
  if (!result.changes) return res.status(404).json({ error: 'Member not found.' });
  logActivity({ spaceId, actorName: req.user.fullName || 'You', description: 'removed a member' });
  res.json(spaceRowToObject(db.prepare('SELECT * FROM spaces WHERE id = ?').get(spaceId)).members);
});

export default router;
