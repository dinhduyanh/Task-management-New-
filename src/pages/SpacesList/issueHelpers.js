// Shared helpers for reading work items and filtering/sorting them.
// Used by the Space List and Board views so both behave the same way.
import { getIssueStatus } from './workflows';

export const ISSUE_TYPES = ['Epic', 'Task', 'Bug', 'Improvement', 'Story', 'Sub-task', 'Feature'];
export const STATUSES = ['Backlog', 'To Do', 'In Progress', 'In Review', 'Blocked', 'Done', 'Cancel'];
export const PRIORITIES = ['High', 'Highest', 'Low', 'Lowest', 'Medium'];
export const ORDER_OPTIONS = ['All', 'Newest created', 'Oldest created', 'Most recently updated', 'Least recently updated', 'Highest priority first', 'Lowest priority first', 'Latest start date', 'Earliest start date', 'Latest due date', 'Earliest due date'];
export const EXTRA_FIELDS = ['Priority', 'Start Date', 'End Date', 'Create Date', 'Updated Date'];
export const PRIORITY_RANK = { Highest: 1, High: 2, Medium: 3, Low: 4, Lowest: 5 };

export function issueKey(issue) { return issue.key || issue.code || issue.taskCode || '—'; }
export function issueSummary(issue) { return issue.summary || issue.title || issue.name || 'Untitled work item'; }
export function issueType(issue) {
  const raw = issue.issueType || issue.type || 'Task';
  return ISSUE_TYPES.find((type) => type.toLowerCase() === String(raw).toLowerCase()) || String(raw);
}
export function issueTypeOf(issue) { return issueType(issue); }
export function assigneeName(issue) {
  if (!issue?.assignee) return '';
  return typeof issue.assignee === 'string' ? issue.assignee : issue.assignee.name || issue.assignee.fullName || '';
}
export function dateValue(issue, field) {
  const names = {
    createdAt: ['createdAt', 'createdDate', 'createDate', 'created'],
    updatedAt: ['updatedAt', 'updatedDate', 'lastUpdated'],
    startDate: ['startDate', 'start'],
    dueDate: ['dueDate', 'endDate', 'due', 'end']
  }[field] || [field];
  for (const name of names) if (issue?.[name] !== undefined && issue?.[name] !== null && issue?.[name] !== '') return issue[name];
  return null;
}
export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return new Date(value);
  const text = String(value).trim();
  const match = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (match) return new Date(+match[3], +match[2] - 1, +match[1], +(match[4] || 0), +(match[5] || 0), +(match[6] || 0));
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
export function formatDateTime(value) {
  const date = toDate(value);
  if (!date) return 'None';
  const pad = (number) => String(number).padStart(2, '0');
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
export function toDateInputValue(value) {
  const date = toDate(value);
  if (!date) return '';
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
export function formatDateOnly(value) {
  const date = toDate(value);
  if (!date) return 'None';
  const pad = (number) => String(number).padStart(2, '0');
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
}
export function getInitials(value) {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase() : (parts[0] || '—').slice(0, 2).toUpperCase();
}
export function iconForType(type) {
  const icons = {
    Epic: 'epic',
    Feature: 'feature',
    Task: 'tasks',
    Improvement: 'improvement',
    Bug: 'bug',
    Story: 'story',
    'Sub-task': 'subTask'
  };
  return icons[type] || 'tasks';
}

const DATE_FIELD_BY_FILTER = { 'Start Date': 'startDate', 'End Date': 'dueDate', 'Create Date': 'createdAt', 'Updated Date': 'updatedAt' };

/**
 * True when the issue passes every active filter. Empty filter lists mean "All".
 * `assignees` may contain 'Unassigned'.
 */
export function matchesIssueFilters(issue, {
  keyword = '', types = [], assignees = [], statuses = [], priorities = [], moreFields = [], dateRanges = {}
} = {}) {
  const query = keyword.trim().toLowerCase();
  if (query) {
    const values = [issueKey(issue), issueSummary(issue), issueType(issue), assigneeName(issue)];
    if (!values.some((value) => String(value || '').toLowerCase().includes(query))) return false;
  }
  if (types.length && !types.includes(issueType(issue))) return false;
  if (assignees.length && !assignees.includes(assigneeName(issue) || 'Unassigned')) return false;
  if (statuses.length && !statuses.includes(getIssueStatus(issue))) return false;
  if (priorities.length && !priorities.includes(issue.priority || 'Medium')) return false;
  for (const field of moreFields) {
    const dateKey = DATE_FIELD_BY_FILTER[field];
    if (!dateKey) continue;
    const date = toDate(dateValue(issue, dateKey));
    const range = dateRanges[field] || {};
    if (range.from && (!date || date < new Date(`${range.from}T00:00:00`))) return false;
    if (range.to && (!date || date > new Date(`${range.to}T23:59:59`))) return false;
  }
  return true;
}

export const ORDER_PRESETS = {
  'Newest created': ['createdAt', 'desc'], 'Oldest created': ['createdAt', 'asc'],
  'Most recently updated': ['updatedAt', 'desc'], 'Least recently updated': ['updatedAt', 'asc'],
  'Highest priority first': ['priority', 'asc'], 'Lowest priority first': ['priority', 'desc'],
  'Latest start date': ['startDate', 'desc'], 'Earliest start date': ['startDate', 'asc'],
  'Latest due date': ['dueDate', 'desc'], 'Earliest due date': ['dueDate', 'asc']
};

/** Sorts in place by a field ('priority', a date field, or a text column) and returns the array. */
export function sortIssues(rows, field, direction = 'asc') {
  if (!field) return rows;
  const dateFields = ['createdAt', 'updatedAt', 'startDate', 'dueDate'];
  return rows.sort((a, b) => {
    if (field === 'priority') {
      const delta = (PRIORITY_RANK[a.priority] || 99) - (PRIORITY_RANK[b.priority] || 99);
      return direction === 'asc' ? delta : -delta;
    }
    if (dateFields.includes(field)) {
      const av = toDate(dateValue(a, field))?.getTime() ?? (direction === 'asc' ? Number.MAX_SAFE_INTEGER : 0);
      const bv = toDate(dateValue(b, field))?.getTime() ?? (direction === 'asc' ? Number.MAX_SAFE_INTEGER : 0);
      return direction === 'asc' ? av - bv : bv - av;
    }
    const value = (item) => field === 'assignee' ? assigneeName(item) : field === 'status' ? getIssueStatus(item) : field === 'type' ? issueType(item) : field === 'key' ? issueKey(item) : issueSummary(item);
    return String(value(a) || '').localeCompare(String(value(b) || '')) * (direction === 'asc' ? 1 : -1);
  });
}
