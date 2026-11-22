// Log work rules, shared by the Log work modal and the API (the server checks again).
//   - From (required) .. To (optional: empty = the From day only), one record per day
//   - only days within one month up to today: from the same day last month to today
//   - a duration per day of hours + minutes, more than 0 and at most 12h00m
//   - together with what the person already logged that day: at most 12h per day
//   - a description of the work

export const MAX_MINUTES_PER_DAY = 12 * 60;
// Longest possible window: the same day last month .. today, both included (e.g. 22/10..22/11).
export const MAX_RANGE_DAYS = 32;
export const MAX_DESCRIPTION = 2000;
export const DAILY_LIMIT_MESSAGE = 'Quá số giờ làm việc quy định (tối đa 12 giờ/ngày)';

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
  if (!from) return 'Chọn ngày From.';
  const end = effectiveTo(from, to);
  if (parseDay(from) === null || parseDay(end) === null) return 'Ngày không hợp lệ.';
  if (parseDay(end) < parseDay(from)) return 'Ngày To phải bằng hoặc sau ngày From.';
  if (today) {
    const allowed = logWindow(today);
    if (parseDay(end) > parseDay(allowed.max)) return 'Không thể log work cho ngày trong tương lai.';
    if (parseDay(from) < parseDay(allowed.min)) return `Chỉ được log work trong vòng 1 tháng tính đến hôm nay (từ ${formatDay(allowed.min)} đến ${formatDay(allowed.max)}).`;
  }
  if (countDays(from, end) > MAX_RANGE_DAYS) return 'Khoảng thời gian tối đa 1 tháng.';
  return '';
}

/**
 * Hours + minutes -> total minutes, or NaN for invalid input (negative, decimals in
 * minutes, not a number). Empty fields count as 0. Minutes above 59 are allowed and
 * carried into hours (90m = 1h 30m).
 */
export function toMinutes(hours, minutes) {
  const read = (value) => (value === '' || value === null || value === undefined ? 0 : Number(value));
  const h = read(hours);
  const m = read(minutes);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || m < 0) return NaN;
  if (!Number.isInteger(m)) return NaN;
  if (!Number.isInteger(h * 4)) return NaN; // hours in steps of 15 minutes at most (e.g. 1.5, 0.25)
  return Math.round(h * 60) + m;
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

/** Duration problem for one day, or ''. */
export function validateDuration(total) {
  if (Number.isNaN(total)) return 'Giờ và phút phải là số không âm (phút là số nguyên).';
  if (total <= 0) return 'Thời gian phải lớn hơn 0.';
  if (total > MAX_MINUTES_PER_DAY) return `${DAILY_LIMIT_MESSAGE}. Bạn đang nhập ${formatDuration(total)}.`;
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
  const duration = validateDuration(minutesPerDay);
  if (duration) errors.duration = duration;
  const dates = range ? [] : datesInRange(fromDate, toDate);
  if (!range && !duration) {
    const over = overLimitDays(dates, minutesPerDay, existing);
    if (over.length) {
      const list = over.slice(0, 3).map((day) => `${formatDay(day.date)} (đã log ${formatDuration(day.existing)})`).join(', ');
      errors.daily = `${DAILY_LIMIT_MESSAGE}: ${list}${over.length > 3 ? ` và ${over.length - 3} ngày khác` : ''}.`;
    }
  }
  const text = String(description ?? '').trim();
  if (!text) errors.description = 'Nhập nội dung công việc đã thực hiện.';
  else if (text.length > MAX_DESCRIPTION) errors.description = `Nội dung tối đa ${MAX_DESCRIPTION} ký tự.`;
  return {
    ok: Object.keys(errors).length === 0,
    errors,
    dates,
    minutesPerDay: Number.isNaN(minutesPerDay) ? 0 : minutesPerDay,
    totalMinutes: Number.isNaN(minutesPerDay) ? 0 : minutesPerDay * dates.length
  };
}
