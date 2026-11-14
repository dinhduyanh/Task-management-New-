// Workflow definitions based on the approved TASKFLOW workflow diagrams.
// Status transitions are enforced in the List View status dropdown and bulk actions.

export const ISSUE_WORKFLOWS = {
  Epic: {
    initialStatus: 'Backlog',
    transitions: {
      Backlog: ['To Do', 'Cancel'],
      'To Do': ['In Progress', 'Cancel'],
      'In Progress': ['In Review', 'Cancel'],
      'In Review': ['Done', 'Cancel'],
      Done: [],
      Cancel: ['Backlog']
    },
    completionRequiresChildren: true
  },
  Feature: {
    initialStatus: 'Backlog',
    transitions: {
      Backlog: ['To Do', 'Cancel'],
      'To Do': ['In Progress', 'Cancel'],
      'In Progress': ['In Review', 'Cancel'],
      'In Review': ['Done', 'Cancel'],
      Done: [],
      Cancel: ['Backlog']
    },
    completionRequiresChildren: true
  },
  Story: {
    initialStatus: 'To Do',
    transitions: {
      Backlog: ['To Do', 'Cancel'],
      'To Do': ['In Progress', 'Blocked', 'Cancel'],
      'In Progress': ['In Review', 'Blocked'],
      'In Review': ['Done', 'Blocked'],
      Blocked: ['To Do', 'Cancel'],
      Done: ['To Do'],
      Cancel: ['To Do']
    }
  },
  Task: {
    initialStatus: 'To Do',
    transitions: {
      Backlog: ['To Do', 'Cancel'],
      'To Do': ['In Progress', 'Blocked', 'Cancel'],
      'In Progress': ['In Review', 'Blocked'],
      'In Review': ['Done', 'Blocked'],
      Blocked: ['To Do', 'Cancel'],
      Done: ['To Do'],
      Cancel: ['To Do']
    }
  },
  Bug: {
    initialStatus: 'To Do',
    transitions: {
      'To Do': ['In Progress', 'Cancel'],
      'In Progress': ['In Review', 'Cancel'],
      'In Review': ['Done', 'Cancel'],
      Done: ['In Progress'],
      Cancel: ['To Do']
    }
  },
  Improvement: {
    initialStatus: 'To Do',
    transitions: {
      'To Do': ['In Progress', 'Cancel'],
      'In Progress': ['In Review', 'Cancel'],
      'In Review': ['Done', 'Cancel'],
      Done: [],
      Cancel: ['To Do']
    }
  },
  'Sub-task': {
    initialStatus: 'To Do',
    transitions: {
      'To Do': ['In Progress', 'Cancel'],
      'In Progress': ['Done', 'Cancel'],
      Done: [],
      Cancel: ['To Do']
    }
  }
};

const ALL_STATUSES = ['Backlog', 'To Do', 'In Progress', 'In Review', 'Blocked', 'Done', 'Cancel'];

export function normalizeIssueType(typeOrIssue) {
  const raw = typeof typeOrIssue === 'string'
    ? typeOrIssue
    : typeOrIssue?.issueType || typeOrIssue?.type || 'Task';
  return Object.keys(ISSUE_WORKFLOWS).find((type) => type.toLowerCase() === String(raw).toLowerCase()) || 'Task';
}

export function getInitialStatus(typeOrIssue) {
  return ISSUE_WORKFLOWS[normalizeIssueType(typeOrIssue)]?.initialStatus || 'To Do';
}

export function getIssueStatus(issue) {
  const raw = String(issue?.status || getInitialStatus(issue)).trim();
  return ALL_STATUSES.find((status) => status.toLowerCase() === raw.toLowerCase()) || raw || getInitialStatus(issue);
}

function getParentReference(issue) {
  return issue?.parentId ?? issue?.parent?.id ?? issue?.parent?.value ?? issue?.parent ?? issue?.parentKey ?? null;
}

export function getChildIssues(parentIssue, allIssues = []) {
  if (!parentIssue?.id) return [];
  const parentId = String(parentIssue.id);
  const parentKey = String(parentIssue.key || parentIssue.code || '');
  return allIssues.filter((candidate) => {
    if (!candidate || String(candidate.id) === parentId) return false;
    const reference = getParentReference(candidate);
    return reference !== null && (
      String(reference) === parentId ||
      (parentKey && String(reference) === parentKey)
    );
  });
}

function isAllChildrenDone(issue, allIssues) {
  const children = getChildIssues(issue, allIssues);
  return children.every((child) => getIssueStatus(child) === 'Done');
}

function transitionHint(type, currentStatus, targetStatus) {
  if (currentStatus === 'Cancel') return 'Re-open';
  if (currentStatus === 'Done' && targetStatus === 'To Do') return 'Re-open';
  if (currentStatus === 'Blocked' && targetStatus === 'To Do') return 'Rework';
  if (type === 'Bug' && currentStatus === 'Done' && targetStatus === 'In Progress') return 'Re-open';
  return '';
}

export function getTransitionOptions(issue, allIssues = []) {
  const type = normalizeIssueType(issue);
  const workflow = ISSUE_WORKFLOWS[type];
  const currentStatus = getIssueStatus(issue);
  const targets = workflow?.transitions?.[currentStatus] || [];

  return targets.map((targetStatus) => {
    const isDoneBlocked = workflow?.completionRequiresChildren &&
      targetStatus === 'Done' && !isAllChildrenDone(issue, allIssues);

    return {
      status: targetStatus,
      disabled: Boolean(isDoneBlocked),
      reason: isDoneBlocked ? 'Complete all child work items before completing this Epic or Feature.' : '',
      hint: transitionHint(type, currentStatus, targetStatus)
    };
  });
}

export function validateIssueTransition(issue, targetStatus, allIssues = []) {
  const currentStatus = getIssueStatus(issue);
  if (currentStatus === targetStatus) {
    return { allowed: false, reason: 'The work item already has this status.' };
  }
  const option = getTransitionOptions(issue, allIssues).find((item) => item.status === targetStatus);
  if (!option) {
    return {
      allowed: false,
      reason: `Transition from ${currentStatus} to ${targetStatus} is not allowed for ${normalizeIssueType(issue)}.`
    };
  }
  if (option.disabled) return { allowed: false, reason: option.reason };
  return { allowed: true, reason: '' };
}
