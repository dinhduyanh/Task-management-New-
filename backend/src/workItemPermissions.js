// Which project permissions a work item change needs, and the server-side stamping that
// keeps authorship trustworthy (comment authors, work log authors, the creator).
import { nowIso, parseJson, workItemRowToObject } from './db.js';
import { can, permissionLabel } from './projectPermissions.js';
import { mergeAttachmentList } from './routes/attachments.js';

const MOVE_FIELDS = new Set(['status', 'sprintId', 'rank']);
const ASSIGN_FIELDS = new Set(['assignee', 'assigneeId']);
// Bookkeeping fields: never need a permission of their own (identity fields are not writable).
const IGNORED_FIELDS = new Set(['updatedAt', 'history', 'commentsHidden', 'permissions']);
const FIXED_FIELDS = ['id', 'key', 'code', 'spaceId', 'projectId', 'spaceCode', 'createdAt', 'creator', 'creatorId'];

export function permissionCache(req) {
  if (!req.permissionCache) req.permissionCache = new Map();
  return req.permissionCache;
}

export function allowed(req, spaceId, key, item = null) {
  return can(req.user, spaceId, key, item, permissionCache(req));
}

export function userRecord(user) {
  return { id: user.id, name: user.fullName || user.username, fullName: user.fullName || user.username, username: user.username, email: user.email };
}

/** Work item as returned to this user: comments are removed without "Task view comment". */
export function presentItem(req, row) {
  const item = workItemRowToObject(row);
  if (!item) return item;
  if (!allowed(req, row.space_id, 'comment.view', row)) {
    item.comments = [];
    item.commentsHidden = true;
  }
  return item;
}

function idOf(value) {
  if (!value) return '';
  if (typeof value === 'object') return String(value.id || value.userId || value.email || value.name || '');
  return String(value);
}

function same(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function flattenComments(list, parentId = null, out = new Map()) {
  for (const comment of Array.isArray(list) ? list : []) {
    if (!comment || comment.id === undefined || comment.id === null) continue;
    out.set(String(comment.id), { comment, parentId });
    flattenComments(comment.replies, String(comment.id), out);
  }
  return out;
}

function commentContent(comment) {
  return { text: comment?.text ?? comment?.body ?? '', attachments: (comment?.attachments || []).map((file) => file?.id || file?.name || file) };
}

/**
 * Checks a comment tree change and returns { comments } (authorship restored or stamped)
 * or { error: permission key }.
 */
function reviewComments(req, row, previous, next) {
  const user = req.user;
  const before = flattenComments(previous);
  const after = flattenComments(next);
  const need = (key) => allowed(req, row.space_id, key, row);

  for (const [id, { comment }] of after) {
    const old = before.get(id);
    if (!old) {
      if (!need('comment.add')) return { error: 'comment.add' };
      if ((comment.attachments || []).length && !need('attachment.add')) return { error: 'attachment.add' };
      continue;
    }
    if (!same(commentContent(old.comment), commentContent(comment))) {
      const own = String(old.comment.authorId || '') === String(user.id);
      if (!(own && need('comment.edit_own')) && !need('comment.edit_all')) return { error: own ? 'comment.edit_own' : 'comment.edit_all' };
    }
  }
  for (const [id, { comment, parentId }] of before) {
    if (after.has(id)) continue;
    if (parentId && !after.has(parentId) && before.has(parentId)) continue; // removed with its parent
    const own = String(comment.authorId || '') === String(user.id);
    if (!(own && need('comment.delete_own')) && !need('comment.delete_all')) return { error: own ? 'comment.delete_own' : 'comment.delete_all' };
  }

  const now = nowIso();
  const stamp = (list) => (Array.isArray(list) ? list : []).map((comment) => {
    const old = before.get(String(comment.id))?.comment;
    const authorship = old
      ? { author: old.author, authorId: old.authorId, createdAt: old.createdAt }
      : { author: user.fullName || user.username, authorId: user.id, createdAt: now };
    return { ...comment, ...authorship, replies: stamp(comment.replies) };
  });
  return { comments: stamp(next) };
}

/**
 * Reviews a PATCH body for a work item row. Returns { updates } (sanitised) or
 * { status, error, permission }.
 */
export function reviewItemUpdate(req, row, body) {
  const updates = { ...(body || {}) };
  FIXED_FIELDS.forEach((field) => delete updates[field]);
  const current = workItemRowToObject(row);
  const data = parseJson(row.data_json, {});
  const need = new Set();
  const fail = (permission) => ({ status: 403, permission, error: `You do not have the "${permissionLabel(permission)}" permission for this work item.` });

  for (const field of Object.keys(updates)) {
    if (IGNORED_FIELDS.has(field)) continue;
    if (field === 'comments') {
      if (!allowed(req, row.space_id, 'comment.view', row)) return fail('comment.view');
      const review = reviewComments(req, row, data.comments, updates.comments);
      if (review.error) return fail(review.error);
      updates.comments = review.comments;
      continue;
    }
    if (field === 'workLogs') {
      const previous = new Map((Array.isArray(data.workLogs) ? data.workLogs : []).map((entry) => [String(entry?.id), entry]));
      const next = Array.isArray(updates.workLogs) ? updates.workLogs : [];
      if (!same(data.workLogs || [], next)) need.add('task.worklog');
      updates.workLogs = next.map((entry) => (previous.has(String(entry?.id))
        ? previous.get(String(entry.id))
        : { ...entry, author: req.user.fullName || req.user.username, authorId: req.user.id }));
      continue;
    }
    if (field === 'attachments') {
      const merged = mergeAttachmentList(row.id, updates.attachments);
      if (merged.length < (Array.isArray(current.attachments) ? current.attachments.length : 0)) need.add('attachment.delete_all');
      continue;
    }
    if (ASSIGN_FIELDS.has(field)) {
      if (idOf(updates[field]) !== idOf(current.assignee || current.assigneeId)) need.add('task.assign');
      continue;
    }
    if (field === 'links') {
      const key = (links) => (Array.isArray(links) ? links : []).map((link) => `${link.type}|${link.issueId || link.targetId}`).sort();
      if (!same(key(current.links), key(updates.links))) need.add('task.link');
      continue;
    }
    if (same(current[field], updates[field])) continue;
    need.add(MOVE_FIELDS.has(field) ? 'task.move' : 'task.update');
  }

  for (const key of need) {
    if (!allowed(req, row.space_id, key, row)) return fail(key);
  }
  return { updates };
}

/** Checks a create (or clone) request. Returns null when allowed, otherwise an error object. */
export function reviewItemCreate(req, spaceId, body, source = null) {
  const prospective = { creator_id: req.user.id, assignee_id: idOf(body.assignee || body.assigneeId) || null };
  const fail = (permission) => ({ status: 403, permission, error: `You do not have the "${permissionLabel(permission)}" permission in this project.` });
  if (source) {
    if (!allowed(req, source.space_id, 'task.clone', source)) return fail('task.clone');
  } else if (!allowed(req, spaceId, 'task.create')) {
    return fail('task.create');
  }
  if (prospective.assignee_id && prospective.assignee_id !== String(req.user.id) && !allowed(req, spaceId, 'task.assign', prospective)) return fail('task.assign');
  if (Array.isArray(body.links) && body.links.length && !allowed(req, spaceId, 'task.link', prospective)) return fail('task.link');
  return null;
}
