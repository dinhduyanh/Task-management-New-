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
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Access rules per project and permission (see src/projectPermissions.js).
-- rules_json: [{ "type": "role" | "field", "value": "Developer" | "assignee" | "creator" }]
CREATE TABLE IF NOT EXISTS project_permissions (
  space_id TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  rules_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (space_id, permission_key),
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
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

-- Dashboards built by users from the SQL widgets (see routes/dashboards.js).
-- layout_json: [{ "widgetId": "...", "size": 1 | 2 | 3 }] in display order on a 3-column grid.
CREATE TABLE IF NOT EXISTS dashboards (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',      -- active | inactive
  visibility TEXT NOT NULL DEFAULT 'private', -- private (owner only) | public (everyone)
  owner_id TEXT,
  layout_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dashboard_favorites (
  user_id TEXT NOT NULL,
  dashboard_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, dashboard_id),
  FOREIGN KEY (dashboard_id) REFERENCES dashboards(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dashboard_visits (
  user_id TEXT NOT NULL,
  dashboard_id TEXT NOT NULL,
  visited_at TEXT NOT NULL,
  PRIMARY KEY (user_id, dashboard_id),
  FOREIGN KEY (dashboard_id) REFERENCES dashboards(id) ON DELETE CASCADE
);

-- Projects a user saved ("starred") to the Spaces section of the sidebar (at most 5 each).
CREATE TABLE IF NOT EXISTS space_pins (
  user_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, space_id),
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
);

-- Per-project feature visibility (project tabs). A row with enabled = 0 hides that tab.
CREATE TABLE IF NOT EXISTS space_features (
  space_id TEXT NOT NULL,
  feature_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (space_id, feature_key),
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
);

-- Work item workflows: states and the transitions allowed between them.
-- Seeded on start-up (backend/src/workflows.js) when empty; status changes are checked against these rows.
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  issue_types_json TEXT NOT NULL DEFAULT '[]',
  is_default INTEGER NOT NULL DEFAULT 0,
  completion_requires_children INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_states (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'todo',   -- todo | progress | done | closed
  color TEXT NOT NULL DEFAULT 'slate',
  is_initial INTEGER NOT NULL DEFAULT 0,
  x REAL NOT NULL DEFAULT 0,               -- diagram position
  y REAL NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE (workflow_id, name),
  FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workflow_transitions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  name TEXT NOT NULL,
  from_state_id TEXT,                      -- NULL = from any state
  to_state_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
  FOREIGN KEY (from_state_id) REFERENCES workflow_states(id) ON DELETE CASCADE,
  FOREIGN KEY (to_state_id) REFERENCES workflow_states(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_workflow_states_workflow ON workflow_states(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_transitions_workflow ON workflow_transitions(workflow_id);

-- In-app notifications. Each row is also the email outbox entry: email_status goes
-- pending -> sent | failed | skipped and is processed by the background mail queue.
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT,
  type TEXT NOT NULL,                      -- assigned | comment | reply | task_updated
  work_item_id TEXT,
  space_id TEXT,
  issue_key TEXT,
  task_title TEXT,
  message TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',    -- e.g. { changes: [{ field, from, to }] }
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  read_at TEXT,
  email_status TEXT NOT NULL DEFAULT 'pending',
  email_attempts INTEGER NOT NULL DEFAULT 0,
  email_error TEXT,
  email_next_at TEXT,                      -- retry not before this time
  emailed_at TEXT,
  FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id, is_read, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_email ON notifications(email_status, created_at);

-- Users following (watching) a work item; they get "Task Updated" notifications.
CREATE TABLE IF NOT EXISTS work_item_watchers (
  work_item_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (work_item_id, user_id),
  FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_watchers_user ON work_item_watchers(user_id);
