export const ISSUE_WORKFLOWS = {
  Epic: { initialStatus: 'Backlog', transitions: { Backlog: ['To Do', 'Cancel'], 'To Do': ['In Progress', 'Cancel'], 'In Progress': ['In Review', 'Cancel'], 'In Review': ['Done', 'Cancel'], Done: [], Cancel: ['Backlog'] }, completionRequiresChildren: true },
  Feature: { initialStatus: 'Backlog', transitions: { Backlog: ['To Do', 'Cancel'], 'To Do': ['In Progress', 'Cancel'], 'In Progress': ['In Review', 'Cancel'], 'In Review': ['Done', 'Cancel'], Done: [], Cancel: ['Backlog'] }, completionRequiresChildren: true },
  Story: { initialStatus: 'To Do', transitions: { Backlog: ['To Do', 'Cancel'], 'To Do': ['In Progress', 'Blocked', 'Cancel'], 'In Progress': ['In Review', 'Blocked'], 'In Review': ['Done', 'Blocked'], Blocked: ['To Do', 'Cancel'], Done: ['To Do'], Cancel: ['To Do'] } },
  Task: { initialStatus: 'To Do', transitions: { Backlog: ['To Do', 'Cancel'], 'To Do': ['In Progress', 'Blocked', 'Cancel'], 'In Progress': ['In Review', 'Blocked'], 'In Review': ['Done', 'Blocked'], Blocked: ['To Do', 'Cancel'], Done: ['To Do'], Cancel: ['To Do'] } },
  Bug: { initialStatus: 'To Do', transitions: { 'To Do': ['In Progress', 'Cancel'], 'In Progress': ['In Review', 'Cancel'], 'In Review': ['Done', 'Cancel'], Done: ['In Progress'], Cancel: ['To Do'] } },
  Improvement: { initialStatus: 'To Do', transitions: { 'To Do': ['In Progress', 'Cancel'], 'In Progress': ['In Review', 'Cancel'], 'In Review': ['Done', 'Cancel'], Done: [], Cancel: ['To Do'] } },
  'Sub-task': { initialStatus: 'To Do', transitions: { 'To Do': ['In Progress', 'Cancel'], 'In Progress': ['Done', 'Cancel'], Done: [], Cancel: ['To Do'] } }
};

export function normalizeIssueType(value) {
  const raw = String(value || 'Task').trim().toLowerCase();
  return Object.keys(ISSUE_WORKFLOWS).find((type) => type.toLowerCase() === raw) || 'Task';
}

export function initialStatus(value) {
  return ISSUE_WORKFLOWS[normalizeIssueType(value)].initialStatus;
}
