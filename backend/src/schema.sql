PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE,
  email TEXT UNIQUE,
  full_name TEXT NOT NULL,
  password_hash TEXT,
  avatar_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  -- System role: 'admin' (manages the system, sees every project) or 'user'.
  -- Existing databases get this column from the migration in db.js.
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS spaces (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  task_key_prefix TEXT,
  name TEXT NOT NULL,
  owner_id TEXT,
  visibility TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS space_members (
  space_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  member_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY (space_id, user_id),
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  name TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS releases (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  name TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS work_items (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  issue_key TEXT NOT NULL,
  issue_type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  parent_id TEXT,
  assignee_id TEXT,
  creator_id TEXT,
  team_id TEXT,
  release_id TEXT,
  labels_json TEXT NOT NULL DEFAULT '[]',
  start_date TEXT,
  due_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE (space_id, issue_key),
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES work_items(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_work_items_space ON work_items(space_id);
CREATE INDEX IF NOT EXISTS idx_work_items_key ON work_items(issue_key);
CREATE INDEX IF NOT EXISTS idx_work_items_parent ON work_items(parent_id);
CREATE INDEX IF NOT EXISTS idx_work_items_updated ON work_items(updated_at);

CREATE TABLE IF NOT EXISTS work_item_links (
  id TEXT PRIMARY KEY,
  source_work_item_id TEXT NOT NULL,
  target_work_item_id TEXT NOT NULL,
  link_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (source_work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
  FOREIGN KEY (target_work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL,
  parent_comment_id TEXT,
  author_id TEXT,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_comment_id) REFERENCES comments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  stored_name TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  storage_path TEXT,
  uploaded_by TEXT,
  created_at TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  work_item_id TEXT,
  actor_id TEXT,
  actor_name TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS work_item_status_history (
  id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
);

-- Sprints of a Space. status: future | active | completed. Work items reference a
-- sprint through data_json.sprintId (null/absent = Product Backlog).
CREATE TABLE IF NOT EXISTS sprints (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  name TEXT NOT NULL,
  goal TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'future',
  start_date TEXT,
  end_date TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sprints_space ON sprints(space_id);

-- Members of a project team (teams are scoped to one Space). role: lead | member.
-- Team code, unit, description, status and creator live in teams.data_json.
CREATE TABLE IF NOT EXISTS team_members (
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL,
  PRIMARY KEY (team_id, user_id),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);

-- Uploaded files (the older `attachments` table above was never used by the API). Content is stored in the database so deleting a work item (or its
-- Space) removes its files too. Metadata is mirrored in work_items.data_json.attachments.
CREATE TABLE IF NOT EXISTS work_item_files (
  id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  extension TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  content BLOB NOT NULL,
  source TEXT NOT NULL DEFAULT 'work_item',
  uploaded_by_id TEXT,
  uploaded_by_name TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_work_item_files_item ON work_item_files(work_item_id);
CREATE INDEX IF NOT EXISTS idx_work_item_files_space ON work_item_files(space_id);

-- Roles that can be given to members inside a project (managed by system admins).
CREATE TABLE IF NOT EXISTS project_roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Dashboard widgets backed by a read-only SQL query (managed by system admins).
-- visibility: 'admins' (only admins see it) or 'everyone'.
CREATE TABLE IF NOT EXISTS dashboard_widgets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  chart_type TEXT NOT NULL DEFAULT 'table',
  sql_query TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'admins',
  is_active INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
