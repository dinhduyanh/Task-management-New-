import Database from 'better-sqlite3';
import {
  randomBytes,
  scrypt as scryptCallback
} from 'node:crypto';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scrypt = promisify(scryptCallback);

const currentDirectory = path.dirname(
  fileURLToPath(import.meta.url)
);

// backend/scripts -> backend
const backendDirectory = path.resolve(currentDirectory, '..');

const dataDirectory = path.join(
  backendDirectory,
  'data'
);

// Đảm bảo thư mục Database tồn tại
fs.mkdirSync(dataDirectory, {
  recursive: true
});

// Đồng bộ đường dẫn với db.js
const dbPath = process.env.TASKFLOW_DB_PATH
  || path.join(dataDirectory, 'taskflow.sqlite');

const [identity, password] = process.argv.slice(2);

if (!identity || !password) {
  console.error(
    'Usage: node scripts/set-user-password.js <username-or-email> <password>'
  );

  process.exit(1);
}

// Validate password
if (
  !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{6,}$/.test(password)
) {
  console.error(
    'Password must be >=6 characters and include uppercase, lowercase, number and special character.'
  );

  process.exit(1);
}

let db;

try {
  console.log('Database path:', dbPath);

  db = new Database(dbPath);

  const user = db.prepare(`
    SELECT id, username, email
    FROM users
    WHERE lower(username) = lower(?)
       OR lower(email) = lower(?)
    LIMIT 1
  `).get(identity, identity);

  if (!user) {
    console.error(`User not found: ${identity}`);
    console.error('Please create the user record first.');

    process.exitCode = 1;
  } else {
    const salt = randomBytes(16);

    const hash = await scrypt(
      password,
      salt,
      64
    );

    const passwordHash = [
      'scrypt',
      salt.toString('hex'),
      hash.toString('hex')
    ].join('$');

    db.prepare(`
      UPDATE users
      SET password_hash = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      passwordHash,
      new Date().toISOString(),
      user.id
    );

    console.log('--------------------------------');
    console.log('Password initialized successfully!');
    console.log('Username:', user.username);
    console.log('Email:', user.email);
    console.log('Database:', dbPath);
    console.log('--------------------------------');
  }

} catch (error) {
  console.error('Failed to initialize password:');
  console.error(error.message);

  process.exitCode = 1;

} finally {
  if (db) {
    db.close();
  }
}
