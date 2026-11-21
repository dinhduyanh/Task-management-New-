// Compiles a parsed TQL query (shared/tql.js) into a parameterised SQLite query.
//
// Safety: user input never becomes SQL text. Field names map to fixed column
// expressions from the table below, operators to fixed SQL fragments, and every
// value is passed as a "?" parameter. The parser also limits length, nesting and lists.
import { db } from './db.js';
import { spaceFilter } from './access.js';
import { TqlError, parse, fieldByName } from '../../shared/tql.js';

/* -------------------------------------------------------- SQL functions */

/** Lower case without Vietnamese accents, so "thong bao" finds "Thông báo". */
export function fold(value) {
  if (value === null || value === undefined) return null;
  return String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}

db.function('tf_fold', { deterministic: true }, (value) => fold(value));
db.function('tf_key_prefix', { deterministic: true }, (key) => fold(String(key || '').replace(/-?\d+$/, '')));
db.function('tf_key_num', { deterministic: true }, (key) => Number(String(key || '').match(/(\d+)$/)?.[1] || 0));

const PRIORITY_RANK = { highest: 5, high: 4, medium: 3, low: 2, lowest: 1 };
const PRIORITY_SQL = `(CASE tf_fold(w.priority) ${Object.entries(PRIORITY_RANK).map(([name, rank]) => `WHEN '${name}' THEN ${rank}`).join(' ')} ELSE 0 END)`;

const CATEGORY_ALIASES = {
  todo: 'todo', 'to do': 'todo', new: 'todo', open: 'todo',
  progress: 'progress', 'in progress': 'progress', inprogress: 'progress', doing: 'progress',
  done: 'done', complete: 'done', completed: 'done', resolved: 'done',
  closed: 'closed', cancel: 'closed', cancelled: 'closed', canceled: 'closed'
};

// Column expressions; only these strings are ever written into the SQL.
const COLUMNS = {
  key: 'w.issue_key',
  summary: 'w.title',
  description: "json_extract(w.data_json, '$.description')",
  status: 'w.status',
  type: 'w.issue_type',
  priority: 'w.priority',
  assignee: 'w.assignee_id',
  creator: 'w.creator_id',
  sprint: "json_extract(w.data_json, '$.sprintId')",
  created: 'w.created_at',
  updated: 'w.updated_at',
  startDate: 'w.start_date',
  dueDate: 'w.due_date'
};

const ORDER_SQL = {
  key: (dir) => `tf_key_prefix(w.issue_key) ${dir}, tf_key_num(w.issue_key) ${dir}`,
  summary: (dir) => `tf_fold(w.title) ${dir}`,
  description: (dir) => `tf_fold(json_extract(w.data_json, '$.description')) ${dir}`,
  status: (dir) => `tf_fold(w.status) ${dir}`,
  statusCategory: (dir) => `(SELECT MIN(CASE s.category WHEN 'todo' THEN 1 WHEN 'progress' THEN 2 WHEN 'done' THEN 3 ELSE 4 END) FROM workflow_states s WHERE tf_fold(s.name) = tf_fold(w.status)) ${dir}`,
  type: (dir) => `tf_fold(w.issue_type) ${dir}`,
  priority: (dir) => `${PRIORITY_SQL} ${dir}`,
  project: (dir) => `(SELECT tf_fold(name) FROM spaces WHERE id = w.space_id) ${dir}`,
  assignee: (dir) => `(SELECT tf_fold(full_name) FROM users WHERE id = w.assignee_id) IS NULL, (SELECT tf_fold(full_name) FROM users WHERE id = w.assignee_id) ${dir}`,
  creator: (dir) => `(SELECT tf_fold(full_name) FROM users WHERE id = w.creator_id) ${dir}`,
  sprint: (dir) => `(SELECT tf_fold(name) FROM sprints WHERE id = json_extract(w.data_json, '$.sprintId')) IS NULL, (SELECT tf_fold(name) FROM sprints WHERE id = json_extract(w.data_json, '$.sprintId')) ${dir}`,
  labels: (dir) => `w.labels_json ${dir}`,
  created: (dir) => `w.created_at ${dir}`,
  updated: (dir) => `w.updated_at ${dir}`,
  startDate: (dir) => `w.start_date IS NULL, w.start_date ${dir}`,
  dueDate: (dir) => `w.due_date IS NULL, w.due_date ${dir}`
};

/* ---------------------------------------------------------------- dates */

const DAY = 86400000;
const UNIT_MS = { m: 60000, h: 3600000, d: DAY, w: 7 * DAY };

function pad(value) { return String(value).padStart(2, '0'); }

/** Date helpers in the user's time zone (offset = Date#getTimezoneOffset() of the browser). */
function clock(ctx) {
  const offset = ctx.tzOffset * 60000;
  const toLocal = (ms) => new Date(ms - offset); // read with getUTC*
  const fromLocal = (y, m, d, hh = 0, mm = 0, ss = 0, ms = 0) => Date.UTC(y, m, d, hh, mm, ss, ms) + offset;
  const day = (ms) => { const local = toLocal(ms); return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`; };
  return { toLocal, fromLocal, day };
}

function parseOffset(arg, defaultUnit) {
  if (arg === undefined) return { amount: 0, unit: defaultUnit };
  const match = String(arg).match(/^([-+]?\d+)([mhdw])?$/i);
  return { amount: Number(match[1]), unit: (match[2] || defaultUnit).toLowerCase() };
}

/** Evaluates a date value to { instant: ms } or { day: 'YYYY-MM-DD' }. */
function dateValue(value, ctx, token) {
  const { toLocal, fromLocal } = clock(ctx);
  const now = ctx.now;
  if (value.kind === 'literal') {
    const text = value.value;
    const relative = text.match(/^([-+]?\d+)([mhdw])$/i);
    if (relative) return { instant: now + Number(relative[1]) * UNIT_MS[relative[2].toLowerCase()] };
    const [datePart, timePart] = text.split(/[ T]/);
    if (!timePart) return { day: datePart };
    const [y, m, d] = datePart.split('-').map(Number);
    const [hh, mm, ss = 0] = timePart.split(':').map(Number);
    return { instant: fromLocal(y, m - 1, d, hh, mm, ss) };
  }
  if (value.kind === 'function') {
    const local = toLocal(now);
    const Y = local.getUTCFullYear(); const M = local.getUTCMonth(); const D = local.getUTCDate();
    const weekday = (local.getUTCDay() + 6) % 7; // Monday = 0
    const shift = (base, defaultUnit) => {
      const { amount, unit } = parseOffset(value.args[0], defaultUnit);
      if (unit === 'month') { const date = new Date(base - ctx.tzOffset * 60000); date.setUTCMonth(date.getUTCMonth() + amount); return date.getTime() + ctx.tzOffset * 60000; }
      return base + amount * UNIT_MS[unit];
    };
    switch (value.name) {
      case 'now': return { instant: shift(now, 'd') };
      case 'startOfDay': return { instant: shift(fromLocal(Y, M, D), 'd') };
      case 'endOfDay': return { instant: shift(fromLocal(Y, M, D, 23, 59, 59, 999), 'd') };
      case 'startOfWeek': return { instant: shift(fromLocal(Y, M, D - weekday), 'w') };
      case 'endOfWeek': return { instant: shift(fromLocal(Y, M, D - weekday + 6, 23, 59, 59, 999), 'w') };
      case 'startOfMonth': return { instant: shift(fromLocal(Y, M, 1), 'month') };
      case 'endOfMonth': {
        const { amount } = parseOffset(value.args[0], 'month');
        return { instant: fromLocal(Y, M + amount + 1, 0, 23, 59, 59, 999) };
      }
      default: break;
    }
  }
  throw new TqlError('Expected a date.', token?.start || 0, token?.end || 1);
}

/* -------------------------------------------------------------- compile */

function placeholders(count) { return Array.from({ length: count }, () => '?').join(', '); }

function literals(value) {
  return value.kind === 'list' ? value.values : [value];
}

function likePattern(text) {
  return `%${fold(text).replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function compileText(column, op, value) {
  const empty = `(${column} IS NULL OR trim(${column}) = '')`;
  if (op === 'IS EMPTY') return { sql: empty, params: [] };
  if (op === 'IS NOT EMPTY') return { sql: `NOT ${empty}`, params: [] };
  const items = literals(value).map((item) => item.value);
  switch (op) {
    case '=': return { sql: `tf_fold(${column}) = ?`, params: [fold(items[0])] };
    case '!=': return { sql: `(${column} IS NULL OR tf_fold(${column}) <> ?)`, params: [fold(items[0])] };
    case '~': return { sql: `tf_fold(${column}) LIKE ? ESCAPE '\\'`, params: [likePattern(items[0])] };
    case '!~': return { sql: `(${column} IS NULL OR tf_fold(${column}) NOT LIKE ? ESCAPE '\\')`, params: [likePattern(items[0])] };
    case 'IN': return { sql: `tf_fold(${column}) IN (${placeholders(items.length)})`, params: items.map(fold) };
    case 'NOT IN': return { sql: `(${column} IS NULL OR tf_fold(${column}) NOT IN (${placeholders(items.length)}))`, params: items.map(fold) };
    default: throw new TqlError(`Unsupported operator ${op}.`);
  }
}

/** Fields whose values are looked up (project, people, sprint): "column IN (subquery)". */
function compileLookup(column, op, value, matchOne) {
  const empty = `(${column} IS NULL OR ${column} = '')`;
  if (op === 'IS EMPTY') return { sql: empty, params: [] };
  if (op === 'IS NOT EMPTY') return { sql: `NOT ${empty}`, params: [] };
  const parts = literals(value).map(matchOne);
  const sql = `(${parts.map((part) => part.sql).join(' OR ')})`;
  const params = parts.flatMap((part) => part.params);
  if (op === '=' || op === 'IN') return { sql, params };
  return { sql: `(${column} IS NULL OR ${column} = '' OR NOT ${sql})`, params };
}

function compileClause(clause, ctx) {
  const { field, op, value } = clause;
  const fail = (message) => { throw new TqlError(message, clause.start, clause.end); };

  if (field === 'key' || field === 'summary' || field === 'description' || field === 'status' || field === 'type') {
    return compileText(COLUMNS[field], op, value);
  }

  if (field === 'priority') {
    if (['>', '>=', '<', '<='].includes(op)) {
      const rank = PRIORITY_RANK[fold(value.value)];
      if (!rank) fail(`"${value.value}" is not a priority. Use Highest, High, Medium, Low or Lowest.`);
      return { sql: `${PRIORITY_SQL} ${op} ?`, params: [rank] };
    }
    return compileText(COLUMNS.priority, op, value);
  }

  if (field === 'statusCategory') {
    if (op === 'IS EMPTY') return { sql: '0', params: [] };
    if (op === 'IS NOT EMPTY') return { sql: '1', params: [] };
    const categories = literals(value).map((item) => {
      const category = CATEGORY_ALIASES[fold(item.value)];
      if (!category) fail(`"${item.value}" is not a status category. Use "To Do", "In Progress", "Done" or "Closed".`);
      return category;
    });
    const sql = `tf_fold(w.status) IN (SELECT tf_fold(name) FROM workflow_states WHERE category IN (${placeholders(categories.length)}))`;
    return { sql: op === '=' || op === 'IN' ? sql : `NOT ${sql}`, params: categories };
  }

  if (field === 'project') {
    return compileLookup('w.space_id', op, value, (item) => ({
      sql: 'w.space_id IN (SELECT id FROM spaces WHERE id = ? OR tf_fold(code) = ? OR tf_fold(name) = ? OR tf_fold(task_key_prefix) = ?)',
      params: [item.value, fold(item.value), fold(item.value), fold(item.value)]
    }));
  }

  if (field === 'assignee' || field === 'creator') {
    const column = COLUMNS[field];
    return compileLookup(column, op, value, (item) => {
      if (item.kind === 'function') return { sql: `${column} = ?`, params: [ctx.user.id] };
      return {
        sql: `${column} IN (SELECT id FROM users WHERE id = ? OR tf_fold(email) = ? OR tf_fold(username) = ? OR tf_fold(full_name) = ?)`,
        params: [item.value, fold(item.value), fold(item.value), fold(item.value)]
      };
    });
  }

  if (field === 'sprint') {
    const column = COLUMNS.sprint;
    return compileLookup(column, op, value, (item) => ({
      sql: `${column} IN (SELECT id FROM sprints WHERE id = ? OR tf_fold(name) = ?)`,
      params: [item.value, fold(item.value)]
    }));
  }

  if (field === 'labels') {
    const label = "tf_fold(CASE WHEN je.type = 'object' THEN json_extract(je.value, '$.name') ELSE je.value END)";
    const labelsOf = "json_each(CASE WHEN json_valid(w.labels_json) THEN w.labels_json ELSE '[]' END) je";
    if (op === 'IS EMPTY' || op === 'IS NOT EMPTY') {
      const sql = `EXISTS (SELECT 1 FROM ${labelsOf})`;
      return { sql: op === 'IS EMPTY' ? `NOT ${sql}` : sql, params: [] };
    }
    if (op === '~') return { sql: `EXISTS (SELECT 1 FROM ${labelsOf} WHERE ${label} LIKE ? ESCAPE '\\')`, params: [likePattern(value.value)] };
    const items = literals(value).map((item) => fold(item.value));
    const sql = `EXISTS (SELECT 1 FROM ${labelsOf} WHERE ${label} IN (${placeholders(items.length)}))`;
    return { sql: op === '=' || op === 'IN' ? sql : `NOT ${sql}`, params: items };
  }

  if (field === 'startDate' || field === 'dueDate' || field === 'created' || field === 'updated') {
    const column = COLUMNS[field];
    const empty = `(${column} IS NULL OR ${column} = '')`;
    if (op === 'IS EMPTY') return { sql: empty, params: [] };
    if (op === 'IS NOT EMPTY') return { sql: `NOT ${empty}`, params: [] };
    const target = dateValue(value, ctx, clause);
    const { fromLocal, day } = clock(ctx);
    if (field === 'startDate' || field === 'dueDate') {
      // Stored as calendar days (YYYY-MM-DD): compare days.
      const text = target.day || day(target.instant);
      const sqlOp = op === '!=' ? '<>' : op;
      const sql = `(${column} IS NOT NULL AND ${column} <> '' AND substr(${column}, 1, 10) ${sqlOp} ?)`;
      return { sql: op === '!=' ? `(${empty} OR substr(${column}, 1, 10) <> ?)` : sql, params: [text] };
    }
    // created / updated are instants (ISO, UTC).
    const iso = (ms) => new Date(ms).toISOString();
    if (target.instant !== undefined) {
      const sqlOp = op === '!=' ? '<>' : op;
      return { sql: `${column} ${sqlOp} ?`, params: [iso(target.instant)] };
    }
    const [y, m, d] = target.day.split('-').map(Number);
    const start = iso(fromLocal(y, m - 1, d));
    const end = iso(fromLocal(y, m - 1, d + 1));
    switch (op) {
      case '=': return { sql: `(${column} >= ? AND ${column} < ?)`, params: [start, end] };
      case '!=': return { sql: `(${column} < ? OR ${column} >= ?)`, params: [start, end] };
      case '>': return { sql: `${column} >= ?`, params: [end] };
      case '>=': return { sql: `${column} >= ?`, params: [start] };
      case '<': return { sql: `${column} < ?`, params: [start] };
      case '<=': return { sql: `${column} < ?`, params: [end] };
      default: break;
    }
  }
  return fail(`Cannot filter by ${field}.`);
}

function compileNode(node, ctx) {
  if (!node) return { sql: '1 = 1', params: [] };
  if (node.type === 'clause') return compileClause(node, ctx);
  if (node.type === 'not') {
    const inner = compileNode(node.expr, ctx);
    return { sql: `NOT (${inner.sql})`, params: inner.params };
  }
  const left = compileNode(node.left, ctx);
  const right = compileNode(node.right, ctx);
  return { sql: `(${left.sql} ${node.type === 'and' ? 'AND' : 'OR'} ${right.sql})`, params: [...left.params, ...right.params] };
}

/**
 * TQL -> { where: { sql, params }, orderSql, orderBy }.
 * ctx: { user, tzOffset (minutes, as Date#getTimezoneOffset), now (ms) }
 */
export function compileTql(tql, ctx) {
  const ast = parse(tql);
  const context = { ...ctx, now: Number.isFinite(ctx.now) ? ctx.now : Date.now(), tzOffset: Number(ctx.tzOffset) || 0 };
  if (!Number.isFinite(context.tzOffset) || Math.abs(context.tzOffset) > 14 * 60) context.tzOffset = 0;
  const where = compileNode(ast.where, context);
  const orderBy = ast.orderBy.length ? ast.orderBy : [{ field: 'created', direction: 'DESC' }];
  const orderSql = [...orderBy.map(({ field, direction }) => ORDER_SQL[fieldByName(field).name](direction === 'DESC' ? 'DESC' : 'ASC')), 'w.created_at DESC', 'w.id'].join(', ');
  return { ast, where, orderSql, orderBy };
}

/**
 * Work items that match the query, one page at a time. Returns { rows, total, orderBy }.
 * allProjects: search every project of the system (Filters), not only the user's projects.
 */
export function searchWorkItems({ user, tql = '', page = 1, pageSize = 20, tzOffset = 0, now, allProjects = false }) {
  const { where, orderSql, orderBy } = compileTql(tql, { user, tzOffset, now });
  const access = allProjects ? { sql: '1 = 1', params: [] } : spaceFilter(user, 'w.space_id');
  const whereSql = `WHERE ${access.sql} AND ${where.sql}`;
  const params = [...access.params, ...where.params];
  const size = Math.min(Math.max(Number(pageSize) || 20, 1), 200);
  const current = Math.max(Number(page) || 1, 1);
  const total = db.prepare(`SELECT COUNT(*) AS count FROM work_items w ${whereSql}`).get(...params).count;
  const rows = db.prepare(`SELECT w.* FROM work_items w ${whereSql} ORDER BY ${orderSql} LIMIT ? OFFSET ?`)
    .all(...params, size, (current - 1) * size);
  return { rows, total, page: current, pageSize: size, orderBy };
}
