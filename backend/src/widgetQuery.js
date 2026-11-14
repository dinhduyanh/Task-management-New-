// Runs the SQL of dashboard widgets. Widgets are written by administrators, so this is a
// safety net rather than a sandbox:
//  - a separate READ-ONLY connection (writes such as INSERT/UPDATE/DELETE/DROP fail),
//  - exactly one SELECT / WITH statement,
//  - no access to sign-in secrets (session tokens, password hashes),
//  - at most MAX_ROWS rows are returned.
// A very slow query still blocks the server while it runs (SQLite has no query timeout here).
import Database from 'better-sqlite3';
import { databasePath } from './db.js';

export const MAX_ROWS = 500;
export const MAX_SQL_LENGTH = 5000;
export const CHART_TYPES = ['table', 'number', 'bar', 'line', 'pie'];

const SECRET_NAMES = /\b(auth_sessions|password_hash|token_hash)\b/i;
const SECRET_COLUMNS = new Set(['password_hash', 'token_hash']);

let readonlyDb = null;
function connection() {
  if (!readonlyDb) readonlyDb = new Database(databasePath, { readonly: true, fileMustExist: true });
  return readonlyDb;
}

/** Prepares the statement after checking it; throws an Error with a user-facing message. */
function prepareWidgetSql(sql) {
  const text = String(sql || '').trim().replace(/;+\s*$/, '');
  if (!text) throw new Error('SQL query is required.');
  if (text.length > MAX_SQL_LENGTH) throw new Error(`SQL query must be ${MAX_SQL_LENGTH} characters or fewer.`);
  if (!/^(select|with)\b/i.test(text.replace(/^(\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)+/, ''))) {
    throw new Error('Only SELECT queries (optionally starting with WITH) are allowed.');
  }
  if (SECRET_NAMES.test(text)) throw new Error('Queries cannot read sign-in data (sessions or password hashes).');
  let statement;
  try {
    statement = connection().prepare(text);
  } catch (error) {
    throw new Error(`SQL error: ${error.message}`, { cause: error });
  }
  if (!statement.reader || !statement.readonly) throw new Error('Only read-only queries that return rows are allowed.');
  return statement;
}

/** Throws when the SQL is not acceptable. */
export function validateWidgetSql(sql) {
  prepareWidgetSql(sql);
}

/** { columns, rows, truncated } with rows as arrays (secret columns removed). */
export function runWidgetSql(sql) {
  const statement = prepareWidgetSql(sql);
  const allColumns = statement.columns().map((column) => column.name);
  const keep = allColumns.map((name) => !SECRET_COLUMNS.has(String(name).toLowerCase()));
  const rows = [];
  let truncated = false;
  try {
    for (const row of statement.raw(true).iterate()) {
      if (rows.length >= MAX_ROWS) { truncated = true; break; }
      rows.push(row.filter((_, index) => keep[index]).map((value) => {
        if (typeof value === 'bigint') return Number(value);
        if (value instanceof Uint8Array) return `[binary, ${value.length} bytes]`; // e.g. file contents
        return value;
      }));
    }
  } catch (error) {
    throw new Error(`SQL error: ${error.message}`, { cause: error });
  }
  return { columns: allColumns.filter((_, index) => keep[index]), rows, truncated };
}
