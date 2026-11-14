// Sprints of a Space and the sprint lifecycle (future -> active -> completed).
// Work items belong to a sprint through data_json.sprintId; no sprintId = Product Backlog.
import { Router } from 'express';
import { db, createId, nowIso, logActivity } from '../db.js';
import { requireSpaceAccess, spaceIdOf } from '../access.js';

const router = Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COMPLETED_STATUS_RE = /done|complete|closed|resolved|cancel|reject/i;

export function sprintRowToObject(row) {
  if (!row) return null;
  return {
    id: row.id,
    spaceId: row.space_id,
    name: row.name,
    goal: row.goal,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at
  };
}

function getSprint(id) {
  return db.prepare('SELECT * FROM sprints WHERE id = ?').get(String(id));
}

function sprintItems(sprintId) {
  return db.prepare("SELECT id, status, data_json FROM work_items WHERE json_extract(data_json, '$.sprintId') = ?").all(sprintId);
}

/** Validates name/goal/dates from a request body. Returns { values } or { error }. */
function readSprintFields(body, current = {}) {
  const values = {};
  if (body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (!name) return { error: 'Sprint name is required.' };
    if (name.length > 80) return { error: 'Sprint name must be 80 characters or fewer.' };
    values.name = name;
  }
  if (body.goal !== undefined) {
    const goal = String(body.goal || '').trim();
    if (goal.length > 500) return { error: 'Sprint goal must be 500 characters or fewer.' };
    values.goal = goal;
  }
  for (const [key, column] of [['startDate', 'start_date'], ['endDate', 'end_date']]) {
    if (body[key] === undefined) continue;
    const value = body[key] ? String(body[key]) : null;
    if (value && !DATE_RE.test(value)) return { error: `${key === 'startDate' ? 'Start' : 'End'} date must be YYYY-MM-DD.` };
    values[column] = value;
  }
  const start = values.start_date !== undefined ? values.start_date : current.start_date;
  const end = values.end_date !== undefined ? values.end_date : current.end_date;
  if (start && end && end < start) return { error: 'End date cannot be earlier than the start date.' };
  return { values };
}

function updateSprint(id, values) {
  const entries = Object.entries(values).filter(([, value]) => value !== undefined);
  if (!entries.length) return;
  const sets = entries.map(([column]) => `${column} = ?`).join(', ');
  db.prepare(`UPDATE sprints SET ${sets}, updated_at = ? WHERE id = ?`).run(...entries.map(([, value]) => value), nowIso(), id);
}

function nextSprintName(space) {
  const prefix = space.code || 'Sprint';
  const names = db.prepare('SELECT name FROM sprints WHERE space_id = ?').all(space.id).map((row) => row.name);
  let number = names.length + 1;
  while (names.includes(`${prefix} Sprint ${number}`)) number += 1;
  return `${prefix} Sprint ${number}`;
}

function createSprint(space, name) {
  const id = createId('sprint');
  const now = nowIso();
  const position = (db.prepare('SELECT MAX(position) AS max FROM sprints WHERE space_id = ?').get(space.id).max ?? -1) + 1;
  db.prepare(`INSERT INTO sprints (id, space_id, name, goal, status, position, created_at, updated_at)
    VALUES (?, ?, ?, '', 'future', ?, ?, ?)`).run(id, space.id, name || nextSprintName(space), position, now, now);
  return getSprint(id);
}

/** Moves work items to a sprint (or the Space's backlog when sprintId is null), after its last rank. */
function moveItemsTo(spaceId, itemIds, sprintId) {
  const ranks = sprintId
    ? db.prepare("SELECT MAX(CAST(json_extract(data_json, '$.rank') AS REAL)) AS max FROM work_items WHERE json_extract(data_json, '$.sprintId') = ?").get(sprintId)
    : db.prepare("SELECT MAX(CAST(json_extract(data_json, '$.rank') AS REAL)) AS max FROM work_items WHERE space_id = ? AND json_extract(data_json, '$.sprintId') IS NULL").get(spaceId);
  let rank = (ranks.max ?? -1) + 1;
  const update = db.prepare("UPDATE work_items SET data_json = json_set(data_json, '$.sprintId', json(?), '$.rank', ?), updated_at = ? WHERE id = ?");
  const now = nowIso();
  itemIds.forEach((id) => { update.run(JSON.stringify(sprintId ?? null), rank, now, id); rank += 1; });
}

const sprintAccess = requireSpaceAccess((req) => spaceIdOf.sprint(req.params.id), 'Sprint not found.');

router.get('/spaces/:spaceId/sprints', requireSpaceAccess((req) => req.params.spaceId, 'Space not found.'), (req, res) => {
  const rows = db.prepare(`SELECT * FROM sprints WHERE space_id = ?
    ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'future' THEN 1 ELSE 2 END, position, created_at`).all(req.params.spaceId);
  res.json(rows.map(sprintRowToObject));
});

router.post('/spaces/:spaceId/sprints', requireSpaceAccess((req) => req.params.spaceId, 'Space not found.'), (req, res, next) => {
  try {
    const space = db.prepare('SELECT id, code FROM spaces WHERE id = ?').get(req.params.spaceId);
    if (!space) return res.status(404).json({ error: 'Space not found.' });
    const { values, error } = readSprintFields(req.body || {});
    if (error) return res.status(400).json({ error });
    const sprint = db.transaction(() => {
      const created = createSprint(space, values.name);
      updateSprint(created.id, { ...values, name: undefined });
      logActivity({ spaceId: space.id, description: `created sprint ${created.name}` });
      return getSprint(created.id);
    })();
    res.status(201).json(sprintRowToObject(sprint));
  } catch (error) { next(error); }
});

router.patch('/sprints/:id', sprintAccess, (req, res, next) => {
  try {
    const sprint = getSprint(req.params.id);
    if (!sprint) return res.status(404).json({ error: 'Sprint not found.' });
    if (sprint.status === 'completed') return res.status(400).json({ error: 'A completed sprint cannot be edited.' });
    const { values, error } = readSprintFields(req.body || {}, sprint);
    if (error) return res.status(400).json({ error });
    updateSprint(sprint.id, values);
    res.json(sprintRowToObject(getSprint(sprint.id)));
  } catch (error) { next(error); }
});

router.post('/sprints/:id/start', sprintAccess, (req, res, next) => {
  try {
    const sprint = getSprint(req.params.id);
    if (!sprint) return res.status(404).json({ error: 'Sprint not found.' });
    if (sprint.status !== 'future') return res.status(400).json({ error: 'Only a future sprint can be started.' });
    const active = db.prepare("SELECT name FROM sprints WHERE space_id = ? AND status = 'active'").get(sprint.space_id);
    if (active) return res.status(409).json({ error: `Complete "${active.name}" before starting another sprint.` });
    if (!sprintItems(sprint.id).length) return res.status(400).json({ error: 'Add at least one work item before starting the sprint.' });
    const { values, error } = readSprintFields(req.body || {}, sprint);
    if (error) return res.status(400).json({ error });
    const start = values.start_date ?? sprint.start_date;
    const end = values.end_date ?? sprint.end_date;
    if (!start || !end) return res.status(400).json({ error: 'Start and end dates are required to start a sprint.' });
    db.transaction(() => {
      updateSprint(sprint.id, { ...values, status: 'active' });
      logActivity({ spaceId: sprint.space_id, description: `started sprint ${values.name || sprint.name}` });
    })();
    res.json(sprintRowToObject(getSprint(sprint.id)));
  } catch (error) { next(error); }
});

// Body: { moveTo: 'backlog' | 'new' | <future sprint id> } for the work items that are not done.
router.post('/sprints/:id/complete', sprintAccess, (req, res, next) => {
  try {
    const sprint = getSprint(req.params.id);
    if (!sprint) return res.status(404).json({ error: 'Sprint not found.' });
    if (sprint.status !== 'active') return res.status(400).json({ error: 'Only the active sprint can be completed.' });
    const moveTo = String(req.body?.moveTo || 'backlog');
    let target = null;
    if (moveTo !== 'backlog' && moveTo !== 'new') {
      target = getSprint(moveTo);
      if (!target || target.space_id !== sprint.space_id || target.status !== 'future') {
        return res.status(400).json({ error: 'Open work items can only move to the backlog or a future sprint of this Space.' });
      }
    }
    const items = sprintItems(sprint.id);
    const openIds = items.filter((item) => !COMPLETED_STATUS_RE.test(item.status)).map((item) => item.id);
    const result = db.transaction(() => {
      if (moveTo === 'new') {
        const space = db.prepare('SELECT id, code FROM spaces WHERE id = ?').get(sprint.space_id);
        target = createSprint(space);
      }
      moveItemsTo(sprint.space_id, openIds, target ? target.id : null);
      updateSprint(sprint.id, { status: 'completed', completed_at: nowIso() });
      logActivity({ spaceId: sprint.space_id, description: `completed sprint ${sprint.name}` });
      return { completedCount: items.length - openIds.length, movedCount: openIds.length };
    })();
    res.json({
      sprint: sprintRowToObject(getSprint(sprint.id)),
      target: target ? sprintRowToObject(getSprint(target.id)) : null,
      ...result
    });
  } catch (error) { next(error); }
});

// Deleting a sprint keeps its work items: they return to the backlog.
router.delete('/sprints/:id', sprintAccess, (req, res, next) => {
  try {
    const sprint = getSprint(req.params.id);
    if (!sprint) return res.status(404).json({ error: 'Sprint not found.' });
    if (sprint.status === 'completed') return res.status(400).json({ error: 'A completed sprint cannot be deleted.' });
    db.transaction(() => {
      moveItemsTo(sprint.space_id, sprintItems(sprint.id).map((item) => item.id), null);
      db.prepare('DELETE FROM sprints WHERE id = ?').run(sprint.id);
      logActivity({ spaceId: sprint.space_id, description: `deleted sprint ${sprint.name}` });
    })();
    res.status(204).end();
  } catch (error) { next(error); }
});

export default router;
