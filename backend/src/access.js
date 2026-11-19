// Who may see and change which project (Space).
//   admin -> every project.
//   user  -> projects they own (spaces.owner_id) or are a member of (space_members.user_id).
// Routes answer 404 for projects a user cannot access, so their existence is not revealed.
import { db } from './db.js';

export function isAdmin(user) {
  return user?.role === 'admin';
}

export function canAccessSpace(user, spaceId) {
  if (!user || !spaceId) return false;
  if (isAdmin(user)) return Boolean(db.prepare('SELECT 1 FROM spaces WHERE id = ?').get(String(spaceId)));
  return Boolean(db.prepare(`SELECT 1 FROM spaces s
    WHERE s.id = ? AND (s.owner_id = ? OR EXISTS (SELECT 1 FROM space_members m WHERE m.space_id = s.id AND m.user_id = ?))`)
    .get(String(spaceId), user.id, user.id));
}

/** Owners and admins manage members and may delete the project. */
export function canManageSpace(user, spaceId) {
  if (!user || !spaceId) return false;
  if (isAdmin(user)) return canAccessSpace(user, spaceId);
  return Boolean(db.prepare('SELECT 1 FROM spaces WHERE id = ? AND owner_id = ?').get(String(spaceId), user.id));
}

/** null = no restriction (admin); otherwise the ids of the projects the user can access. */
export function accessibleSpaceIds(user) {
  if (isAdmin(user)) return null;
  if (!user) return [];
  return db.prepare(`SELECT s.id FROM spaces s
    WHERE s.owner_id = ? OR EXISTS (SELECT 1 FROM space_members m WHERE m.space_id = s.id AND m.user_id = ?)`)
    .all(user.id, user.id).map((row) => row.id);
}

/** SQL fragment + params restricting `column` (a space id column) to the user's projects. */
export function spaceFilter(user, column) {
  const ids = accessibleSpaceIds(user);
  if (ids === null) return { sql: '1 = 1', params: [] };
  if (!ids.length) return { sql: '1 = 0', params: [] };
  return { sql: `${column} IN (${ids.map(() => '?').join(',')})`, params: ids };
}

export const spaceIdOf = {
  workItem: (id) => db.prepare('SELECT space_id FROM work_items WHERE id = ?').get(String(id))?.space_id || null,
  sprint: (id) => db.prepare('SELECT space_id FROM sprints WHERE id = ?').get(String(id))?.space_id || null,
  team: (id) => db.prepare('SELECT space_id FROM teams WHERE id = ?').get(String(id))?.space_id || null,
  file: (id) => db.prepare('SELECT space_id FROM work_item_files WHERE id = ?').get(String(id))?.space_id || null
};

/**
 * Middleware: resolve the project of the requested resource and reject (404) users who
 * cannot access it. `resolve(req)` returns a space id or null (unknown resource -> 404).
 */
export function requireSpaceAccess(resolve, notFound = 'Not found.') {
  return (req, res, next) => {
    const spaceId = resolve(req);
    if (!spaceId || !canAccessSpace(req.user, spaceId)) return res.status(404).json({ error: notFound });
    next();
  };
}
