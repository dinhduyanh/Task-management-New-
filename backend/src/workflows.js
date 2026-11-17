// Work item workflows, stored in SQLite (workflows, workflow_states, workflow_transitions).
// Each workflow serves one or more issue types; the server checks every status change against it.
// The tables are seeded from SEED below the first time the server starts.
import { db, nowIso, parseJson } from './db.js';

const STATE_STYLE = {
  Backlog: { category: 'todo', color: 'slate' },
  'To Do': { category: 'todo', color: 'teal' },
  'In Progress': { category: 'progress', color: 'blue' },
  'In Review': { category: 'progress', color: 'amber' },
  Blocked: { category: 'progress', color: 'purple' },
  Done: { category: 'done', color: 'green' },
  Cancel: { category: 'closed', color: 'red' }
};

/** Transition label shown on the diagram arrow, from the target (and source) state. */
function transitionName(from, to) {
  if (to === 'To Do') return from === 'Backlog' ? 'Plan' : from === 'Blocked' ? 'Unblock' : 'Reopen';
  if (to === 'In Progress') return from === 'To Do' ? 'Start' : 'Reopen';
  if (to === 'Backlog') return 'Restore';
  return { 'In Review': 'Review', Done: 'Done', Cancel: 'Cancel', Blocked: 'Block' }[to] || to;
}

// The original per-issue-type rules, grouped where issue types share the same rules.
// layout: diagram coordinates of each state (top-down main flow, side states to the left/right).
const SEED = [
  {
    id: 'wf_task', name: 'Task workflow', isDefault: true, issueTypes: ['Task', 'Story'],
    description: 'Day-to-day work: plan it, build it, review it and finish it. Work that is stuck can be Blocked.',
    initial: 'To Do',
    transitions: { Backlog: ['To Do', 'Cancel'], 'To Do': ['In Progress', 'Blocked', 'Cancel'], 'In Progress': ['In Review', 'Blocked'], 'In Review': ['Done', 'Blocked'], Blocked: ['To Do', 'Cancel'], Done: ['To Do'], Cancel: ['To Do'] },
    layout: { Backlog: [-300, 0], 'To Do': [0, 0], 'In Progress': [0, 150], 'In Review': [0, 300], Done: [0, 450], Blocked: [300, 150], Cancel: [300, 450] }
  },
  {
    id: 'wf_epic_feature', name: 'Epic & Feature workflow', issueTypes: ['Epic', 'Feature'], completionRequiresChildren: true,
    description: 'Large pieces of work start in the Backlog and can only be completed once all their child work items are Done.',
    initial: 'Backlog',
    transitions: { Backlog: ['To Do', 'Cancel'], 'To Do': ['In Progress', 'Cancel'], 'In Progress': ['In Review', 'Cancel'], 'In Review': ['Done', 'Cancel'], Done: [], Cancel: ['Backlog'] },
    layout: { Backlog: [0, 0], 'To Do': [0, 150], 'In Progress': [0, 300], 'In Review': [0, 450], Done: [0, 600], Cancel: [320, 300] }
  },
  {
    id: 'wf_bug', name: 'Bug workflow', issueTypes: ['Bug'],
    description: 'Fix, review and close defects. A Done bug can be reopened if it comes back.',
    initial: 'To Do',
    transitions: { 'To Do': ['In Progress', 'Cancel'], 'In Progress': ['In Review', 'Cancel'], 'In Review': ['Done', 'Cancel'], Done: ['In Progress'], Cancel: ['To Do'] },
    layout: { 'To Do': [0, 0], 'In Progress': [0, 150], 'In Review': [0, 300], Done: [0, 450], Cancel: [320, 225] }
  },
  {
    id: 'wf_improvement', name: 'Improvement workflow', issueTypes: ['Improvement'],
    description: 'Enhancements to existing features: build, review and ship.',
    initial: 'To Do',
    transitions: { 'To Do': ['In Progress', 'Cancel'], 'In Progress': ['In Review', 'Cancel'], 'In Review': ['Done', 'Cancel'], Done: [], Cancel: ['To Do'] },
    layout: { 'To Do': [0, 0], 'In Progress': [0, 150], 'In Review': [0, 300], Done: [0, 450], Cancel: [320, 225] }
  },
  {
    id: 'wf_subtask', name: 'Sub-task workflow', issueTypes: ['Sub-task'],
    description: 'Small steps inside a larger work item: start and finish, no review step.',
    initial: 'To Do',
    transitions: { 'To Do': ['In Progress', 'Cancel'], 'In Progress': ['Done', 'Cancel'], Done: [], Cancel: ['To Do'] },
    layout: { 'To Do': [0, 0], 'In Progress': [0, 150], Done: [0, 300], Cancel: [320, 150] }
  }
];

const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-');

function seedWorkflows() {
  if (db.prepare('SELECT COUNT(*) AS count FROM workflows').get().count) return;
  const now = nowIso();
  db.transaction(() => {
    SEED.forEach((workflow, index) => {
      db.prepare(`INSERT INTO workflows (id, name, description, issue_types_json, is_default, completion_requires_children, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(workflow.id, workflow.name, workflow.description, JSON.stringify(workflow.issueTypes),
        workflow.isDefault ? 1 : 0, workflow.completionRequiresChildren ? 1 : 0, index, now, now);
      const stateId = (name) => `ws_${workflow.id.slice(3)}_${slug(name)}`;
      Object.keys(workflow.transitions).forEach((name, position) => {
        const style = STATE_STYLE[name] || { category: 'todo', color: 'slate' };
        const [x, y] = workflow.layout[name] || [0, position * 150];
        db.prepare(`INSERT INTO workflow_states (id, workflow_id, name, category, color, is_initial, x, y, position)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(stateId(name), workflow.id, name, style.category, style.color, name === workflow.initial ? 1 : 0, x, y, position);
      });
      let position = 0;
      for (const [from, targets] of Object.entries(workflow.transitions)) {
        for (const to of targets) {
          db.prepare('INSERT INTO workflow_transitions (id, workflow_id, name, from_state_id, to_state_id, position) VALUES (?, ?, ?, ?, ?, ?)')
            .run(`wt_${workflow.id.slice(3)}_${slug(from)}_${slug(to)}`, workflow.id, transitionName(from, to), stateId(from), stateId(to), position++);
        }
      }
    });
  })();
}
seedWorkflows();

/** Every workflow with its states and transitions (from === null means "from any state"). */
export function listWorkflows() {
  return db.prepare('SELECT * FROM workflows ORDER BY position, name').all().map((row) => {
    const states = db.prepare('SELECT * FROM workflow_states WHERE workflow_id = ? ORDER BY position').all(row.id)
      .map((state) => ({ id: state.id, name: state.name, category: state.category, color: state.color, initial: Boolean(state.is_initial), x: state.x, y: state.y }));
    const transitions = db.prepare('SELECT * FROM workflow_transitions WHERE workflow_id = ? ORDER BY position').all(row.id)
      .map((transition) => ({ id: transition.id, name: transition.name, from: transition.from_state_id, to: transition.to_state_id }));
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      issueTypes: parseJson(row.issue_types_json, []),
      isDefault: Boolean(row.is_default),
      completionRequiresChildren: Boolean(row.completion_requires_children),
      states,
      transitions
    };
  });
}

let cache = null;
/** Clears the in-memory copy (call after changing workflow rows). */
export function clearWorkflowCache() { cache = null; }

/** Rules used by the server: { [issueType]: { name, initialStatus, transitions: { from: [to] }, completionRequiresChildren } }. */
function rules() {
  if (cache) return cache;
  const byType = {};
  let fallback = null;
  for (const workflow of listWorkflows()) {
    const names = Object.fromEntries(workflow.states.map((state) => [state.id, state.name]));
    const transitions = Object.fromEntries(workflow.states.map((state) => [state.name, []]));
    for (const transition of workflow.transitions) {
      const sources = transition.from ? [names[transition.from]] : workflow.states.map((state) => state.name);
      sources.forEach((source) => {
        if (source !== names[transition.to] && !transitions[source].includes(names[transition.to])) transitions[source].push(names[transition.to]);
      });
    }
    const compiled = {
      id: workflow.id,
      name: workflow.name,
      initialStatus: workflow.states.find((state) => state.initial)?.name || workflow.states[0]?.name || 'To Do',
      transitions,
      completionRequiresChildren: workflow.completionRequiresChildren
    };
    workflow.issueTypes.forEach((type) => { byType[type] = compiled; });
    if (workflow.isDefault) fallback = compiled;
  }
  cache = { byType, fallback: fallback || Object.values(byType)[0] };
  return cache;
}

export function normalizeIssueType(value) {
  const raw = String(value || 'Task').trim().toLowerCase();
  return Object.keys(rules().byType).find((type) => type.toLowerCase() === raw) || 'Task';
}

/** The workflow rules for an issue type (the default workflow for unknown types). */
export function workflowForIssueType(value) {
  const { byType, fallback } = rules();
  return byType[normalizeIssueType(value)] || fallback;
}

export function initialStatus(value) {
  return workflowForIssueType(value).initialStatus;
}
