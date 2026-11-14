import { useMemo, useState } from 'react';
import Header from '../../components/layout/Header';
import Sidebar from '../../components/layout/Sidebar';
import Icon from '../../components/common/Icon';
import Toast from '../../components/common/Toast';
import { api } from '../../services/api';
import TaskDetailDrawer from '../SpacesList/TaskDetailDrawer';
import { IssueModal } from '../SpacesList/SpacesList';
import IssueToolbar from '../SpacesList/IssueToolbar';
import ProjectHeader from '../SpacesList/ProjectHeader';
import useIssueFilters from '../SpacesList/useIssueFilters';
import { navigateProjectTab } from '../SpacesList/projectNavigation';
import { assigneeName, isInSpace, issueKey, issueType } from '../SpacesList/issueHelpers';
import { getIssueStatus } from '../SpacesList/workflows';
import KanbanBoard from '../SpaceBoard/KanbanBoard';
import { collectStatuses, findColumnForStatus, getBoardColumns, resolveTarget } from '../SpaceBoard/boardConfig';
import { CompleteSprintModal, SprintFormModal } from '../SpaceBacklog/SprintModals';
import { daysLeft, formatShortDate, summarize } from '../SpaceBacklog/backlogModel';
import useSprints from '../SpaceBacklog/useSprints';
import './SpaceActiveSprints.css';

const GROUP_KEY = 'taskflow.activeSprint.group';
const GROUP_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'type', label: 'Issue type' },
  { value: 'parent', label: 'Parent' }
];

function readGroup() {
  try {
    const value = localStorage.getItem(GROUP_KEY);
    return GROUP_OPTIONS.some((option) => option.value === value) ? value : 'none';
  } catch {
    return 'none';
  }
}

/** Work items of a sprint: assigned to it directly, or sub-tasks following a parent in it. */
function sprintItemsOf(issues, sprintId) {
  const id = String(sprintId);
  const inSprint = new Set(issues.filter((issue) => String(issue.sprintId || '') === id).map((issue) => String(issue.id)));
  return issues.filter((issue) => {
    if (inSprint.has(String(issue.id))) return true;
    const parentId = issue.parentId ?? issue.parent?.id;
    return !issue.sprintId && issueType(issue) === 'Sub-task' && parentId && inSprint.has(String(parentId));
  });
}

function buildLanes(issues, group) {
  if (group === 'none') return null;
  const lanes = new Map();
  const add = (id, label, issue) => {
    if (!lanes.has(id)) lanes.set(id, { id, label, issues: [] });
    lanes.get(id).issues.push(issue);
  };
  issues.forEach((issue) => {
    if (group === 'assignee') {
      const name = assigneeName(issue);
      add(name ? `a:${name}` : 'a:', name || 'Unassigned', issue);
    } else if (group === 'type') {
      const type = issueType(issue);
      add(`t:${type}`, type, issue);
    } else {
      const parent = issue.parent;
      add(parent ? `p:${parent.id}` : 'p:', parent ? `${parent.key || ''} ${parent.title || parent.name || ''}`.trim() : 'No parent', issue);
    }
  });
  // Named groups alphabetically, the "none" group (Unassigned / No parent) last.
  return [...lanes.values()].sort((a, b) => {
    const emptyA = a.id.endsWith(':');
    const emptyB = b.id.endsWith(':');
    if (emptyA !== emptyB) return emptyA ? 1 : -1;
    return a.label.localeCompare(b.label);
  });
}

function EmptyState({ onGoToBacklog }) {
  return (
    <div className="as-empty">
      <svg width="132" height="104" viewBox="0 0 132 104" aria-hidden="true" className="as-empty-art">
        <ellipse cx="62" cy="94" rx="54" ry="7" className="as-art-shadow" />
        <path d="M14 58h96v26a6 6 0 0 1-6 6H20a6 6 0 0 1-6-6Z" className="as-art-tray" />
        <rect x="32" y="20" width="60" height="50" rx="4" className="as-art-paper" />
        <rect x="42" y="30" width="40" height="12" rx="2" className="as-art-line" />
        <rect x="42" y="48" width="40" height="3" rx="1.5" className="as-art-line" />
        <rect x="42" y="55" width="30" height="3" rx="1.5" className="as-art-line" />
        <path d="M14 58h26l6 10h32l6-10h26" className="as-art-tray-edge" />
        <rect x="96" y="6" width="30" height="16" rx="8" className="as-art-bubble" />
        <circle cx="104" cy="14" r="2" className="as-art-dot" />
        <circle cx="111" cy="14" r="2" className="as-art-dot" />
        <circle cx="118" cy="14" r="2" className="as-art-dot" />
      </svg>
      <h2>Get Started in the Backlog</h2>
      <p>Plan and start a sprint to see work here</p>
      <button type="button" className="as-button" onClick={onGoToBacklog}>Go to Backlog</button>
    </div>
  );
}

export default function SpaceActiveSprints({
  space = {},
  tasks = [],
  spaces = [],
  onNavigate = () => {},
  onCreateSpace = () => {},
  onOpenSpaceSettings = () => {},
  onDeleteSpace = () => {},
  onCreateTask = () => {},
  onUpdateTask = () => {},
  onDeleteTasks = () => {},
  onRefreshTasks = () => {},
  onGlobalCreate = () => {},
  onOpenTask = () => {}
}) {
  const { sprints, setSprints, error: loadError, reload } = useSprints(space.id);
  const [group, setGroupState] = useState(readGroup);
  const [collapsed, setCollapsed] = useState(false);
  const [detailIssueId, setDetailIssueId] = useState(null);
  const [createRequest, setCreateRequest] = useState(null); // { columnId, parentId, allowedIssueTypes }
  const [editOpen, setEditOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [toast, setToast] = useState(null);

  const spaceName = space.name || space.code || 'Untitled Space';
  const columns = useMemo(() => getBoardColumns(space), [space]);
  const inSpace = useMemo(() => (Array.isArray(tasks) ? tasks : []).filter((task) => isInSpace(task, space)), [tasks, space]);
  const activeSprint = useMemo(() => (sprints || []).find((sprint) => sprint.status === 'active') || null, [sprints]);
  const futureSprints = useMemo(() => (sprints || []).filter((sprint) => sprint.status === 'future'), [sprints]);
  const sprintItems = useMemo(() => (activeSprint ? sprintItemsOf(inSpace, activeSprint.id) : []), [inSpace, activeSprint]);
  const filters = useIssueFilters(sprintItems);
  const { filtered } = filters;
  const statusOptions = useMemo(() => collectStatuses(columns, sprintItems), [columns, sprintItems]);
  const lanes = useMemo(() => buildLanes(filtered, group), [filtered, group]);
  const hiddenCount = filtered.filter((issue) => !findColumnForStatus(columns, getIssueStatus(issue))).length;
  const remaining = activeSprint ? daysLeft(activeSprint.endDate) : null;

  function setGroup(value) {
    setGroupState(value);
    try { localStorage.setItem(GROUP_KEY, value); } catch { /* per-viewer preference only */ }
  }

  async function handleCreate(payload) {
    const created = await onCreateTask({ ...payload, sprintId: activeSprint.id });
    if (!created) return false;
    const column = columns.find((item) => item.id === createRequest?.columnId);
    if (column) {
      const target = resolveTarget(created, column, inSpace);
      if (target.status && !(target.status === 'In Progress' && !assigneeName(created))) onUpdateTask(created.id, { status: target.status });
    }
    setToast({ type: 'success', message: `${issueKey(created)} added to ${activeSprint.name}.` });
    return created;
  }

  async function updateSprint(values) {
    try {
      const saved = await api.updateSprint(activeSprint.id, values);
      setSprints((current) => current.map((item) => item.id === saved.id ? saved : item));
      setToast({ type: 'success', message: 'Sprint updated.' });
      return '';
    } catch (error) {
      return error.message;
    }
  }

  async function completeSprint(moveTo) {
    try {
      const result = await api.completeSprint(activeSprint.id, moveTo);
      reload();
      onRefreshTasks();
      setToast({ type: 'success', message: `${result.sprint.name} completed${result.movedCount ? `; ${result.movedCount} open work item${result.movedCount === 1 ? '' : 's'} moved to ${result.target ? result.target.name : 'Backlog'}` : ''}.` });
      return '';
    } catch (error) {
      return error.message;
    }
  }

  const detailIssue = detailIssueId === null ? null : inSpace.find((issue) => String(issue.id) === String(detailIssueId));

  let content;
  if (loadError) {
    content = (
      <div className="as-message" role="alert">
        {loadError} <button type="button" onClick={reload}>Retry</button>
      </div>
    );
  } else if (sprints === null) {
    content = <div className="as-message">Loading sprint…</div>;
  } else if (!activeSprint) {
    content = <EmptyState onGoToBacklog={() => navigateProjectTab(onNavigate, space, 'Backlog')} />;
  } else {
    content = (
      <>
        <IssueToolbar filters={filters} statusOptions={statusOptions} searchLabel="Search work items in the active sprint">
          <div className="as-actions">
            <button type="button" className="as-icon-button" onClick={() => setEditOpen(true)} aria-label="Edit sprint" title="Edit sprint">
              <Icon name="edit" size={16} />
            </button>
            <button type="button" className="as-button is-primary" onClick={() => setCompleteOpen(true)}>
              <Icon name="check" size={15} /> Complete sprint
            </button>
            <label className="as-group">
              <span>Group</span>
              <select value={group} onChange={(event) => setGroup(event.target.value)} aria-label="Group work items by">
                {GROUP_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>
        </IssueToolbar>

        <section className="as-sprint" aria-label={activeSprint.name}>
          <header className="as-sprint-head">
            <button type="button" className="as-collapse" aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)}>
              <Icon name="chevron" size={15} />
              <h2>{activeSprint.name}</h2>
              <span className="as-count">({sprintItems.length} work item{sprintItems.length === 1 ? '' : 's'})</span>
            </button>
            <span className="as-meta">
              {formatShortDate(activeSprint.startDate)} – {formatShortDate(activeSprint.endDate)}
              {remaining !== null && (
                <span className={remaining < 0 ? 'is-over' : ''}>
                  {' · '}{remaining >= 0 ? `${remaining} day${remaining === 1 ? '' : 's'} left` : `${-remaining} day${remaining === -1 ? '' : 's'} over`}
                </span>
              )}
            </span>
          </header>
          {activeSprint.goal && !collapsed && <p className="as-goal"><strong>Goal:</strong> {activeSprint.goal}</p>}

          {!collapsed && (
            <>
              {hiddenCount > 0 && (
                <div className="sb-notice" role="status">
                  <Icon name="info" size={15} />
                  <span>{hiddenCount} work item{hiddenCount === 1 ? ' is' : 's are'} hidden because {hiddenCount === 1 ? 'its status is' : 'their statuses are'} not mapped to a board column.</span>
                  <button type="button" onClick={() => navigateProjectTab(onNavigate, space, 'Board')}>Open Board settings</button>
                </div>
              )}
              <KanbanBoard
                columns={columns}
                issues={filtered}
                lanes={lanes}
                allIssues={inSpace}
                members={space.members}
                ariaLabel={`${activeSprint.name} board`}
                onUpdateTask={onUpdateTask}
                onOpenIssue={setDetailIssueId}
                onCreateInColumn={(column) => setCreateRequest({ columnId: column.id, parentId: '', allowedIssueTypes: null })}
                onToast={setToast}
              />
            </>
          )}
        </section>
      </>
    );
  }

  return (
    <div className="app-shell spaces-list-shell">
      <Header spaces={spaces} tasks={tasks} onGlobalCreate={onGlobalCreate} onOpenTask={onOpenTask} />
      <Sidebar activeSection="Spaces" activeSpaceId={space.id} spaces={spaces} onCreateSpace={onCreateSpace} onNavigate={onNavigate} onOpenSpaceSettings={onOpenSpaceSettings} onDeleteSpace={onDeleteSpace} />

      <main className="spaces-list-main sb-main as-main">
        <ProjectHeader space={space} title={`${space.code || spaceName} board`} activeTab="Active Sprints" onNavigate={onNavigate} />
        {content}
      </main>

      <Toast toast={toast} onClose={() => setToast(null)} />

      {detailIssue && (
        <TaskDetailDrawer
          issue={detailIssue}
          allIssues={inSpace}
          space={space}
          onClose={() => setDetailIssueId(null)}
          onUpdateTask={onUpdateTask}
          onDeleteTask={(issue) => { onDeleteTasks([issue.id]); setDetailIssueId(null); }}
          onCloneTask={(payload) => onCreateTask({ ...payload, sprintId: activeSprint?.id || null })}
          onCreateChild={(parentIssue, allowedIssueTypes) => setCreateRequest({ columnId: null, parentId: String(parentIssue.id), allowedIssueTypes })}
          onOpenIssue={(issueId) => setDetailIssueId(issueId)}
        />
      )}

      {createRequest && activeSprint && (
        <IssueModal
          space={space}
          existingIssues={inSpace}
          initialParentId={createRequest.parentId}
          allowedIssueTypes={createRequest.allowedIssueTypes}
          onClose={() => setCreateRequest(null)}
          onCreate={handleCreate}
        />
      )}

      {editOpen && activeSprint && (
        <SprintFormModal sprint={activeSprint} mode="edit" onClose={() => setEditOpen(false)} onSubmit={updateSprint} />
      )}

      {completeOpen && activeSprint && (
        <CompleteSprintModal
          sprint={activeSprint}
          summary={summarize(sprintItems.filter((issue) => String(issue.sprintId || '') === String(activeSprint.id)))}
          futureSprints={futureSprints}
          onClose={() => setCompleteOpen(false)}
          onSubmit={completeSprint}
        />
      )}
    </div>
  );
}
