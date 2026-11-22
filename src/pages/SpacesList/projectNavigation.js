/**
 * Project features (tabs). The same list drives the project tab bars and
 * Project Settings > Features, so a feature always shows the same icon.
 * `locked` features cannot be hidden.
 */
export const PROJECT_FEATURES = [
  { key: 'Summary', icon: 'dashboard', tone: 'blue', description: 'Project overview and key metrics.', locked: true },
  { key: 'Timeline', icon: 'calendar', tone: 'teal', description: 'View project work across a timeline.' },
  { key: 'Board', icon: 'board', tone: 'purple', description: 'Manage work items on a visual board.' },
  { key: 'List', icon: 'list', tone: 'green', description: 'View and manage work items in a list.' },
  { key: 'Backlog', icon: 'inbox', tone: 'orange', description: 'Prioritize and organize upcoming work.' },
  { key: 'Active Sprints', icon: 'refresh', tone: 'red', description: 'Plan and track active sprints.' },
  { key: 'Teams', icon: 'users', tone: 'indigo', description: 'View project teams and members.' }
];

/** [label, icon] pairs for every feature (kept for callers that want the full list). */
export const PROJECT_TABS = PROJECT_FEATURES.map((feature) => [feature.key, feature.icon]);

/** Whether a feature (tab) is shown in this project. */
export function isFeatureVisible(space, key) {
  const feature = PROJECT_FEATURES.find((item) => item.key === key);
  if (!feature) return true;
  return feature.locked || !(space?.hiddenFeatures || []).includes(key);
}

/** The project's tabs, without the ones switched off in Project Settings > Features. */
export function visibleProjectTabs(space) {
  return PROJECT_FEATURES.filter((feature) => isFeatureVisible(space, feature.key));
}

/** Route for a project tab. Board, Timeline and placeholders use the generic spaceTab route. */
export function navigateProjectTab(onNavigate, space, tab) {
  const name = space.name || space.code || 'Untitled Space';
  if (tab === 'Summary' || !isFeatureVisible(space, tab)) onNavigate('space', { id: space.id, name });
  else if (tab === 'List') onNavigate('spaceList', { id: space.id, name });
  else onNavigate('spaceTab', { id: space.id, name, tab });
}
