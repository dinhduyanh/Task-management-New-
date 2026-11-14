// Board columns and the statuses mapped into them.
// Stored on the Space as `space.board = { columns: [{ id, name, statuses: [] }] }`.
// A status belongs to at most one column; statuses in no column are "unmapped"
// and their work items are not shown on the board.
import { STATUSES } from '../SpacesList/issueHelpers';
import { getIssueStatus } from '../SpacesList/workflows';

export const DEFAULT_BOARD_COLUMNS = [
  { id: 'col-todo', name: 'To do', statuses: ['To Do'] },
  { id: 'col-in-progress', name: 'In progress', statuses: ['In Progress', 'In Review', 'Blocked'] },
  { id: 'col-done', name: 'Done', statuses: ['Done', 'Cancel'] }
];

const sameText = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

export function createColumnId() {
  return `col-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`;
}

function cloneColumns(columns) {
  return columns.map((column) => ({ ...column, statuses: [...column.statuses] }));
}

/** Columns for a Space, falling back to the defaults. Drops duplicates and invalid entries. */
export function getBoardColumns(space) {
  const stored = space?.board?.columns;
  if (!Array.isArray(stored) || stored.length === 0) return cloneColumns(DEFAULT_BOARD_COLUMNS);

  const seen = new Set();
  return stored
    .filter((column) => column && typeof column === 'object')
    .map((column) => ({
      id: String(column.id || createColumnId()),
      name: String(column.name || '').trim() || 'Untitled',
      statuses: (Array.isArray(column.statuses) ? column.statuses : [])
        .map((status) => String(status).trim())
        .filter((status) => {
          const key = status.toLowerCase();
          if (!status || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
    }));
}

/** Every status the board should know about: workflow statuses, then any custom ones in use. */
export function collectStatuses(columns, issues = []) {
  const all = [...STATUSES];
  const add = (status) => {
    if (status && !all.some((known) => sameText(known, status))) all.push(status);
  };
  columns.forEach((column) => column.statuses.forEach(add));
  issues.forEach((issue) => add(getIssueStatus(issue)));
  return all;
}

export function getUnmappedStatuses(columns, allStatuses) {
  const mapped = columns.flatMap((column) => column.statuses);
  return allStatuses.filter((status) => !mapped.some((item) => sameText(item, status)));
}

export function findColumnForStatus(columns, status) {
  return columns.find((column) => column.statuses.some((item) => sameText(item, status))) || null;
}

export function countIssuesByStatus(issues) {
  const counts = new Map();
  issues.forEach((issue) => {
    const key = getIssueStatus(issue).toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return (status) => counts.get(String(status).toLowerCase()) || 0;
}

/** Returns an error message, or '' when the columns can be saved. */
export function validateBoardColumns(columns) {
  if (!columns.length) return 'The board needs at least one column.';
  const names = columns.map((column) => column.name.trim());
  if (names.some((name) => !name)) return 'Every column needs a name.';
  const duplicate = names.find((name, index) => names.findIndex((other) => sameText(other, name)) !== index);
  if (duplicate) return `Column names must be unique ("${duplicate}" is used twice).`;
  return '';
}
