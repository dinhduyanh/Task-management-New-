import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDirectory = path.resolve(__dirname, '../data');
fs.mkdirSync(dataDirectory, { recursive: true });

const databasePath = process.env.TASKFLOW_DB_PATH || path.join(dataDirectory, 'taskflow.sqlite');
export const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Authentication sessions are kept separately from the core application schema.
db.exec(`
  CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
`);

export function parseJson(value, fallback = {}) {
  if (value === null || value === undefined || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function nowIso() {
  return new Date().toISOString();
}

export function createId(prefix = 'id') {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function getMembers(spaceId) {
  return db.prepare('SELECT member_json FROM space_members WHERE space_id = ? ORDER BY created_at').all(spaceId)
    .map((row) => parseJson(row.member_json, {}));
}

function getTeams(spaceId) {
  return db.prepare('SELECT id, name, data_json FROM teams WHERE space_id = ? ORDER BY name').all(spaceId)
    .map((row) => ({ ...parseJson(row.data_json, {}), id: row.id, name: row.name }));
}

function getReleases(spaceId) {
  return db.prepare('SELECT id, name, data_json FROM releases WHERE space_id = ? ORDER BY name').all(spaceId)
    .map((row) => ({ ...parseJson(row.data_json, {}), id: row.id, name: row.name }));
}

export function spaceRowToObject(row) {
  if (!row) return null;
  const data = parseJson(row.data_json, {});
  const members = getMembers(row.id);
  const teams = getTeams(row.id);
  const releases = getReleases(row.id);
  const activityRows = db.prepare('SELECT id, actor_name, description, created_at FROM activity_logs WHERE space_id = ? ORDER BY created_at DESC LIMIT 100').all(row.id);
  const activities = activityRows.map((activity) => ({
    id: activity.id,
    actor: activity.actor_name,
    description: activity.description,
    createdAt: activity.created_at
  }));
  return {
    ...data,
    id: row.id,
    code: row.code,
    taskKeyPrefix: row.task_key_prefix || row.code,
    name: row.name,
    ownerId: row.owner_id,
    visibility: row.visibility || data.visibility || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    members: members.length ? members : (Array.isArray(data.members) ? data.members : []),
    teams: teams.length ? teams : (Array.isArray(data.teams) ? data.teams : []),
    releases: releases.length ? releases : (Array.isArray(data.releases) ? data.releases : []),
    activities: activities.length ? activities : (Array.isArray(data.activities) ? data.activities : [])
  };
}

export function workItemRowToObject(row) {
  if (!row) return null;
  const data = parseJson(row.data_json, {});
  const parent = row.parent_id ? db.prepare('SELECT id, issue_key, title, issue_type FROM work_items WHERE id = ?').get(row.parent_id) : null;
  const links = db.prepare('SELECT target_work_item_id AS issueId, link_type AS type FROM work_item_links WHERE source_work_item_id = ?').all(row.id);
  return {
    ...data,
    id: row.id,
    spaceId: row.space_id,
    projectId: row.space_id,
    key: row.issue_key,
    code: row.issue_key,
    title: row.title,
    summary: row.title,
    type: row.issue_type,
    issueType: row.issue_type,
    status: row.status,
    priority: row.priority,
    parentId: row.parent_id,
    parent: parent ? { id: parent.id, key: parent.issue_key, code: parent.issue_key, title: parent.title, name: parent.title, issueType: parent.issue_type, type: parent.issue_type } : null,
    labels: parseJson(row.labels_json, []),
    startDate: row.start_date,
    dueDate: row.due_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    links: links.length ? links : (Array.isArray(data.links) ? data.links : [])
  };
}

export function logActivity({ spaceId, workItemId = null, actorName = 'You', description, data = {} }) {
  db.prepare(`INSERT INTO activity_logs
    (id, space_id, work_item_id, actor_name, description, created_at, data_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(createId('activity'), spaceId, workItemId, actorName, description, nowIso(), JSON.stringify(data));
}
