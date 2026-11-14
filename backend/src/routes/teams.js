// Project teams. Every team belongs to exactly one Space and is only visible there.
// Members come from the users table; each team has exactly one lead.
import { Router } from 'express';
import { db, createId, nowIso, parseJson, logActivity } from '../db.js';
import { optionalAuth } from '../middleware/auth.js';
import { requireSpaceAccess, spaceIdOf } from '../access.js';

const router = Router();
router.use(optionalAuth);

const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/;
const STATUSES = new Set(['active', 'inactive']);

function teamMembers(teamId) {
  return db.prepare(`SELECT tm.user_id, tm.role, u.username, u.email, u.full_name, u.avatar_url
    FROM team_members tm JOIN users u ON u.id = tm.user_id
    WHERE tm.team_id = ? ORDER BY CASE tm.role WHEN 'lead' THEN 0 ELSE 1 END, lower(u.full_name)`).all(teamId)
    .map((row) => ({
      id: row.user_id,
      username: row.username,
      email: row.email,
      fullName: row.full_name,
      name: row.full_name,
      avatarUrl: row.avatar_url,
      role: row.role
    }));
}

function teamRowToObject(row) {
  const data = parseJson(row.data_json, {});
  const members = teamMembers(row.id);
  const issueCount = db.prepare('SELECT COUNT(*) AS count FROM work_items WHERE team_id = ?').get(row.id).count;
  return {
    ...data,
    id: row.id,
    spaceId: row.space_id,
    name: row.name,
    code: data.code || '',
    unit: data.unit || '',
    description: data.description || '',
    status: data.status === 'inactive' ? 'inactive' : 'active',
    creator: data.creator || null,
    createdAt: row.created_at,
    lead: members.find((member) => member.role === 'lead') || null,
    members,
    memberCount: members.length,
    issueCount
  };
}

function getTeamRow(id) {
  return db.prepare('SELECT * FROM teams WHERE id = ?').get(String(id));
}

/**
 * Validates a create/update body. `current` is the existing row on update.
 * Returns { values, members } or { error, status }.
 */
function readTeam(body, spaceId, current = null) {
  const data = current ? parseJson(current.data_json, {}) : {};
  const values = {};
  if (!current || body.code !== undefined) {
    const code = String(body.code || '').trim().toUpperCase();
    if (!code) return { error: 'Code is required.' };
    if (!CODE_RE.test(code)) return { error: 'Code must be 1-20 letters, numbers, "-" or "_", starting with a letter or number.' };
    const clash = db.prepare(`SELECT id FROM teams WHERE space_id = ? AND upper(json_extract(data_json, '$.code')) = ? AND id <> ?`)
      .get(spaceId, code, current?.id || '');
    if (clash) return { error: `A team with code ${code} already exists in this project.`, status: 409 };
    values.code = code;
  }
  if (!current || body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (!name) return { error: 'Name is required.' };
    if (name.length > 100) return { error: 'Name must be 100 characters or fewer.' };
    values.name = name;
  }
  if (body.unit !== undefined) {
    const unit = String(body.unit || '').trim();
    if (unit.length > 100) return { error: 'Unit must be 100 characters or fewer.' };
    values.unit = unit;
  }
  if (body.description !== undefined) {
    const description = String(body.description || '').trim();
    if (description.length > 1000) return { error: 'Description must be 1000 characters or fewer.' };
    values.description = description;
  }
  if (body.status !== undefined) {
    if (!STATUSES.has(body.status)) return { error: 'Status must be active or inactive.' };
    values.status = body.status;
  }

  let members = null;
  if (!current || body.members !== undefined) {
    const list = Array.isArray(body.members) ? body.members : [];
    const seen = new Set();
    members = [];
    for (const entry of list) {
      const userId = String(entry?.userId || entry?.id || '');
      if (!userId || seen.has(userId)) continue;
      seen.add(userId);
      const user = db.prepare('SELECT id FROM users WHERE id = ? AND is_active = 1').get(userId);
      if (!user) return { error: 'One of the selected members is not an active user.' };
      members.push({ userId, role: entry.role === 'lead' ? 'lead' : 'member' });
    }
    if (!members.length) return { error: 'Select at least one member.' };
    const leads = members.filter((member) => member.role === 'lead').length;
    if (leads !== 1) return { error: 'Choose exactly one team lead.' };
  }
  return { values, members, data };
}

function saveMembers(teamId, members) {
  db.prepare('DELETE FROM team_members WHERE team_id = ?').run(teamId);
  const insert = db.prepare('INSERT INTO team_members (team_id, user_id, role, created_at) VALUES (?, ?, ?, ?)');
  const now = nowIso();
  members.forEach((member) => insert.run(teamId, member.userId, member.role, now));
}

const teamAccess = requireSpaceAccess((req) => spaceIdOf.team(req.params.id), 'Team not found.');

router.get('/spaces/:spaceId/teams', requireSpaceAccess((req) => req.params.spaceId, 'Space not found.'), (req, res) => {
  const rows = db.prepare('SELECT * FROM teams WHERE space_id = ? ORDER BY created_at DESC').all(req.params.spaceId);
  res.json(rows.map(teamRowToObject));
});

router.post('/spaces/:spaceId/teams', requireSpaceAccess((req) => req.params.spaceId, 'Space not found.'), (req, res, next) => {
  try {
    const space = db.prepare('SELECT id FROM spaces WHERE id = ?').get(req.params.spaceId);
    if (!space) return res.status(404).json({ error: 'Space not found.' });
    const result = readTeam(req.body || {}, space.id);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    const { values, members } = result;
    const id = createId('team');
    const now = nowIso();
    const creator = req.user ? { id: req.user.id, name: req.user.fullName || req.user.username } : null;
    const data = {
      code: values.code,
      unit: values.unit || '',
      description: values.description || '',
      status: 'active',
      creator
    };
    db.transaction(() => {
      db.prepare('INSERT INTO teams (id, space_id, name, data_json, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, space.id, values.name, JSON.stringify(data), now);
      saveMembers(id, members);
      logActivity({ spaceId: space.id, actorName: creator?.name || 'You', description: `created team ${values.code} ${values.name}` });
    })();
    res.status(201).json(teamRowToObject(getTeamRow(id)));
  } catch (error) { next(error); }
});

router.patch('/teams/:id', teamAccess, (req, res, next) => {
  try {
    const row = getTeamRow(req.params.id);
    if (!row) return res.status(404).json({ error: 'Team not found.' });
    const result = readTeam(req.body || {}, row.space_id, row);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    const { values, members, data } = result;
    const { name, ...rest } = values;
    db.transaction(() => {
      db.prepare('UPDATE teams SET name = ?, data_json = ? WHERE id = ?')
        .run(name ?? row.name, JSON.stringify({ ...data, ...rest, updatedAt: nowIso() }), row.id);
      if (members) saveMembers(row.id, members);
      logActivity({ spaceId: row.space_id, actorName: req.user?.fullName || 'You', description: `updated team ${rest.code || data.code || row.name}` });
    })();
    res.json(teamRowToObject(getTeamRow(row.id)));
  } catch (error) { next(error); }
});

// Deleting a team removes it from its work items (they are kept).
router.delete('/teams/:id', teamAccess, (req, res, next) => {
  try {
    const row = getTeamRow(req.params.id);
    if (!row) return res.status(404).json({ error: 'Team not found.' });
    db.transaction(() => {
      db.prepare(`UPDATE work_items SET team_id = NULL,
        data_json = json_remove(data_json, '$.team', '$.teamId') WHERE team_id = ?`).run(row.id);
      db.prepare('DELETE FROM teams WHERE id = ?').run(row.id);
      logActivity({ spaceId: row.space_id, actorName: req.user?.fullName || 'You', description: `deleted team ${row.name}` });
    })();
    res.status(204).end();
  } catch (error) { next(error); }
});

export default router;
