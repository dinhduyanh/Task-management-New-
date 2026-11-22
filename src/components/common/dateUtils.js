// Date helpers for the date picker. Dates are exchanged as 'YYYY-MM-DD' strings (same as <input type="date">).
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTHS_SHORT = MONTHS.map((month) => month.slice(0, 3));
export const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const POPOVER_WIDTH = 296;

export function pad(number) { return String(number).padStart(2, '0'); }
export function toIso(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
export function parseIso(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}
/** "16 Nov 2026" */
export function formatDisplayDate(value) {
  const date = parseIso(value);
  return date ? `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}` : '';
}
export function sameDay(a, b) { return Boolean(a && b) && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
export function addDays(date, days) { const next = new Date(date); next.setDate(next.getDate() + days); return next; }
export function addMonths(date, months) {
  const next = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(date.getDate(), last));
  return next;
}
export function startOfDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }

