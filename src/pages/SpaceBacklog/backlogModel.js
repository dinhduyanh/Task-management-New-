// Pure helpers for the Backlog view: which list (sprint or backlog) a work item is in,
// its order, status counts and estimates.
import { issueType, statusTone, toDate } from '../SpacesList/issueHelpers';
import { getIssueStatus } from '../SpacesList/workflows';

export const BACKLOG_ID = 'backlog';

export const DEFAULT_VIEW_SETTINGS = {
  showEpics: false,
  showSubtasks: false,
  showEstimates: true
};

/** Status family used for the three counters (to do / in progress / done). */
export function statusGroup(issue) {
  const tone = statusTone(getIssueStatus(issue));
  if (tone === 'done' || tone === 'cancel') return 'done';
  if (tone === 'todo') return 'todo';
  return 'progress';
}

export function getEstimate(issue) {
  const value = Number(issue?.estimate);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Whether the item is listed in the backlog view, according to the view settings. */
export function isPlannable(issue, settings) {
  const type = issueType(issue);
  if ((type === 'Epic' || type === 'Feature') && !settings.showEpics) return false;
  if (type === 'Sub-task' && !settings.showSubtasks) return false;
  return true;
}

function compareRank(a, b) {
  const ra = Number.isFinite(Number(a.rank)) ? Number(a.rank) : Number.MAX_SAFE_INTEGER;
  const rb = Number.isFinite(Number(b.rank)) ? Number(b.rank) : Number.MAX_SAFE_INTEGER;
  if (ra !== rb) return ra - rb;
  return (toDate(a.createdAt)?.getTime() || 0) - (toDate(b.createdAt)?.getTime() || 0);
}

/**
 * Groups items into lists keyed by sprint id (active and future sprints) plus BACKLOG_ID,
 * each in rank order. Items of completed sprints are left out; an unknown sprintId counts
 * as backlog.
 */
export function groupByList(issues, sprints) {
  const lists = new Map([[BACKLOG_ID, []]]);
  const completed = new Set();
  sprints.forEach((sprint) => {
    if (sprint.status === 'completed') completed.add(String(sprint.id));
    else lists.set(String(sprint.id), []);
  });
  issues.forEach((issue) => {
    const sprintId = issue.sprintId ? String(issue.sprintId) : null;
    if (sprintId && completed.has(sprintId)) return;
    const key = sprintId && lists.has(sprintId) ? sprintId : BACKLOG_ID;
    lists.get(key).push(issue);
  });
  lists.forEach((items) => items.sort(compareRank));
  return lists;
}

export function summarize(items) {
  const counts = { todo: 0, progress: 0, done: 0 };
  let estimate = 0;
  let doneEstimate = 0;
  items.forEach((issue) => {
    const group = statusGroup(issue);
    counts[group] += 1;
    const points = getEstimate(issue) || 0;
    estimate += points;
    if (group === 'done') doneEstimate += points;
  });
  return { counts, estimate, doneEstimate, total: items.length };
}

/**
 * New complete order of the target list after dropping `movedIds` before `beforeId`
 * (or at the end when beforeId is null).
 */
export function insertIds(targetIds, movedIds, beforeId) {
  const moving = new Set(movedIds.map(String));
  const remaining = targetIds.map(String).filter((id) => !moving.has(id));
  const index = beforeId && !moving.has(String(beforeId)) ? remaining.indexOf(String(beforeId)) : -1;
  const at = index >= 0 ? index : remaining.length;
  return [...remaining.slice(0, at), ...movedIds.map(String), ...remaining.slice(at)];
}

export function formatShortDate(value) {
  const date = toDate(value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  if (!date) return '';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function todayIso(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function daysLeft(endDate) {
  if (!endDate) return null;
  const end = new Date(`${endDate}T00:00:00`);
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((end - start) / 86400000);
}
