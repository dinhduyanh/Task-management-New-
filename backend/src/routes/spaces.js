import { Router } from 'express';
import { db, createId, nowIso, parseJson, spaceRowToObject, logActivity } from '../db.js';

const router = Router();

router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM spaces ORDER BY created_at DESC').all();
  res.json(rows.map(spaceRowToObject));
});

router.post('/', (req, res, next) => {
  try {
    const body = req.body || {};
    const code = String(body.code || '').trim().toUpperCase();
    const name = String(body.name || '').trim();
    if (!code || !name) return res.status(400).json({ error: 'Code and Name are required.' });

    const id = createId('space');
    const now = nowIso();
    const data = { ...body, id, code, name, taskKeyPrefix: String(body.taskKeyPrefix || code).toUpperCase(), createdAt: now, updatedAt: now };
    db.transaction(() => {
      db.prepare(`INSERT INTO spaces (id, code, task_key_prefix, name, owner_id, visibility, created_at, updated_at, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, code, data.taskKeyPrefix, name, data.ownerId || null, data.visibility || null, now, now, JSON.stringify(data));

      for (const member of (Array.isArray(body.members) ? body.members : [])) {
        const userId = String(member.id || member.userId || member.email || member.username || `member-${createId()}`);
        db.prepare(`INSERT OR REPLACE INTO space_members (space_id, user_id, member_json, created_at) VALUES (?, ?, ?, ?)`)
          .run(id, userId, JSON.stringify(member), now);
      }
      for (const team of (Array.isArray(body.teams) ? body.teams : [])) {
        const teamId = String(team.id || createId('team'));
        db.prepare('INSERT INTO teams (id, space_id, name, data_json, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(teamId, id, String(team.name || team.label || team), JSON.stringify(team), now);
      }
      for (const release of (Array.isArray(body.releases) ? body.releases : [])) {
        const releaseId = String(release.id || createId('release'));
        db.prepare('INSERT INTO releases (id, space_id, name, data_json, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(releaseId, id, String(release.name || release.label || release), JSON.stringify(release), now);
      }
      logActivity({ spaceId: id, actorName: data.createdBy || 'You', description: 'created this space' });
    })();

    res.status(201).json(spaceRowToObject(db.prepare('SELECT * FROM spaces WHERE id = ?').get(id)));
  } catch (error) { next(error); }
});

router.get('/:spaceId', (req, res) => {
  const row = db.prepare('SELECT * FROM spaces WHERE id = ?').get(req.params.spaceId);
  if (!row) return res.status(404).json({ error: 'Space not found.' });
  res.json(spaceRowToObject(row));
});

router.patch('/:spaceId', (req, res, next) => {
  try {
    const current = db.prepare('SELECT * FROM spaces WHERE id = ?').get(req.params.spaceId);
    if (!current) return res.status(404).json({ error: 'Space not found.' });
    const updates = req.body || {};
    const previousData = parseJson(current.data_json, {});
    const safeUpdates = { ...updates };
    delete safeUpdates.teams; // teams have their own API (see routes/teams.js)
    const nextData = { ...previousData, ...safeUpdates, updatedAt: nowIso() };
    const code = String(nextData.code || current.code).trim().toUpperCase();
    const name = String(nextData.name || current.name).trim();
    const prefix = String(nextData.taskKeyPrefix || code).trim().toUpperCase();

    db.transaction(() => {
      db.prepare(`UPDATE spaces SET code = ?, task_key_prefix = ?, name = ?, owner_id = ?, visibility = ?, updated_at = ?, data_json = ? WHERE id = ?`)
        .run(code, prefix, name, nextData.ownerId ?? current.owner_id, nextData.visibility ?? current.visibility, nextData.updatedAt, JSON.stringify(nextData), current.id);

      // Teams are managed through /api/spaces/:spaceId/teams (they keep stable ids that
      // work items reference), so a `teams` array here is ignored.
      if (Array.isArray(updates.releases)) {
        db.prepare('DELETE FROM releases WHERE space_id = ?').run(current.id);
        for (const release of updates.releases) {
          const id = String(release.id || createId('release'));
          db.prepare('INSERT INTO releases (id, space_id, name, data_json, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(id, current.id, String(release.name || release.label || release), JSON.stringify(release), nowIso());
        }
      }
      logActivity({ spaceId: current.id, actorName: 'You', description: `updated ${Object.keys(updates).join(', ') || 'space details'}` });
    })();

    res.json(spaceRowToObject(db.prepare('SELECT * FROM spaces WHERE id = ?').get(current.id)));
  } catch (error) { next(error); }
});

router.delete('/:spaceId', (req, res) => {
  const result = db.prepare('DELETE FROM spaces WHERE id = ?').run(req.params.spaceId);
  if (!result.changes) return res.status(404).json({ error: 'Space not found.' });
  res.status(204).end();
});

router.post('/:spaceId/members', (req, res, next) => {
  try {
    const space = db.prepare('SELECT id FROM spaces WHERE id = ?').get(req.params.spaceId);
    if (!space) return res.status(404).json({ error: 'Space not found.' });
    const { user, roles } = req.body || {};
    if (!user || !Array.isArray(roles) || roles.length === 0) return res.status(400).json({ error: 'User and at least one Role are required.' });
    const userId = String(user.id || user.email || user.username || createId('member'));
    const member = { ...user, id: userId, roles, role: roles.join(', ') };
    db.prepare(`INSERT OR REPLACE INTO space_members (space_id, user_id, member_json, created_at) VALUES (?, ?, ?, ?)`)
      .run(space.id, userId, JSON.stringify(member), nowIso());
    res.status(201).json(spaceRowToObject(db.prepare('SELECT * FROM spaces WHERE id = ?').get(space.id)).members);
  } catch (error) { next(error); }
});

export default router;
