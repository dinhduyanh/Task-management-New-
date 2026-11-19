// Date maths for the Timeline (Gantt) view. All dates are local calendar days.
import { dateValue, toDate } from '../SpacesList/issueHelpers';

export const ZOOM_LEVELS = {
  week: { label: 'Week', dayWidth: 32 },
  month: { label: 'Month', dayWidth: 10 }
};

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT_MONTHS = MONTH_NAMES.map((name) => name.slice(0, 3));

export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Whole calendar days from `from` to `to` (DST-safe). */
export function diffDays(from, to) {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86400000);
}

/** Monday of the date's week. */
export function startOfWeek(date) {
  const day = (date.getDay() + 6) % 7;
  return addDays(date, -day);
}

/** Parses a work item date. "YYYY-MM-DD" is read as a local day (not UTC midnight). */
export function parseDay(value) {
  if (!value) return null;
  const text = String(value).trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const date = toDate(value);
  return date ? startOfDay(date) : null;
}

/**
 * The bar span for a work item: start date to due date. With only one of them the
 * bar covers that single day. Returns null when the item has no dates.
 */
export function getIssueSpan(issue) {
  const start = parseDay(dateValue(issue, 'startDate'));
  const end = parseDay(dateValue(issue, 'dueDate'));
  if (!start && !end) return null;
  const from = start || end;
  const to = end || start;
  return to < from ? { start: to, end: from } : { start: from, end: to };
}

/** Visible range: a margin around every bar and today, aligned to whole weeks. */
export function computeRange(spans, today, minWeeks = 16) {
  let first = today;
  let last = today;
  spans.forEach((span) => {
    if (span.start < first) first = span.start;
    if (span.end > last) last = span.end;
  });
  const start = startOfWeek(addDays(first, -14));
  let end = addDays(startOfWeek(addDays(last, 42)), 6);
  const minEnd = addDays(start, minWeeks * 7 - 1);
  if (end < minEnd) end = minEnd;
  return { start, end, days: diffDays(start, end) + 1 };
}

/** Month header segments: [{ key, label, offset, length }] in days. */
export function monthSegments(range) {
  const segments = [];
  let cursor = range.start;
  while (cursor <= range.end) {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    const segmentEnd = next > range.end ? addDays(range.end, 1) : next;
    segments.push({
      key: `${cursor.getFullYear()}-${cursor.getMonth()}`,
      label: `${MONTH_NAMES[cursor.getMonth()]} ${cursor.getFullYear()}`,
      shortLabel: `${SHORT_MONTHS[cursor.getMonth()]} ${String(cursor.getFullYear()).slice(2)}`,
      offset: diffDays(range.start, cursor),
      length: diffDays(cursor, segmentEnd)
    });
    cursor = segmentEnd;
  }
  return segments;
}

/** Week header segments (each starts on a Monday). */
export function weekSegments(range) {
  const segments = [];
  for (let offset = 0; offset < range.days; offset += 7) {
    const day = addDays(range.start, offset);
    segments.push({ key: offset, label: `${SHORT_MONTHS[day.getMonth()]} ${day.getDate()}`, offset, length: Math.min(7, range.days - offset) });
  }
  return segments;
}

export function formatDay(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}
