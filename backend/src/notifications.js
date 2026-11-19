// In-app + email notifications.
//
// notify() stores one row per recipient (never the actor) inside the caller's request;
// sending the email is left to a background queue (mailQueue below), so a slow or
// broken mail server never delays or fails the API request. The notifications table is
// also the outbox: rows wait with email_status = 'pending' until the queue sends them,
// which means emails queued just before a restart are still delivered afterwards.
import process from 'node:process';
import { setImmediate, setTimeout } from 'node:timers';
import nodemailer from 'nodemailer';
import { db, createId, nowIso, parseJson } from './db.js';
import { canAccessSpace } from './access.js';

export const NOTIFICATION_TYPES = ['assigned', 'comment', 'reply', 'task_updated'];

const FIELD_LABELS = {
  status: 'Trạng thái',
  priority: 'Độ ưu tiên',
  dueDate: 'Ngày hết hạn',
  startDate: 'Ngày bắt đầu',
  attachmentAdded: 'Đã thêm tệp đính kèm',
  attachmentRemoved: 'Đã xóa tệp đính kèm'
};

/* ----------------------------------------------------------- recipients */

function userRow(id) {
  if (!id) return null;
  return db.prepare('SELECT id, username, email, full_name, avatar_url, role, is_active FROM users WHERE id = ?').get(String(id)) || null;
}

/** Resolves an assignee value ({ id, email } object or an id) to a user id, if it is a user. */
export function assigneeUserId(value) {
  if (!value) return null;
  if (typeof value !== 'object') return userRow(value)?.id || null;
  const byId = userRow(value.id);
  if (byId) return byId.id;
  const email = String(value.email || '').trim().toLowerCase();
  if (!email) return null;
  return db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email)?.id || null;
}

export function watcherIds(workItemId) {
  return db.prepare('SELECT user_id FROM work_item_watchers WHERE work_item_id = ?').all(String(workItemId)).map((row) => row.user_id);
}

export function isWatching(workItemId, userId) {
  return Boolean(db.prepare('SELECT 1 FROM work_item_watchers WHERE work_item_id = ? AND user_id = ?').get(String(workItemId), String(userId)));
}

export function setWatching(workItemId, userId, watching) {
  if (watching) {
    db.prepare('INSERT OR IGNORE INTO work_item_watchers (work_item_id, user_id, created_at) VALUES (?, ?, ?)').run(String(workItemId), String(userId), nowIso());
  } else {
    db.prepare('DELETE FROM work_item_watchers WHERE work_item_id = ? AND user_id = ?').run(String(workItemId), String(userId));
  }
}

/* ------------------------------------------------------------- messages */

function taskLabel(item) {
  return `${item.issue_key}: ${item.title}`;
}

function describeChange(change) {
  const label = FIELD_LABELS[change.field] || change.field;
  if (change.field === 'attachmentAdded' || change.field === 'attachmentRemoved') return `${label}: ${change.to || change.from}`;
  return `${label}: ${change.from || 'Trống'} → ${change.to || 'Trống'}`;
}

function buildMessage(type, actorName, item, data) {
  const task = taskLabel(item);
  if (type === 'assigned') return `${actorName} đã gán bạn vào công việc ${task}`;
  if (type === 'comment') return `${actorName} đã bình luận trong công việc ${task}`;
  if (type === 'reply') return `${actorName} đã trả lời bình luận của bạn trong công việc ${task}`;
  const changes = Array.isArray(data.changes) ? data.changes : [];
  if (changes.length === 1) {
    const [change] = changes;
    if (change.field === 'priority') return `${actorName} đã đổi độ ưu tiên của công việc ${task} (${change.from || 'Trống'} → ${change.to || 'Trống'})`;
    if (change.field === 'status') return `${actorName} đã chuyển trạng thái công việc ${task} (${change.from} → ${change.to})`;
    if (change.field === 'dueDate') return `${actorName} đã đổi ngày hết hạn của công việc ${task}`;
    if (change.field === 'startDate') return `${actorName} đã đổi ngày bắt đầu của công việc ${task}`;
    if (change.field === 'attachmentAdded') return `${actorName} đã thêm tệp đính kèm vào công việc ${task}`;
    if (change.field === 'attachmentRemoved') return `${actorName} đã xóa tệp đính kèm khỏi công việc ${task}`;
  }
  return `${actorName} đã cập nhật công việc ${task}`;
}

/* ------------------------------------------------------- email addresses */

// Reserved names that never receive mail (RFC 2606 / 6761), e.g. demo accounts.
const RESERVED_DOMAIN = /(^|\.)(example\.(com|net|org)|example|test|invalid|localhost|local)$/i;
const EMAIL_PATTERN = /^[^\s@"<>(),;:\\[\]]+@([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/**
 * Whether notifications may be emailed to this address: a well-formed address on a real
 * domain. Users without one still get in-app notifications, just no email.
 * (MAIL_ALLOW_RESERVED_DOMAINS=true lets test setups send to example.com etc.)
 */
export function isDeliverableEmail(value) {
  const email = String(value || '').trim();
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) return false;
  const [local, domain] = [email.slice(0, email.lastIndexOf('@')), email.slice(email.lastIndexOf('@') + 1)];
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (process.env.MAIL_ALLOW_RESERVED_DOMAINS !== 'true' && RESERVED_DOMAIN.test(domain)) return false;
  return true;
}

/* --------------------------------------------------------------- notify */

/**
 * Creates notifications for a work item event.
 * recipients: user ids (duplicates, empty values and the actor are dropped; people who
 * cannot open the project get nothing). Returns the number of notifications created.
 */
export function notify({ type, actor, item, recipients, data = {} }) {
  if (!item || !NOTIFICATION_TYPES.includes(type)) return 0;
  const actorId = actor?.id ? String(actor.id) : null;
  const actorName = actor?.fullName || actor?.username || 'Ai đó';
  const ids = [...new Set((recipients || []).filter(Boolean).map(String))].filter((id) => id !== actorId);
  if (!ids.length) return 0;
  const message = buildMessage(type, actorName, item, data);
  const now = nowIso();
  const insert = db.prepare(`INSERT INTO notifications
    (id, recipient_id, actor_id, actor_name, type, work_item_id, space_id, issue_key, task_title, message, data_json, is_read, created_at, email_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`);
  let created = 0;
  for (const id of ids) {
    const recipient = userRow(id);
    if (!recipient || !recipient.is_active) continue;
    if (!canAccessSpace({ id: recipient.id, role: recipient.role }, item.space_id)) continue;
    insert.run(createId('ntf'), recipient.id, actorId, actorName, type, item.id, item.space_id, item.issue_key, item.title, message,
      JSON.stringify(data), now, isDeliverableEmail(recipient.email) ? 'pending' : 'skipped');
    created += 1;
  }
  if (created) mailQueue.kick();
  return created;
}

/* --------------------------------------------- work item change detection */

function commentList(data) {
  return Array.isArray(data?.comments) ? data.comments : [];
}

/** Flattens a comment tree into [{ comment, parent }]. */
function flattenComments(list, parent = null, out = []) {
  for (const comment of list) {
    if (!comment || typeof comment !== 'object') continue;
    out.push({ comment, parent });
    flattenComments(Array.isArray(comment.replies) ? comment.replies : [], comment, out);
  }
  return out;
}

function authorUserId(comment) {
  return userRow(comment?.authorId)?.id || null;
}

function storedFileIds(list) {
  return new Map((Array.isArray(list) ? list : []).filter((file) => file && typeof file === 'object' && file.id).map((file) => [String(file.id), file]));
}

function dateText(value) {
  if (!value) return '';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value);
}

/**
 * Compares a work item before and after a change and sends the notifications:
 * Assigned (new assignee), New Comment / Reply (comments added to data.comments) and
 * Task Updated (dates, priority, status, attachments) for the assignee and followers.
 * before/after are { row, data } with row = work_items row and data = parsed data_json
 * (before = null for a new work item).
 */
export function notifyWorkItemChanges({ actor, before, after }) {
  const item = after.row;
  const assigneeBefore = before ? assigneeUserId(before.data.assignee || before.data.assigneeId || before.row.assignee_id) : null;
  const assigneeAfter = assigneeUserId(after.data.assignee || after.data.assigneeId || item.assignee_id);

  if (assigneeAfter && assigneeAfter !== assigneeBefore) {
    notify({ type: 'assigned', actor, item, recipients: [assigneeAfter] });
  }
  if (!before) return;

  // Comments: new entries in the tree (the client saves the whole list).
  const known = new Set(flattenComments(commentList(before.data)).map(({ comment }) => String(comment.id)));
  const added = flattenComments(commentList(after.data)).filter(({ comment }) => comment.id && !known.has(String(comment.id)));
  for (const { comment, parent } of added) notifyComment({ actor, item, comment, parentAuthorId: parent ? authorUserId(parent) : null });

  // Field changes for the assignee and the followers.
  const changes = [];
  if (before.row.status !== item.status) changes.push({ field: 'status', from: before.row.status, to: item.status });
  if (before.row.priority !== item.priority) changes.push({ field: 'priority', from: before.row.priority, to: item.priority });
  if ((before.row.due_date || '') !== (item.due_date || '')) changes.push({ field: 'dueDate', from: dateText(before.row.due_date), to: dateText(item.due_date) });
  if ((before.row.start_date || '') !== (item.start_date || '')) changes.push({ field: 'startDate', from: dateText(before.row.start_date), to: dateText(item.start_date) });
  const filesBefore = storedFileIds(before.data.attachments);
  const filesAfter = storedFileIds(after.data.attachments);
  for (const [id, file] of filesAfter) if (!filesBefore.has(id)) changes.push({ field: 'attachmentAdded', to: file.name });
  for (const [id, file] of filesBefore) if (!filesAfter.has(id)) changes.push({ field: 'attachmentRemoved', from: file.name });
  notifyTaskUpdated({ actor, item, changes, skip: assigneeAfter !== assigneeBefore ? [assigneeAfter] : [] });
}

/** New comment → assignee + creator; a reply also tells the author of the parent comment. */
export function notifyComment({ actor, item, comment, parentAuthorId }) {
  const preview = String(comment?.text || comment?.body || '').trim().slice(0, 200);
  const data = { commentId: comment?.id || null, preview };
  let replied = null;
  if (parentAuthorId && parentAuthorId !== String(actor?.id)) {
    notify({ type: 'reply', actor, item, recipients: [parentAuthorId], data });
    replied = parentAuthorId;
  }
  const people = [assigneeUserId(item.assignee_id), userRow(item.creator_id)?.id].filter((id) => id && id !== replied);
  notify({ type: 'comment', actor, item, recipients: people, data });
}

/** Task Updated → assignee and followers (skip: people who already got another notice). */
export function notifyTaskUpdated({ actor, item, changes, skip = [] }) {
  if (!changes.length) return 0;
  const lines = changes.map(describeChange);
  const recipients = [assigneeUserId(item.assignee_id), ...watcherIds(item.id)].filter((id) => id && !skip.includes(id));
  return notify({ type: 'task_updated', actor, item, recipients, data: { changes, lines } });
}

/* ------------------------------------------------------------ read model */

export function presentNotification(row) {
  const data = parseJson(row.data_json, {});
  const actor = row.actor_id ? userRow(row.actor_id) : null;
  return {
    id: row.id,
    type: row.type,
    message: row.message,
    isRead: Boolean(row.is_read),
    createdAt: row.created_at,
    readAt: row.read_at || null,
    actor: actor
      ? { id: actor.id, name: actor.full_name, fullName: actor.full_name, email: actor.email, avatarUrl: actor.avatar_url || '' }
      : { id: row.actor_id, name: row.actor_name, fullName: row.actor_name },
    workItem: row.work_item_id ? { id: row.work_item_id, key: row.issue_key, title: row.task_title, spaceId: row.space_id } : null,
    changes: Array.isArray(data.changes) ? data.changes : [],
    lines: Array.isArray(data.lines) ? data.lines : [],
    preview: data.preview || ''
  };
}

/* ----------------------------------------------------------- mail queue */

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function appUrl() {
  const first = String(process.env.CORS_ORIGIN || '').split(',')[0].trim();
  return String(process.env.APP_URL || first || 'http://localhost:5173').trim().replace(/\/+$/, '');
}

const SUBJECTS = {
  assigned: 'Bạn được gán vào công việc',
  comment: 'Bình luận mới',
  reply: 'Có người trả lời bình luận của bạn',
  task_updated: 'Công việc được cập nhật'
};

/** Subject, text and HTML of the email for one notification row. */
export function renderEmail(row) {
  const data = parseJson(row.data_json, {});
  const link = `${appUrl()}/?task=${encodeURIComponent(row.work_item_id || '')}`;
  const subject = `[TASKFLOW] ${SUBJECTS[row.type] || 'Thông báo'} ${row.issue_key || ''}`.trim();
  const details = [...(Array.isArray(data.lines) ? data.lines : []), ...(data.preview ? [`“${data.preview}”`] : [])];
  const text = [row.message, ...details.map((line) => `- ${line}`), '', `Xem công việc: ${link}`].join('\n');
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
  <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px">
    <tr><td style="padding:18px 24px;border-bottom:1px solid #e5e7eb;font-weight:800;font-size:18px;letter-spacing:.5px">TASK<span style="color:#2563eb">FLOW</span></td></tr>
    <tr><td style="padding:22px 24px">
      <p style="margin:0 0 14px;font-size:15px;line-height:1.5">${escapeHtml(row.message)}</p>
      ${details.length ? `<ul style="margin:0 0 18px;padding-left:18px;font-size:14px;line-height:1.6;color:#4b5563">${details.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` : ''}
      <a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px">Xem công việc</a>
    </td></tr>
    <tr><td style="padding:14px 24px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">Bạn nhận được email này vì có hoạt động trên công việc liên quan tới bạn trong TASKFLOW.</td></tr>
  </table></body></html>`;
  return { subject, text, html };
}

/**
 * MAIL_TRANSPORT: "smtp" (default when SMTP_HOST is set), "log" (print to the console,
 * the default without SMTP), "json" (build the message without sending; for tests) or
 * "off" (do not send emails).
 */
function mailMode() {
  const configured = String(process.env.MAIL_TRANSPORT || '').trim().toLowerCase();
  if (configured) return configured;
  return process.env.SMTP_HOST ? 'smtp' : 'log';
}

function createTransport(mode) {
  if (mode === 'smtp') {
    const port = Number(process.env.SMTP_PORT || 587);
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: String(process.env.SMTP_PASS || '').replace(/\s+/g, '') } : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000
    });
  }
  if (mode === 'json') return nodemailer.createTransport({ jsonTransport: true });
  return null;
}

const MAX_ATTEMPTS = 5;
// Retry delay doubles after each failed attempt: 30 s, 1 min, 2 min, 4 min (MAIL_RETRY_BASE_MS).
const retryDelay = (attempts) => Math.min(Number(process.env.MAIL_RETRY_BASE_MS) || 30000, 3600000) * 2 ** (attempts - 1);
const BATCH_SIZE = 20;

export const mailQueue = {
  running: false,
  scheduled: false,
  transport: null,
  mode: null,
  stopped: false,

  /** Schedules a run after the current request has finished (never blocks it). */
  kick() {
    if (this.scheduled || this.stopped) return;
    this.scheduled = true;
    setImmediate(() => { this.scheduled = false; this.run().catch((error) => console.error('[mail] queue error:', error.message)); });
  },

  async run() {
    if (this.running) { this.again = true; return; }
    this.running = true;
    try {
      do {
        this.again = false;
        const mode = mailMode();
        if (mode !== this.mode) { this.mode = mode; this.transport = createTransport(mode); }
        const rows = db.prepare(`SELECT n.*, u.email AS recipient_email, u.full_name AS recipient_name FROM notifications n
          JOIN users u ON u.id = n.recipient_id
          WHERE n.email_status = 'pending' AND (n.email_next_at IS NULL OR n.email_next_at <= ?)
          ORDER BY n.created_at LIMIT ?`).all(nowIso(), BATCH_SIZE);
        for (const row of rows) await this.deliver(row, mode);
        if (rows.length === BATCH_SIZE) this.again = true;
      } while (this.again && !this.stopped);
    } finally {
      this.running = false;
    }
  },

  async deliver(row, mode) {
    const mark = db.prepare('UPDATE notifications SET email_status = ?, email_attempts = ?, email_error = ?, emailed_at = ? WHERE id = ?');
    // The address is checked again: it may have changed since the notification was queued.
    if (mode === 'off' || !isDeliverableEmail(row.recipient_email)) {
      return mark.run('skipped', row.email_attempts, mode === 'off' ? null : 'No valid email address', null, row.id);
    }
    const email = renderEmail(row);
    const from = process.env.MAIL_FROM || process.env.SMTP_USER || 'TASKFLOW <no-reply@taskflow.local>';
    const to = row.recipient_name ? `"${String(row.recipient_name).replace(/"/g, '')}" <${row.recipient_email}>` : row.recipient_email;
    if (mode === 'log') {
      console.log(`[mail] (log only, set SMTP_HOST to send) to=${row.recipient_email} subject="${email.subject}"`);
      return mark.run('logged', row.email_attempts + 1, null, nowIso(), row.id);
    }
    if (!this.transport) return mark.run('failed', row.email_attempts + 1, `Unknown MAIL_TRANSPORT "${mode}"`, null, row.id);
    try {
      await this.transport.sendMail({ from, to, subject: email.subject, text: email.text, html: email.html });
      mark.run('sent', row.email_attempts + 1, null, nowIso(), row.id);
    } catch (error) {
      const attempts = row.email_attempts + 1;
      // A mailbox the server refuses (5xx, e.g. "no such user") is not retried.
      const permanent = error.code === 'EENVELOPE' || (error.responseCode >= 500 && error.responseCode < 600 && error.command !== 'AUTH PLAIN' && error.code !== 'EAUTH');
      const status = permanent || attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
      const delay = retryDelay(attempts);
      mark.run(status, attempts, String(error.message || error).slice(0, 500), null, row.id);
      if (status === 'pending') db.prepare('UPDATE notifications SET email_next_at = ? WHERE id = ?').run(new Date(Date.now() + delay).toISOString(), row.id);
      console.error(`[mail] could not send to ${row.recipient_email} (attempt ${attempts}/${MAX_ATTEMPTS}): ${error.message}`);
      if (status === 'pending' && !this.stopped) setTimeout(() => this.kick(), delay + 50).unref?.();
    }
  }
};

/** Start-up: resumes emails that were still waiting when the server stopped. */
export function startMailQueue() {
  mailQueue.kick();
  const mode = mailMode();
  return mode === 'smtp' ? `Email notifications: SMTP ${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587}`
    : mode === 'log' ? 'Email notifications: log only (set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM to send real emails)'
      : `Email notifications: ${mode}`;
}
