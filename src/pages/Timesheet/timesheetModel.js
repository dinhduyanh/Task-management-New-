// Timesheet model: date ranges, period columns and the grouped rows of the matrix.
// Pure functions (no React) so they can be tested on their own.

const DAY = 86400000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const collator = new Intl.Collator('vi', { sensitivity: 'base', numeric: true });

export const PERIODS = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' }
];
export const MAX_DAY_COLUMNS = 93; // about a quarter of day columns

/* ---------------------------------------------------------------- dates */

export function parseIso(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

export function toIso(time) {
  const date = new Date(time);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function todayIso() {
  const now = new Date();
  return toIso(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

export function addDays(iso, days) {
  return toIso(parseIso(iso) + days * DAY);
}

/** Every day from..to (inclusive). */
export function daysBetween(from, to) {
  const start = parseIso(from);
  const end = parseIso(to);
  if (start === null || end === null || end < start) return [];
  return Array.from({ length: Math.round((end - start) / DAY) + 1 }, (_, index) => toIso(start + index * DAY));
}

/** Month (Day / Week periods) or year (Month period) containing `anchor`. */
export function defaultRange(period, anchor = todayIso()) {
  const date = new Date(parseIso(anchor));
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  if (period === 'month') return { from: `${y}-01-01`, to: `${y}-12-31` };
  return { from: toIso(Date.UTC(y, m, 1)), to: toIso(Date.UTC(y, m + 1, 0)) };
}

/** The previous / next month (or year for the Month period); custom ranges move by their length. */
export function shiftRange(range, period, direction) {
  if (period === 'month') {
    const year = Number(range.from.slice(0, 4)) + direction;
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
  const start = new Date(parseIso(range.from));
  const isWholeMonth = start.getUTCDate() === 1 && range.to === defaultRange('day', range.from).to;
  if (isWholeMonth) return defaultRange(period, toIso(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + direction, 1)));
  const length = daysBetween(range.from, range.to).length;
  return { from: addDays(range.from, direction * length), to: addDays(range.to, direction * length) };
}

/** "November, 2026", "2026" or "Nov 1 - Dec 15, 2026". */
export function rangeTitle(range, period) {
  const from = new Date(parseIso(range.from));
  const to = new Date(parseIso(range.to));
  if (period === 'month') return String(from.getUTCFullYear());
  if (range.from === defaultRange('day', range.from).from && range.to === defaultRange('day', range.from).to) {
    return `${MONTH_NAMES[from.getUTCMonth()]}, ${from.getUTCFullYear()}`;
  }
  return `${MONTHS[from.getUTCMonth()]} ${from.getUTCDate()} - ${MONTHS[to.getUTCMonth()]} ${to.getUTCDate()}, ${to.getUTCFullYear()}`;
}

/** "Nov 1 - Nov 30" */
export function rangeLabel(range) {
  const from = new Date(parseIso(range.from));
  const to = new Date(parseIso(range.to));
  return `${MONTHS[from.getUTCMonth()]} ${from.getUTCDate()} - ${MONTHS[to.getUTCMonth()]} ${to.getUTCDate()}`;
}

/* -------------------------------------------------------------- columns */

/** Monday of the week of `iso`. */
function weekStart(iso) {
  const time = parseIso(iso);
  const weekday = (new Date(time).getUTCDay() + 6) % 7;
  return toIso(time - weekday * DAY);
}

/** ISO week number. */
function weekNumber(iso) {
  const date = new Date(parseIso(iso));
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7)));
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((thursday - firstThursday) / DAY - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

/** The column an entry date belongs to. */
export function columnKey(iso, period) {
  if (period === 'week') return weekStart(iso);
  if (period === 'month') return iso.slice(0, 7);
  return iso;
}

/**
 * Columns of the matrix: [{ key, label, sub, weekend, today, days }].
 * Week columns start on Monday and are cut to the range.
 */
export function buildColumns(range, period, today = todayIso()) {
  const days = daysBetween(range.from, range.to);
  if (period === 'day') {
    return days.map((iso) => {
      const date = new Date(parseIso(iso));
      const weekday = date.getUTCDay();
      return { key: iso, label: `${WEEKDAYS[weekday]}, ${String(date.getUTCDate()).padStart(2, '0')} ${MONTHS[date.getUTCMonth()]}`, weekend: weekday === 0 || weekday === 6, today: iso === today, days: [iso] };
    });
  }
  const groups = new Map();
  days.forEach((iso) => {
    const key = columnKey(iso, period);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(iso);
  });
  return [...groups.entries()].map(([key, list]) => {
    const first = new Date(parseIso(list[0]));
    const last = new Date(parseIso(list[list.length - 1]));
    if (period === 'month') {
      return { key, label: `${MONTHS[first.getUTCMonth()]} ${first.getUTCFullYear()}`, weekend: false, today: key === today.slice(0, 7), days: list };
    }
    const span = `${String(first.getUTCDate()).padStart(2, '0')} ${MONTHS[first.getUTCMonth()]} - ${String(last.getUTCDate()).padStart(2, '0')} ${MONTHS[last.getUTCMonth()]}`;
    return { key, label: `Week ${weekNumber(list[0])}`, sub: span, weekend: false, today: list.includes(today), days: list };
  });
}

/* ------------------------------------------------------------- grouping */

export const CATEGORIES = [
  { id: 'user', label: 'User' },
  { id: 'project', label: 'Project' }
];
export const SUB_GROUPS = [
  { id: 'project', label: 'Project' },
  { id: 'workItem', label: 'Work item' },
  { id: 'user', label: 'User' },
  { id: 'none', label: 'None' }
];

const KEYS = {
  user: (entry) => `u:${entry.user.id}`,
  project: (entry) => `p:${entry.project.id}`,
  workItem: (entry) => `w:${entry.workItem.id}`
};

function describe(kind, entry) {
  if (kind === 'user') return { label: entry.user.fullName || 'Unknown user', person: entry.user };
  if (kind === 'project') return { label: entry.project.name, sub: entry.project.code, project: entry.project };
  return { label: `${entry.workItem.key} ${entry.workItem.title}`, key: entry.workItem.key, title: entry.workItem.title, workItem: entry.workItem, project: entry.project };
}

function group(entries, kind, period, parentId = '') {
  const map = new Map();
  for (const entry of entries) {
    const id = `${parentId}${KEYS[kind](entry)}`;
    if (!map.has(id)) map.set(id, { id, kind, ...describe(kind, entry), total: 0, cells: {}, entries: [] });
    const row = map.get(id);
    const key = columnKey(entry.date, period);
    row.total += entry.minutes;
    row.cells[key] = (row.cells[key] || 0) + entry.minutes;
    row.entries.push(entry);
  }
  return [...map.values()].sort((a, b) => collator.compare(a.label, b.label));
}

/**
 * Rows of the matrix: level 1 by `category` (user / project), each with children by
 * `subGroup` (project / workItem / user / none). Returns { rows, total }.
 * total = { total, cells } for the Total row.
 */
export function buildRows(entries, { category = 'user', subGroup = 'project', period = 'day' } = {}) {
  const second = subGroup === category ? 'none' : subGroup;
  const rows = group(entries, category, period).map((row) => {
    const children = second === 'none' ? [] : group(row.entries, second, period, `${row.id}/`);
    const distinct = new Set(row.entries.map((entry) => KEYS[second === 'none' ? (category === 'user' ? 'project' : 'user') : second](entry))).size;
    return { ...row, children, childCount: distinct, childKind: second === 'none' ? (category === 'user' ? 'project' : 'user') : second };
  });
  const total = { total: 0, cells: {} };
  for (const entry of entries) {
    const key = columnKey(entry.date, period);
    total.total += entry.minutes;
    total.cells[key] = (total.cells[key] || 0) + entry.minutes;
  }
  return { rows, total };
}

/* -------------------------------------------------------------- display */

/** 20 -> "0.33h" (unit hours) or "20m" (unit hm); 0 -> "0h". */
export function formatTime(minutes, unit = 'hours') {
  const value = Math.max(0, Number(minutes) || 0);
  if (unit === 'hm') {
    const h = Math.floor(value / 60);
    const m = value % 60;
    if (!h && !m) return '0h';
    return [h ? `${h}h` : '', m ? `${m}m` : ''].filter(Boolean).join(' ');
  }
  return `${Math.round((value / 60) * 100) / 100}h`;
}

/** Plain number of hours (for exports): 90 -> 1.5 */
export function toHours(minutes) {
  return Math.round(((Number(minutes) || 0) / 60) * 100) / 100;
}

export const CHILD_LABEL = { project: 'project', workItem: 'work item', user: 'user' };
