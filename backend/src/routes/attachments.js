// File attachments of work items (shown on the Documents page and in task details).
// Upload: POST /api/work-items/:id/attachments with the raw file as the body, the file
// name in the X-File-Name header (URI-encoded) and optional X-Attachment-Source: comment.
import express, { Router } from 'express';
import { Buffer } from 'node:buffer';
import { db, createId, nowIso, parseJson, logActivity } from '../db.js';
import { optionalAuth } from '../middleware/auth.js';
import { requireSpaceAccess, spaceFilter, spaceIdOf } from '../access.js';
import { allowed, presentItem } from '../workItemPermissions.js';
import { denied } from '../projectPermissions.js';

const router = Router();
router.use(optionalAuth);

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

// Allowed extensions and the type the file is served with. The type comes from this
// list, not from the uploader's Content-Type header.
const MIME_BY_EXTENSION = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  zip: 'application/zip'
};
// Only these are shown inline (preview); everything else is always downloaded.
const INLINE_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp']);

function extensionOf(name) {
  const match = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

function metadata(row) {
  return {
    id: row.id,
    name: row.file_name,
    extension: row.extension,
    mimeType: row.mime_type,
    size: row.size,
    source: row.source,
    createdAt: row.created_at,
    uploadedBy: row.uploaded_by_id || row.uploaded_by_name ? { id: row.uploaded_by_id, name: row.uploaded_by_name } : null
  };
}

/** Metadata of the files stored for a work item, oldest first. */
export function storedAttachments(workItemId) {
  return db.prepare(`SELECT id, file_name, extension, mime_type, size, source, uploaded_by_id, uploaded_by_name, created_at
    FROM work_item_files WHERE work_item_id = ? ORDER BY created_at`).all(workItemId).map(metadata);
}

/**
 * Attachment list for data_json: stored files plus legacy entries from before file storage
 * that still carry a name. Legacy entries without any information (`{}`) are dropped.
 */
export function mergeAttachmentList(workItemId, current) {
  const legacy = (Array.isArray(current) ? current : []).filter((item) =>
    (typeof item === 'string' && item.trim()) ||
    (item && typeof item === 'object' && !item.id && typeof item.name === 'string' && item.name.trim()));
  return [...legacy, ...storedAttachments(workItemId)];
}

/** Rewrites data_json.attachments of a work item from the attachments table. */
function syncWorkItemAttachments(workItemId) {
  const row = db.prepare('SELECT data_json FROM work_items WHERE id = ?').get(workItemId);
  if (!row) return;
  const data = parseJson(row.data_json, {});
  data.attachments = mergeAttachmentList(workItemId, data.attachments);
  db.prepare('UPDATE work_items SET data_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(data), nowIso(), workItemId);
}

function contentDisposition(type, name) {
  const fallback = String(name).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Own files need "Task delete owner attachment", anyone else's "Task delete all attachment". */
function mayDeleteFile(req, file, item) {
  const own = String(file.uploaded_by_id || '') === String(req.user?.id || '');
  return (own && allowed(req, item.space_id, 'attachment.delete_own', item)) || allowed(req, item.space_id, 'attachment.delete_all', item);
}

const fileAccess = requireSpaceAccess((req) => spaceIdOf.file(req.params.id), 'File not found.');

router.post(
  '/work-items/:id/attachments',
  requireSpaceAccess((req) => spaceIdOf.workItem(req.params.id), 'Work item not found.'),
  express.raw({ type: () => true, limit: MAX_ATTACHMENT_BYTES }),
  (req, res, next) => {
    try {
      const item = db.prepare('SELECT * FROM work_items WHERE id = ?').get(req.params.id);
      if (!item) return res.status(404).json({ error: 'Work item not found.' });
      if (!allowed(req, item.space_id, 'attachment.add', item)) return denied(res, 'attachment.add');
      let name = '';
      try { name = decodeURIComponent(String(req.get('X-File-Name') || '')); } catch { name = ''; }
      name = name.replace(/[\\/]/g, '_').trim().slice(0, 200);
      if (!name) return res.status(400).json({ error: 'File name is required.' });
      const extension = extensionOf(name);
      const mimeType = MIME_BY_EXTENSION[extension];
      if (!mimeType) return res.status(400).json({ error: `Files of type .${extension || '?'} are not supported.` });
      const content = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!content.length) return res.status(400).json({ error: 'The file is empty.' });
      const source = req.get('X-Attachment-Source') === 'comment' ? 'comment' : 'work_item';
      const id = createId('file');
      db.transaction(() => {
        db.prepare(`INSERT INTO work_item_files (id, work_item_id, space_id, file_name, extension, mime_type, size, content, source, uploaded_by_id, uploaded_by_name, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, item.id, item.space_id, name, extension, mimeType, content.length, content, source,
            req.user?.id || null, req.user ? (req.user.fullName || req.user.username) : null, nowIso());
        syncWorkItemAttachments(item.id);
        logActivity({ spaceId: item.space_id, workItemId: item.id, actorName: req.user?.fullName || 'You', description: `attached ${name} to ${item.issue_key}` });
      })();
      const row = db.prepare('SELECT * FROM work_item_files WHERE id = ?').get(id);
      res.status(201).json({
        attachment: metadata(row),
        workItem: presentItem(req, db.prepare('SELECT * FROM work_items WHERE id = ?').get(item.id))
      });
    } catch (error) { next(error); }
  }
);

// All stored files with the work item and Space they belong to (newest first).
router.get('/attachments', (req, res) => {
  const filter = spaceFilter(req.user, 'a.space_id');
  const params = [...filter.params];
  let where = `WHERE ${filter.sql}`;
  if (req.query.spaceId) { where += ' AND a.space_id = ?'; params.push(String(req.query.spaceId)); }
  const rows = db.prepare(`SELECT a.id, a.file_name, a.extension, a.mime_type, a.size, a.source, a.uploaded_by_id, a.uploaded_by_name, a.created_at,
      w.id AS wi_id, w.issue_key, w.title, w.issue_type, w.status, w.assignee_id, w.creator_id, s.id AS s_id, s.name AS s_name, s.code AS s_code
    FROM work_item_files a
    JOIN work_items w ON w.id = a.work_item_id
    JOIN spaces s ON s.id = a.space_id
    ${where}
    ORDER BY a.created_at DESC`).all(...params);
  res.json(rows.map((row) => ({
    ...metadata(row),
    workItem: { id: row.wi_id, key: row.issue_key, title: row.title, issueType: row.issue_type, status: row.status },
    space: { id: row.s_id, name: row.s_name, code: row.s_code },
    permissions: { delete: mayDeleteFile(req, row, { space_id: row.s_id, assignee_id: row.assignee_id, creator_id: row.creator_id }) }
  })));
});

function sendFile(req, res, inlineRequested) {
  const row = db.prepare('SELECT file_name, extension, mime_type, size, content FROM work_item_files WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'File not found.' });
  const inline = inlineRequested && INLINE_EXTENSIONS.has(row.extension);
  res.setHeader('Content-Type', row.mime_type);
  res.setHeader('Content-Length', row.size);
  res.setHeader('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', row.file_name));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.end(row.content);
}

router.get('/attachments/:id/content', fileAccess, (req, res) => sendFile(req, res, true));
router.get('/attachments/:id/download', fileAccess, (req, res) => sendFile(req, res, false));

router.delete('/attachments/:id', fileAccess, (req, res, next) => {
  try {
    const row = db.prepare('SELECT id, work_item_id, space_id, file_name, uploaded_by_id FROM work_item_files WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'File not found.' });
    const item = db.prepare('SELECT * FROM work_items WHERE id = ?').get(row.work_item_id);
    if (!mayDeleteFile(req, row, item)) {
      return denied(res, String(row.uploaded_by_id || '') === String(req.user.id) ? 'attachment.delete_own' : 'attachment.delete_all');
    }
    db.transaction(() => {
      db.prepare('DELETE FROM work_item_files WHERE id = ?').run(row.id);
      syncWorkItemAttachments(row.work_item_id);
      logActivity({ spaceId: row.space_id, workItemId: row.work_item_id, actorName: req.user?.fullName || 'You', description: `deleted file ${row.file_name}` });
    })();
    res.json({ workItem: presentItem(req, db.prepare('SELECT * FROM work_items WHERE id = ?').get(row.work_item_id)) });
  } catch (error) { next(error); }
});

export default router;
