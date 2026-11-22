// Log work rules, shared by the Log work modal and the API (the server checks again).
//   - From (required) .. To (optional: empty = the From day only), one record per day
//   - only days within one month up to today: from the same day last month to today
//   - a duration per day: hours (whole number 1..12) + minutes, at most 12h00m in total
//   - together with what the person already logged that day: at most 12h per day
//   - a description of the work

export const MAX_MINUTES_PER_DAY = 12 * 60;
// Longest possible window: the same day last month .. today, both included (e.g. 22/10..22/11).
export const MAX_RANGE_DAYS = 32;
export const MAX_DESCRIPTION = 2000;
export const DAILY_LIMIT_MESSAGE = 'Exceeds the allowed working hours (max 12 hours/day)';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86400000;

/** 'YYYY-MM-DD' -> UTC midnight in ms, or null when it is not a real date. */
export function parseDay(value) {
  const match = DATE.exec(String(value || ''));
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const time = Date.UTC(y, m - 1, d);
  const date = new Date(time);
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? time : null;
}

function dayText(time) {
  const date = new Date(time);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' -> 'DD/MM/YYYY'. */
export function formatDay(value) {
  const match = DATE.exec(String(value || ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || '');
}

/** Number of days from..to, both included (1 for the same day; 0 when to < from or invalid). */
export function countDays(from, to) {
  const start = parseDay(from);
  const end = parseDay(to);
  if (start === null || end === null || end < start) return 0;
  return Math.round((end - start) / DAY_MS) + 1;
}

/** Every day from..to as 'YYYY-MM-DD' (empty when the range is invalid or too long). */
export function datesInRange(from, to, limit = MAX_RANGE_DAYS) {
  const days = countDays(from, to);
  if (!days || days > limit) return [];
  const start = parseDay(from);
  return Array.from({ length: days }, (_, index) => dayText(start + index * DAY_MS));
}

/** 'YYYY-MM-DD' of today in the given time zone offset (minutes, as Date#getTimezoneOffset). */
export function todayIn(offsetMinutes = new Date().getTimezoneOffset(), now = Date.now()) {
  return dayText(Math.floor((now - offsetMinutes * 60000) / DAY_MS) * DAY_MS);
}

/**
 * Days that may be logged: { min, max } = the same day one month ago .. today
 * (22/11 -> 22/10; 31/03 -> 28/02 or 29/02, the last day of a shorter month).
 */
export function logWindow(today) {
  const time = parseDay(today);
  if (time === null) return { min: '', max: '' };
  const date = new Date(time);
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const lastDayOfPreviousMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const min = Date.UTC(y, m - 1, Math.min(date.getUTCDate(), lastDayOfPreviousMonth));
  return { min: dayText(min), max: today };
}

/** The To day used: empty To = the From day (log one day). */
export function effectiveTo(from, to) {
  return to || from;
}

/** Range problem, or '' when From..To is valid. With `today`, days must be in logWindow(today). */
export function validateRange(from, to, today = '') {
  if (!from) return 'Choose the From date.';
  const end = effectiveTo(from, to);
  if (parseDay(from) === null || parseDay(end) === null) return 'The date is not valid.';
  if (parseDay(end) < parseDay(from)) return 'The To date must be on or after the From date.';
  if (today) {
    const allowed = logWindow(today);
    if (parseDay(end) > parseDay(allowed.max)) return 'You cannot log work for a future date.';
    if (parseDay(from) < parseDay(allowed.min)) return `You can only log work for the last month (${formatDay(allowed.min)} to ${formatDay(allowed.max)}).`;
  }
  if (countDays(from, end) > MAX_RANGE_DAYS) return 'The date range can be at most one month.';
  return '';
}

export const MAX_HOURS = 12;

/** Hours problem, or ''. Hours are a whole number from 1 to 12. */
export function validateHours(hours) {
  const text = String(hours ?? '').trim();
  if (!text) return 'Enter the hours (a whole number from 1 to 12).';
  if (!/^\d+$/.test(text)) return 'Hours must be a whole number from 1 to 12.';
  const value = Number(text);
  if (value < 1 || value > MAX_HOURS) return 'Hours must be a whole number from 1 to 12.';
  return '';
}

/** Minutes problem, or ''. Minutes are optional: a whole number, 0 or more (90 = 1h 30m). */
export function validateMinutes(minutes) {
  const text = String(minutes ?? '').trim();
  if (!text) return '';
  if (!/^\d+$/.test(text)) return 'Minutes must be a whole number (0 or more).';
  return '';
}

/**
 * Hours + minutes -> total minutes, or NaN when the hours or minutes are not valid
 * (see validateHours / validateMinutes). Minutes above 59 are carried (90m = 1h 30m).
 */
export function toMinutes(hours, minutes) {
  if (validateHours(hours) || validateMinutes(minutes)) return NaN;
  return Number(String(hours).trim()) * 60 + (String(minutes ?? '').trim() ? Number(String(minutes).trim()) : 0);
}

/** 90 -> { hours: 1, minutes: 30 } */
export function splitMinutes(total) {
  const value = Math.max(0, Math.round(Number(total) || 0));
  return { hours: Math.floor(value / 60), minutes: value % 60 };
}

/** 90 -> '1h 30m', 480 -> '8h', 45 -> '45m' */
export function formatDuration(total) {
  const { hours, minutes } = splitMinutes(total);
  if (!hours && !minutes) return '0m';
  return [hours ? `${hours}h` : '', minutes ? `${minutes}m` : ''].filter(Boolean).join(' ');
}

/** Duration problem for one day (hours + minutes), or ''. */
export function validateDuration(hours, minutes) {
  const problem = validateHours(hours) || validateMinutes(minutes);
  if (problem) return problem;
  const total = toMinutes(hours, minutes);
  if (total > MAX_MINUTES_PER_DAY) return `${DAILY_LIMIT_MESSAGE}. You entered ${formatDuration(total)}.`;
  return '';
}

/**
 * Days that would go over 12h. existing: { 'YYYY-MM-DD': minutes already logged }.
 * Returns [{ date, existing, total }].
 */
export function overLimitDays(dates, minutesPerDay, existing = {}) {
  return dates
    .map((date) => ({ date, existing: Number(existing[date]) || 0, total: (Number(existing[date]) || 0) + minutesPerDay }))
    .filter((day) => day.total > MAX_MINUTES_PER_DAY);
}

/**
 * Checks a whole Log work entry.
 * Returns { ok, errors: { range, duration, daily, description }, dates, minutesPerDay, totalMinutes }.
 */
export function validateWorkLog({ fromDate, toDate, hours, minutes, description }, existing = {}, today = '') {
  const errors = {};
  toDate = effectiveTo(fromDate, toDate);
  const range = validateRange(fromDate, toDate, today);
  if (range) errors.range = range;
  const minutesPerDay = toMinutes(hours, minutes);
  const duration = validateDuration(hours, minutes);
  if (duration) errors.duration = duration;
  const dates = range ? [] : datesInRange(fromDate, toDate);
  if (!range && !duration) {
    const over = overLimitDays(dates, minutesPerDay, existing);
    if (over.length) {
      const list = over.slice(0, 3).map((day) => `${formatDay(day.date)} (already logged ${formatDuration(day.existing)})`).join(', ');
      errors.daily = `${DAILY_LIMIT_MESSAGE}: ${list}${over.length > 3 ? ` and ${over.length - 3} more days` : ''}.`;
    }
  }
  const text = String(description ?? '').trim();
  if (!text) errors.description = 'Describe the work you did.';
  else if (text.length > MAX_DESCRIPTION) errors.description = `The description can have at most ${MAX_DESCRIPTION} characters.`;
  return {
    ok: Object.keys(errors).length === 0,
    errors,
    dates,
    minutesPerDay: Number.isNaN(minutesPerDay) ? 0 : minutesPerDay,
    totalMinutes: Number.isNaN(minutesPerDay) ? 0 : minutesPerDay * dates.length
  };
}
