export const PROJECT_TABS = [
  ['Summary', 'dashboard'], ['Timeline', 'calendar'], ['Board', 'board'], ['List', 'file'],
  ['Backlog', 'spaces'], ['Active Sprints', 'check'], ['Teams', 'users']
];

/** Route for a project tab. Board, Timeline and placeholders use the generic spaceTab route. */
export function navigateProjectTab(onNavigate, space, tab) {
  const name = space.name || space.code || 'Untitled Space';
  if (tab === 'Summary') onNavigate('space', { id: space.id, name });
  else if (tab === 'List') onNavigate('spaceList', { id: space.id, name });
  else onNavigate('spaceTab', { id: space.id, name, tab });
}
