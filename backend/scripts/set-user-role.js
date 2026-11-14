// Usage: node scripts/set-user-role.js <username-or-email> <admin|user>
// Changes a user's system role directly in the database (e.g. to recover admin access).
import Database from 'better-sqlite3';
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.TASKFLOW_DB_PATH || path.join(backendDirectory, 'data', 'taskflow.sqlite');
const [identity, role] = process.argv.slice(2);

if (!identity || !['admin', 'user'].includes(role)) {
  console.error('Usage: node scripts/set-user-role.js <username-or-email> <admin|user>');
  process.exit(1);
}

const db = new Database(dbPath);
try {
  const columns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
  if (!columns.includes('role')) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
  const user = db.prepare('SELECT id, username FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?) LIMIT 1').get(identity, identity);
  if (!user) {
    console.error(`User not found: ${identity}`);
    process.exitCode = 1;
  } else {
    db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(role, new Date().toISOString(), user.id);
    console.log(`${user.username} is now ${role === 'admin' ? 'an admin' : 'a regular user'}. (Database: ${dbPath})`);
  }
} finally {
  db.close();
}
