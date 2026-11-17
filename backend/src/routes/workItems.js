import { Router } from 'express';
import { db, createId, nowIso, parseJson, logActivity } from '../db.js';
import { initialStatus, normalizeIssueType, workflowForIssueType } from '../workflows.js';
import { mergeAttachmentList } from './attachments.js';
import { canAccessSpace, requireSpaceAccess, spaceFilter, spaceIdOf } from '../access.js';
import { allowed, presentItem, reviewItemCreate, reviewItemUpdate, userRecord } from '../workItemPermissions.js';
import { denied } from '../projectPermissions.js';

const router = Router();

const PARENT_TYPES_BY_CHILD = {
  Story: ['Epic', 'Feature'],
  Task: ['Epic', 'Feature'],
  Bug: ['Epic', 'Feature', 'Task'],
  Improvement: ['Epic', 'Feature'],
  'Sub-task': ['Story', 'Task', 'Bug', 'Improvement']
};

function issueTypeOf(item) { return normalizeIssueType(item.issueType || item.type || 'Task'); }
function nextKey(space) {
  const prefix = String(space.task_key_prefix || space.code || 'TASK').toUpperCase();
  const rows = db.prepare('SELECT issue_key FROM work_items WHERE space_id = ?').all(space.id);
  const numbers = rows.map(({ issue_key }) => {
    const value = String(issue_key || '').toUpperCase();
    const marker = `${prefix}-`;
    if (!value.startsWith(marker)) return 0;
    const suffix = value.slice(marker.length);
    return /^\d+$/.test(suffix) ? Number(suffix) : 0;
  });
  return `${prefix}-${Math.max(0, ...numbers) + 1}`;
}

/** Error message when sprintId cannot hold work items of this Space, '' when valid (null = backlog). */
function sprintError(spaceId, sprintId) {
  if (sprintId === null || sprintId === undefined || sprintId === '') return '';
  const sprint = db.prepare('SELECT space_id, status FROM sprints WHERE id = ?').get(String(sprintId));
  if (!sprint || sprint.space_id !== spaceId) return 'Sprint not found in this Space.';
  if (sprint.status === 'completed') return 'Work items cannot be added to a completed sprint.';
  return '';
}

function nextRank(spaceId, sprintId) {
  const row = sprintId
    ? db.prepare("SELECT MAX(CAST(json_extract(data_json, '$.rank') AS REAL)) AS max FROM work_items WHERE json_extract(data_json, '$.sprintId') = ?").get(String(sprintId))
    : db.prepare("SELECT MAX(CAST(json_extract(data_json, '$.rank') AS REAL)) AS max FROM work_items WHERE space_id = ? AND json_extract(data_json, '$.sprintId') IS NULL").get(spaceId);
  return (row.max ?? -1) + 1;
}

function syncLinks(workItemId, links) {
  db.prepare('DELETE FROM work_item_links WHERE source_work_item_id = ?').run(workItemId);
  for (const link of Array.isArray(links) ? links : []) {
    const targetId = String(link.issueId || link.targetId || '');
    if (!targetId || targetId === workItemId) continue;
    const exists = db.prepare('SELECT id FROM work_items WHERE id = ?').get(targetId);
    if (!exists) continue;
    db.prepare(`INSERT INTO work_item_links (id, source_work_item_id, target_work_item_id, link_type, created_at)
      VALUES (?, ?, ?, ?, ?)`)
      .run(createId('link'), workItemId, targetId, String(link.type || 'Relates to'), nowIso());
  }
}

/** Rows for the given ids, or an error status when any is missing or not accessible. */
function accessibleItems(req, ids) {
  const rows = ids.map((id) => db.prepare('SELECT * FROM work_items WHERE id = ?').get(id));
  if (rows.some((row) => !row || !canAccessSpace(req.user, row.space_id))) return null;
  return rows;
}

const itemAccess = requireSpaceAccess((req) => spaceIdOf.workItem(req.params.id), 'Work item not found.');

router.get('/', (req, res) => {
  if (req.query.spaceId && !canAccessSpace(req.user, String(req.query.spaceId))) return res.json([]);
  const filter = spaceFilter(req.user, 'space_id');
  const rows = req.query.spaceId
    ? db.prepare('SELECT * FROM work_items WHERE space_id = ? ORDER BY created_at DESC').all(String(req.query.spaceId))
    : db.prepare(`SELECT * FROM work_items WHERE ${filter.sql} ORDER BY created_at DESC`).all(...filter.params);
  res.json(rows.map((row) => presentItem(req, row)));
});

router.get('/search', (req, res) => {
  const key = String(req.query.key || '').trim();
  if (!key) return res.json([]);
  const filter = spaceFilter(req.user, 'wi.space_id');
  const rows = db.prepare(`SELECT wi.*, s.name AS space_name, s.code AS space_code
    FROM work_items wi JOIN spaces s ON s.id = wi.space_id
    WHERE lower(wi.issue_key) = lower(?) AND ${filter.sql} ORDER BY s.name`).all(key, ...filter.params);
  res.json(rows.map((row) => ({ ...presentItem(req, row), spaceName: row.space_name, spaceCode: row.space_code })));
});

// Moves work items into a sprint (or the backlog with sprintId null) and sets their order.
// Body: { sprintId, ids } where ids is the complete new order of that sprint/backlog.
router.post('/rank', (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(String))] : [];
    const sprintId = req.body?.sprintId ? String(req.body.sprintId) : null;
    if (!ids.length) return res.status(400).json({ error: 'At least one Work Item ID is required.' });
    const rows = accessibleItems(req, ids);
    if (!rows) return res.status(404).json({ error: 'Work item not found.' });
    const spaceId = rows[0].space_id;
    if (rows.some((row) => row.space_id !== spaceId)) return res.status(400).json({ error: 'Work items must belong to the same Space.' });
    const error = sprintError(spaceId, sprintId);
    if (error) return res.status(400).json({ error });
    if (rows.some((row) => !allowed(req, spaceId, 'task.move', row))) return denied(res, 'task.move');
    const now = nowIso();
    const update = db.prepare("UPDATE work_items SET data_json = json_set(data_json, '$.sprintId', json(?), '$.rank', ?, '$.updatedAt', ?), updated_at = ? WHERE id = ?");
    db.transaction(() => ids.forEach((id, index) => update.run(JSON.stringify(sprintId), index, now, now, id)))();
    res.json(ids.map((id) => presentItem(req, db.prepare('SELECT * FROM work_items WHERE id = ?').get(id))));
  } catch (error) { next(error); }
});

router.post('/', (req, res, next) => {
  try {
    const body = req.body || {};
    const spaceId = String(body.spaceId || body.projectId || '');
    const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(spaceId);
    if (!space || !canAccessSpace(req.user, space.id)) return res.status(400).json({ error: 'A valid Project/Space is required.' });
    const issueType = issueTypeOf(body);
    const title = String(body.title || body.summary || '').trim();
    if (!title) return res.status(400).json({ error: 'Title is required.' });
    // A clone names its source (cloneOf) and needs "Clone task" on it instead of "Create task".
    const source = body.cloneOf ? db.prepare('SELECT * FROM work_items WHERE id = ?').get(String(body.cloneOf)) : null;
    if (body.cloneOf && (!source || source.space_id !== spaceId)) return res.status(400).json({ error: 'The work item to clone was not found in this Project/Space.' });
    const refusal = reviewItemCreate(req, spaceId, body, source);
    if (refusal) return res.status(refusal.status).json({ error: refusal.error, permission: refusal.permission });
    const creator = userRecord(req.user);

    const parentId = body.parentId || body.parent?.id || null;
    if (issueType === 'Sub-task' && !parentId) return res.status(400).json({ error: 'Parent is required for a Sub-task.' });
    if (parentId) {
      const parent = db.prepare('SELECT id, space_id, issue_type FROM work_items WHERE id = ?').get(String(parentId));
      if (!parent) return res.status(400).json({ error: 'Selected Parent does not exist.' });
      if (parent.space_id !== spaceId) return res.status(400).json({ error: 'Parent must belong to the selected Project/Space.' });
      const allowedParents = PARENT_TYPES_BY_CHILD[issueType] || [];
      if (allowedParents.length && !allowedParents.includes(parent.issue_type)) {
        return res.status(400).json({ error: `A ${issueType} cannot use a ${parent.issue_type} as Parent.` });
      }
    }

    const sprintId = body.sprintId ? String(body.sprintId) : null;
    const sprintProblem = sprintError(space.id, sprintId);
    if (sprintProblem) return res.status(400).json({ error: sprintProblem });

    const id = createId('issue');
    const key = nextKey(space);
    const now = nowIso();
    const status = String(body.status || initialStatus(issueType));
    const data = {
      ...body,
      cloneOf: undefined,
      assignee: body.assignee && typeof body.assignee === 'object' ? { ...body.assignee, isCurrentUser: undefined } : (body.assignee ?? null),
      // The creator is always the signed-in user; comments and work logs start empty.
      creator, creatorId: creator.id,
      comments: [], workLogs: [],
      id, key, code: key,
      title, summary: title,
      type: issueType, issueType,
      priority: body.priority || 'Medium',
      status,
      spaceId, projectId: spaceId,
      spaceCode: space.code,
      parentId,
      sprintId,
      rank: nextRank(space.id, sprintId),
      // Files are uploaded separately (POST /work-items/:id/attachments) once the item exists.
      attachments: mergeAttachmentList(id, body.attachments),
      createdAt: now, updatedAt: now
    };

    db.transaction(() => {
      db.prepare(`INSERT INTO work_items
        (id, space_id, issue_key, issue_type, title, status, priority, parent_id, assignee_id, creator_id, team_id, release_id, labels_json, start_date, due_date, created_at, updated_at, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, spaceId, key, issueType, title, status, data.priority, parentId,
          body.assignee?.id || body.assigneeId || null,
          creator.id,
          body.team?.id || body.teamId || null,
          body.release?.id || body.releaseId || null,
          JSON.stringify(Array.isArray(body.labels) ? body.labels : []),
          body.startDate || null, body.dueDate || null, now, now, JSON.stringify(data));
      syncLinks(id, body.links);
      db.prepare(`INSERT INTO work_item_status_history (id, work_item_id, from_status, to_status, actor_name, created_at)
        VALUES (?, ?, NULL, ?, ?, ?)`)
        .run(createId('status'), id, status, creator.fullName, now);
      logActivity({ spaceId, workItemId: id, actorName: creator.fullName, description: `created ${issueType} ${key}` });
    })();

    res.status(201).json(presentItem(req, db.prepare('SELECT * FROM work_items WHERE id = ?').get(id)));
  } catch (error) { next(error); }
});

router.get('/:id', itemAccess, (req, res) => {
  const row = db.prepare('SELECT * FROM work_items WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Work item not found.' });
  res.json(presentItem(req, row));
});

router.patch('/:id', itemAccess, (req, res, next) => {
  try {
    const row = db.prepare('SELECT * FROM work_items WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Work item not found.' });
    const review = reviewItemUpdate(req, row, req.body);
    if (review.error) return res.status(review.status).json({ error: review.error, permission: review.permission });
    const updates = review.updates;
    const currentData = parseJson(row.data_json, {});
    const nextData = { ...currentData, ...updates, updatedAt: nowIso() };
    const title = String(nextData.title || nextData.summary || row.title).trim();
    const status = String(nextData.status || row.status);
    const priority = String(nextData.priority || row.priority);
    const parentId = nextData.parentId ?? nextData.parent?.id ?? null;
    // Stored files are owned by the attachments table; a client may only drop legacy entries.
    if (Object.prototype.hasOwnProperty.call(updates, 'attachments')) {
      nextData.attachments = mergeAttachmentList(row.id, updates.attachments);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'sprintId')) {
      const sprintProblem = sprintError(row.space_id, updates.sprintId);
      if (sprintProblem) return res.status(400).json({ error: sprintProblem });
      nextData.sprintId = updates.sprintId || null;
    }

    // Enforce the approved Issue Type workflow on the server, not only in React.
    if (status !== row.status) {
      const workflow = workflowForIssueType(row.issue_type);
      const allowedTargets = workflow.transitions[row.status] || [];
      if (!allowedTargets.includes(status)) {
        return res.status(400).json({ error: `Transition from ${row.status} to ${status} is not allowed for ${row.issue_type}.` });
      }
      if (status === 'In Progress') {
        const assignee = nextData.assignee || nextData.assigneeId || null;
        const hasAssignee = typeof assignee === 'object'
          ? Boolean(assignee.id || assignee.email || assignee.name || assignee.fullName)
          : Boolean(assignee);
        if (!hasAssignee) return res.status(400).json({ error: 'Select an Assignee before starting this Work Item.' });
      }
      if (status === 'Done' && workflow.completionRequiresChildren) {
        const unfinishedChildren = db.prepare("SELECT COUNT(*) AS count FROM work_items WHERE parent_id = ? AND status <> 'Done'").get(row.id).count;
        if (unfinishedChildren > 0) return res.status(400).json({ error: 'Complete all child Work Items before completing this Epic or Feature.' });
      }
    }
    if (parentId) {
      const parent = db.prepare('SELECT id, space_id, issue_type FROM work_items WHERE id = ?').get(String(parentId));
      if (!parent || parent.space_id !== row.space_id) return res.status(400).json({ error: 'Parent must be an existing Issue in the same Project/Space.' });
      const allowedParents = PARENT_TYPES_BY_CHILD[row.issue_type] || [];
      if (allowedParents.length && !allowedParents.includes(parent.issue_type)) return res.status(400).json({ error: 'The selected Parent has an incompatible Issue Type.' });
    }

    db.transaction(() => {
      db.prepare(`UPDATE work_items SET title = ?, status = ?, priority = ?, parent_id = ?,
        assignee_id = ?, creator_id = ?, team_id = ?, release_id = ?, labels_json = ?, start_date = ?, due_date = ?, updated_at = ?, data_json = ?
        WHERE id = ?`)
        .run(title, status, priority, parentId,
          nextData.assignee?.id || nextData.assigneeId || null,
          row.creator_id,
          nextData.team?.id || nextData.teamId || null,
          nextData.release?.id || nextData.releaseId || null,
          JSON.stringify(Array.isArray(nextData.labels) ? nextData.labels : []),
          nextData.startDate || null, nextData.dueDate || null, nextData.updatedAt, JSON.stringify(nextData), row.id);
      if (updates.links) syncLinks(row.id, updates.links);
      if (status !== row.status) {
        db.prepare(`INSERT INTO work_item_status_history (id, work_item_id, from_status, to_status, actor_name, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`)
          .run(createId('status'), row.id, row.status, status, req.user.fullName || 'You', nextData.updatedAt);
      }
      logActivity({ spaceId: row.space_id, workItemId: row.id, actorName: req.user.fullName || 'You', description: `updated ${Object.keys(updates).join(', ') || 'work item'}` });
    })();

    res.json(presentItem(req, db.prepare('SELECT * FROM work_items WHERE id = ?').get(row.id)));
  } catch (error) { next(error); }
});

router.delete('/bulk', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  if (!ids.length) return res.status(400).json({ error: 'At least one Work Item ID is required.' });
  const rows = accessibleItems(req, ids);
  if (!rows) return res.status(404).json({ error: 'Work item not found.' });
  if (rows.some((row) => !allowed(req, row.space_id, 'task.delete', row))) return denied(res, 'task.delete');
  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(`DELETE FROM work_items WHERE id IN (${placeholders})`).run(...ids);
  res.json({ deletedCount: result.changes });
});

// Moves work items to another project. Each item gets a key of the target project and
// goes to the end of its backlog; sprint, team and release (project-specific) are cleared.
// Sub-tasks move with their parent; other children left behind lose the parent link.
router.post('/bulk-move', (req, res, next) => {
  try {
    const requested = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(String))] : [];
    const targetSpaceId = String(req.body?.targetSpaceId || '');
    const targetSpace = db.prepare('SELECT * FROM spaces WHERE id = ?').get(targetSpaceId);
    if (!requested.length || !targetSpace || !canAccessSpace(req.user, targetSpace.id)) return res.status(400).json({ error: 'Work Items and a valid target Project are required.' });
    const rows = accessibleItems(req, requested);
    if (!rows) return res.status(404).json({ error: 'Work item not found.' });
    if (rows.some((row) => !allowed(req, row.space_id, 'task.move', row))) return denied(res, 'task.move');
    if (!allowed(req, targetSpace.id, 'task.create')) return denied(res, 'task.create');

    // Add sub-tasks of the moved items (recursively) so they stay with their parent.
    const moving = new Map(rows.filter((row) => row.space_id !== targetSpace.id).map((row) => [row.id, row]));
    if (!moving.size) return res.status(400).json({ error: 'The selected work items are already in this project.' });
    const queue = [...moving.keys()];
    while (queue.length) {
      const parentId = queue.shift();
      for (const child of db.prepare("SELECT * FROM work_items WHERE parent_id = ? AND issue_type = 'Sub-task'").all(parentId)) {
        if (moving.has(child.id)) continue;
        moving.set(child.id, child);
        queue.push(child.id);
      }
    }

    const now = nowIso();
    const actor = req.user.fullName || req.user.username;
    const sources = new Map();
    db.transaction(() => {
      // Parents first, so their new place is known when children are written.
      const ordered = [...moving.values()].sort((left, right) => (left.parent_id && moving.has(left.parent_id) ? 1 : 0) - (right.parent_id && moving.has(right.parent_id) ? 1 : 0));
      for (const row of ordered) {
        const data = parseJson(row.data_json, {});
        const key = nextKey(targetSpace);
        const parentId = row.parent_id && moving.has(row.parent_id) ? row.parent_id : null;
        const from = db.prepare('SELECT name, code FROM spaces WHERE id = ?').get(row.space_id);
        sources.set(row.space_id, from);
        const history = Array.isArray(data.history) ? data.history : [];
        const next = {
          ...data,
          spaceId: targetSpace.id, projectId: targetSpace.id, spaceCode: targetSpace.code,
          key, code: key, previousKey: row.issue_key,
          sprintId: null, rank: nextRank(targetSpace.id, null),
          parentId, parent: null, team: null, teamId: null, release: null, releaseId: null,
          updatedAt: now,
          history: [...history, { id: createId('history'), action: 'Moved', detail: `${row.issue_key} → ${key} (${from?.name || 'project'} → ${targetSpace.name})`, actor, createdAt: now }]
        };
        db.prepare(`UPDATE work_items SET space_id = ?, issue_key = ?, parent_id = ?, team_id = NULL, release_id = NULL, updated_at = ?, data_json = ? WHERE id = ?`)
          .run(targetSpace.id, key, parentId, now, JSON.stringify(next), row.id);
        db.prepare('UPDATE work_item_files SET space_id = ? WHERE work_item_id = ?').run(targetSpace.id, row.id);
        logActivity({ spaceId: targetSpace.id, workItemId: row.id, actorName: actor, description: `moved ${row.issue_key} here as ${key}` });
        logActivity({ spaceId: row.space_id, actorName: actor, description: `moved ${row.issue_key} to ${targetSpace.name}` });
      }
      // Children that stay behind cannot keep a parent in another project.
      const ids = [...moving.keys()];
      const placeholders = ids.map(() => '?').join(',');
      for (const child of db.prepare(`SELECT id, data_json FROM work_items WHERE parent_id IN (${placeholders}) AND id NOT IN (${placeholders})`).all(...ids, ...ids)) {
        const data = parseJson(child.data_json, {});
        db.prepare('UPDATE work_items SET parent_id = NULL, updated_at = ?, data_json = ? WHERE id = ?')
          .run(now, JSON.stringify({ ...data, parentId: null, parent: null, updatedAt: now }), child.id);
      }
    })();

    const items = [...moving.keys()].map((id) => presentItem(req, db.prepare('SELECT * FROM work_items WHERE id = ?').get(id)));
    res.json({ movedCount: items.length, items, targetSpaceId: targetSpace.id });
  } catch (error) { next(error); }
});

router.delete('/:id', itemAccess, (req, res) => {
  const row = db.prepare('SELECT * FROM work_items WHERE id = ?').get(req.params.id);
  if (!allowed(req, row.space_id, 'task.delete', row)) return denied(res, 'task.delete');
  const result = db.prepare('DELETE FROM work_items WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Work item not found.' });
  res.status(204).end();
});

router.get('/:id/comments', itemAccess, (req, res) => {
  const item = db.prepare('SELECT * FROM work_items WHERE id = ?').get(req.params.id);
  if (!allowed(req, item.space_id, 'comment.view', item)) return denied(res, 'comment.view');
  const rows = db.prepare('SELECT * FROM comments WHERE work_item_id = ? AND deleted_at IS NULL ORDER BY created_at').all(req.params.id);
  res.json(rows.map((row) => ({ ...parseJson(row.data_json, {}), id: row.id, parentCommentId: row.parent_comment_id, authorId: row.author_id, author: row.author_name, body: row.body, createdAt: row.created_at, updatedAt: row.updated_at })));
});

router.post('/:id/comments', itemAccess, (req, res) => {
  const issue = db.prepare('SELECT * FROM work_items WHERE id = ?').get(req.params.id);
  if (!issue) return res.status(404).json({ error: 'Work item not found.' });
  if (!allowed(req, issue.space_id, 'comment.add', issue)) return denied(res, 'comment.add');
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Comment cannot be empty.' });
  const id = createId('comment'); const now = nowIso();
  const authorName = req.user.fullName || req.user.username;
  db.prepare(`INSERT INTO comments (id, work_item_id, parent_comment_id, author_id, author_name, body, created_at, updated_at, data_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, issue.id, req.body?.parentCommentId || null, req.user.id, authorName, body, now, now, JSON.stringify(req.body?.metadata || {}));
  res.status(201).json({ id, workItemId: issue.id, parentCommentId: req.body?.parentCommentId || null, authorId: req.user.id, author: authorName, body, createdAt: now, updatedAt: now });
});

export default router;
