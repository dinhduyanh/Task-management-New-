import { useEffect, useMemo, useState } from 'react';
import Header from '../../components/layout/Header';
import Sidebar from '../../components/layout/Sidebar';
import Icon from '../../components/common/Icon';
import TaskDetailDrawer from '../SpacesList/TaskDetailDrawer';
import { IssueModal, StartTransitionModal } from '../SpacesList/SpacesList';
import { ExtraFilterControls, MoreFilters, MultiFilter, OrderFilter } from '../SpacesList/IssueFilters';
import {
  ISSUE_TYPES,
  ORDER_PRESETS,
  assigneeName,
  getInitials,
  issueKey,
  matchesIssueFilters,
  sortIssues
} from '../SpacesList/issueHelpers';
import { getChildIssues, getIssueStatus, validateIssueTransition } from '../SpacesList/workflows';
import BoardCard, { ISSUE_DRAG_TYPE } from './BoardCard';
import BoardSettingsModal from './BoardSettingsModal';
import { collectStatuses, findColumnForStatus, getBoardColumns, statusTone } from './boardConfig';
import './SpaceBoard.css';

const PROJECT_TABS = [
  ['Summary', 'dashboard'], ['Timeline', 'calendar'], ['Board', 'board'], ['List', 'file'],
  ['Backlog', 'spaces'], ['Active Sprints', 'check'], ['Teams', 'users']
];
const MAX_AVATAR_FILTERS = 6;

/** Column colour from the statuses it holds, so it stays right after columns are reordered. */
function columnTone(column) {
  const tones = column.statuses.map(statusTone);
  if (tones.length && tones.every((tone) => tone === 'done' || tone === 'cancel')) return 'done';
  if (tones.some((tone) => tone === 'progress' || tone === 'review' || tone === 'blocked')) return 'progress';
  return 'todo';
}

/** First status in the column the issue may move to, or the reason it cannot. */
function resolveTarget(issue, column, allIssues) {
  const current = getIssueStatus(issue);
  if (column.statuses.some((status) => status.toLowerCase() === current.toLowerCase())) return { same: true };
  let reason = '';
  for (const status of column.statuses) {
    const result = validateIssueTransition(issue, status, allIssues);
    if (result.allowed) return { status };
    reason ||= result.reason;
  }
  return { reason: reason || `"${column.name}" has no statuses mapped to it.` };
}

function belongsToSpace(task, space) {
  const id = String(space.id ?? '');
  const code = String(space.code ?? '').toLowerCase();
  const taskId = task.spaceId ?? task.projectId ?? task.space?.id;
  const taskCode = String(task.spaceCode ?? task.projectCode ?? '').toLowerCase();
  return (id && String(taskId ?? '') === id) || (code && taskCode === code);
}

export default function SpaceBoard({
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
  onSaveBoard = async () => null,
  onGlobalCreate = () => {},
  onOpenTask = () => {}
}) {
  const [search, setSearch] = useState('');
  const [types, setTypes] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [orderBy, setOrderBy] = useState('All');
  const [moreFields, setMoreFields] = useState([]);
  const [priorities, setPriorities] = useState([]);
  const [dateRanges, setDateRanges] = useState({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailIssueId, setDetailIssueId] = useState(null);
  const [createRequest, setCreateRequest] = useState(null); // { columnId, parentId, allowedIssueTypes }
  const [startRequest, setStartRequest] = useState(null); // { issue, status }
  const [startAssigneeId, setStartAssigneeId] = useState('');
  const [draggingId, setDraggingId] = useState(null);
  const [dropColumnId, setDropColumnId] = useState(null);
  const [toast, setToast] = useState(null);

  const spaceName = space.name || space.code || 'Untitled Space';
  const columns = useMemo(() => getBoardColumns(space), [space]);
  const inSpace = useMemo(
    () => (Array.isArray(tasks) ? tasks : []).filter((task) => belongsToSpace(task, space)),
    [tasks, space]
  );

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  const statusOptions = useMemo(() => collectStatuses(columns, inSpace), [columns, inSpace]);
  const assigneeOptions = useMemo(
    () => [...new Set(inSpace.map(assigneeName).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [inSpace]
  );

  const filtered = useMemo(() => {
    const rows = inSpace.filter((issue) => matchesIssueFilters(issue, {
      keyword: search, types, assignees, statuses, priorities, moreFields, dateRanges
    }));
    const [field, direction] = ORDER_PRESETS[orderBy] || [];
    return sortIssues(rows, field, direction);
  }, [inSpace, search, types, assignees, statuses, priorities, moreFields, dateRanges, orderBy]);

  const issuesByColumn = useMemo(() => {
    const groups = new Map(columns.map((column) => [column.id, []]));
    let hidden = 0;
    filtered.forEach((issue) => {
      const column = findColumnForStatus(columns, getIssueStatus(issue));
      if (column) groups.get(column.id).push(issue);
      else hidden += 1;
    });
    return { groups, hidden };
  }, [filtered, columns]);

  const childCounts = useMemo(() => {
    const counts = new Map();
    inSpace.forEach((issue) => counts.set(String(issue.id), getChildIssues(issue, inSpace).length));
    return counts;
  }, [inSpace]);

  const draggingIssue = draggingId === null ? null : inSpace.find((issue) => String(issue.id) === String(draggingId));

  const columnDropState = useMemo(() => {
    if (!draggingIssue) return new Map();
    return new Map(columns.map((column) => {
      const target = resolveTarget(draggingIssue, column, inSpace);
      return [column.id, target.same ? 'same' : target.status ? 'allowed' : 'blocked'];
    }));
  }, [draggingIssue, columns, inSpace]);

  function moveIssueToStatus(issue, status) {
    if (status === 'In Progress' && !assigneeName(issue)) {
      setStartRequest({ issue, status });
      setStartAssigneeId('');
      return;
    }
    onUpdateTask(issue.id, { status });
    setToast({ type: 'success', message: `${issueKey(issue)} moved to ${status}.` });
  }

  function handleDrop(event, column) {
    event.preventDefault();
    setDropColumnId(null);
    const issueId = event.dataTransfer.getData(ISSUE_DRAG_TYPE);
    setDraggingId(null);
    if (!issueId) return;
    const issue = inSpace.find((item) => String(item.id) === issueId);
    if (!issue) return;
    const target = resolveTarget(issue, column, inSpace);
    if (target.same) return;
    if (!target.status) {
      setToast({ type: 'error', message: target.reason });
      return;
    }
    moveIssueToStatus(issue, target.status);
  }

  async function handleCreate(payload) {
    const created = await onCreateTask(payload);
    if (!created) return false;
    const column = columns.find((item) => item.id === createRequest?.columnId);
    if (column) {
      const target = resolveTarget(created, column, inSpace);
      if (target.status && !(target.status === 'In Progress' && !assigneeName(created))) {
        onUpdateTask(created.id, { status: target.status });
      } else if (!target.same) {
        const landed = findColumnForStatus(columns, getIssueStatus(created));
        setToast({
          type: 'info',
          message: `${issueKey(created)} was created in ${getIssueStatus(created)}${landed ? ` (column "${landed.name}")` : ''}; its workflow does not allow starting in "${column.name}".`
        });
      }
    }
    return created;
  }

  async function saveBoard(nextColumns) {
    const saved = await onSaveBoard(nextColumns);
    if (saved) setToast({ type: 'success', message: 'Board settings saved.' });
    return Boolean(saved);
  }

  function navigateTab(tab) {
    if (tab === 'Board') return;
    if (tab === 'Summary') onNavigate('space', { id: space.id, name: spaceName });
    else if (tab === 'List') onNavigate('spaceList', { id: space.id, name: spaceName });
    else onNavigate('spaceTab', { id: space.id, name: spaceName, tab });
  }

  function toggleAssignee(name) {
    setAssignees((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name]);
  }

  function updateMoreFields(next) {
    const removed = moreFields.filter((field) => !next.includes(field));
    if (removed.includes('Priority')) setPriorities([]);
    setDateRanges((current) => {
      const updated = { ...current };
      removed.forEach((field) => delete updated[field]);
      return updated;
    });
    setMoreFields(next);
  }

  const hasFilters = Boolean(search || types.length || assignees.length || statuses.length ||
    priorities.length || moreFields.length || orderBy !== 'All');

  function clearFilters() {
    setSearch('');
    setTypes([]);
    setAssignees([]);
    setStatuses([]);
    setPriorities([]);
    setMoreFields([]);
    setDateRanges({});
    setOrderBy('All');
  }

  const detailIssue = detailIssueId === null ? null : inSpace.find((issue) => String(issue.id) === String(detailIssueId));

  return (
    <div className="app-shell spaces-list-shell">
      <Header spaces={spaces} tasks={tasks} onGlobalCreate={onGlobalCreate} onOpenTask={onOpenTask} />
      <Sidebar activeSection="Spaces" activeSpaceId={space.id} spaces={spaces} onCreateSpace={onCreateSpace} onNavigate={onNavigate} onOpenSpaceSettings={onOpenSpaceSettings} onDeleteSpace={onDeleteSpace} />

      <main className="spaces-list-main sb-main">
        <div className="slv-project-heading">
          <div className="slv-breadcrumb"><span>Projects</span><span>/</span><strong>{spaceName}</strong></div>
          <h1>{space.code || spaceName} board</h1>
        </div>

        <nav className="slv-tabs" aria-label="Project navigation">
          {PROJECT_TABS.map(([label, icon]) => (
            <button
              key={label}
              type="button"
              className={`slv-tab ${label === 'Board' ? 'active' : ''}`}
              aria-current={label === 'Board' ? 'page' : undefined}
              onClick={() => navigateTab(label)}
            >
              <Icon name={icon} size={15} /><span>{label}</span>
            </button>
          ))}
        </nav>

        <section className="slv-toolbar sb-toolbar" aria-label="Board filters">
          <div className="slv-search">
            <Icon name="search" size={15} />
            <input placeholder="Search board" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search work items on the board" />
            {search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search">×</button>}
          </div>

          {assigneeOptions.length > 0 && (
            <div className="sb-avatar-filters" role="group" aria-label="Filter by assignee">
              {assigneeOptions.slice(0, MAX_AVATAR_FILTERS).map((name) => (
                <button
                  key={name}
                  type="button"
                  className={`sb-avatar sb-avatar-filter ${assignees.includes(name) ? 'is-active' : ''}`}
                  aria-pressed={assignees.includes(name)}
                  title={name}
                  onClick={() => toggleAssignee(name)}
                >
                  {getInitials(name)}
                </button>
              ))}
              <button
                type="button"
                className={`sb-avatar sb-avatar-filter is-unassigned ${assignees.includes('Unassigned') ? 'is-active' : ''}`}
                aria-pressed={assignees.includes('Unassigned')}
                title="Unassigned"
                onClick={() => toggleAssignee('Unassigned')}
              >
                <Icon name="user" size={13} />
              </button>
            </div>
          )}

          <MultiFilter label="Issue Type" options={ISSUE_TYPES} selected={types} onChange={setTypes} />
          <MultiFilter label="Assignee" options={['Unassigned', ...assigneeOptions]} selected={assignees} onChange={setAssignees} width={210} />
          <MultiFilter label="Status" options={statusOptions} selected={statuses} onChange={setStatuses} />
          <OrderFilter value={orderBy} onChange={setOrderBy} />
          <ExtraFilterControls
            moreFields={moreFields}
            dateRanges={dateRanges}
            onDateRangesChange={setDateRanges}
            priorities={priorities}
            onPrioritiesChange={setPriorities}
            onRemoveField={(field) => updateMoreFields(moreFields.filter((item) => item !== field))}
          />
          <MoreFilters selected={moreFields} onChange={updateMoreFields} />
          {hasFilters && (
            <button type="button" className="sb-clear-filters" onClick={clearFilters}>
              <Icon name="close" size={13} /> Clear filters
            </button>
          )}

          <button type="button" className="sb-settings-button" onClick={() => setSettingsOpen(true)}>
            <Icon name="sliders" size={15} /> Board settings
          </button>
        </section>

        {issuesByColumn.hidden > 0 && (
          <div className="sb-notice" role="status">
            <Icon name="info" size={15} />
            <span>
              {issuesByColumn.hidden} work item{issuesByColumn.hidden === 1 ? ' is' : 's are'} hidden because
              {issuesByColumn.hidden === 1 ? ' its status is' : ' their statuses are'} not mapped to a column.
            </span>
            <button type="button" onClick={() => setSettingsOpen(true)}>Map statuses</button>
          </div>
        )}

        <div className="sb-board" aria-label={`${spaceName} board`}>
          {columns.map((column) => {
            const items = issuesByColumn.groups.get(column.id) || [];
            const dropState = columnDropState.get(column.id);
            return (
              <section
                key={column.id}
                className={`sb-column tone-${columnTone(column)} ${dropState ? `drop-${dropState}` : ''} ${dropColumnId === column.id ? 'is-over' : ''}`}
                aria-label={`${column.name}, ${items.length} work items`}
                onDragOver={(event) => {
                  if (!Array.from(event.dataTransfer.types || []).includes(ISSUE_DRAG_TYPE)) return;
                  event.preventDefault();
                  // Keep the drop enabled on blocked columns so the user is told why it was refused.
                  event.dataTransfer.dropEffect = 'move';
                  if (dropColumnId !== column.id) setDropColumnId(column.id);
                }}
                onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropColumnId(null); }}
                onDrop={(event) => handleDrop(event, column)}
              >
                <header className="sb-column-head">
                  <span className="sb-column-name"><span className="sb-column-dot" aria-hidden="true" />{column.name}</span>
                  <span className="sb-column-count">{items.length}</span>
                  <button
                    type="button"
                    className="sb-icon-button"
                    onClick={() => setCreateRequest({ columnId: column.id, parentId: '', allowedIssueTypes: null })}
                    aria-label={`Create work item in ${column.name}`}
                    title={`Create in ${column.name}`}
                  >
                    <Icon name="plus" size={15} />
                  </button>
                </header>

                <div className="sb-column-body">
                  {items.map((issue) => (
                    <BoardCard
                      key={issue.id}
                      issue={issue}
                      childCount={childCounts.get(String(issue.id)) || 0}
                      dragging={String(draggingId) === String(issue.id)}
                      onOpen={() => setDetailIssueId(issue.id)}
                      onDragStart={() => setDraggingId(issue.id)}
                      onDragEnd={() => { setDraggingId(null); setDropColumnId(null); }}
                    />
                  ))}
                  {items.length === 0 && (
                    <div className="sb-column-empty">
                      {column.statuses.length ? 'No work items' : 'No statuses mapped'}
                    </div>
                  )}
                  {dropState === 'blocked' && dropColumnId === column.id && (
                    <div className="sb-drop-hint" role="status">This transition is not allowed by the workflow.</div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </main>

      {toast && (
        <div className={`sb-toast is-${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'}>
          <span>{toast.message}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {settingsOpen && (
        <BoardSettingsModal
          columns={columns}
          issues={inSpace}
          onClose={() => setSettingsOpen(false)}
          onSave={saveBoard}
        />
      )}

      {detailIssue && (
        <TaskDetailDrawer
          issue={detailIssue}
          allIssues={inSpace}
          space={space}
          onClose={() => setDetailIssueId(null)}
          onUpdateTask={onUpdateTask}
          onDeleteTask={(issue) => { onDeleteTasks([issue.id]); setDetailIssueId(null); }}
          onCloneTask={(payload) => onCreateTask(payload)}
          onCreateChild={(parentIssue, allowedIssueTypes) => setCreateRequest({ columnId: null, parentId: String(parentIssue.id), allowedIssueTypes })}
          onOpenIssue={(issueId) => setDetailIssueId(issueId)}
        />
      )}

      {createRequest && (
        <IssueModal
          space={space}
          existingIssues={inSpace}
          initialParentId={createRequest.parentId}
          allowedIssueTypes={createRequest.allowedIssueTypes}
          onClose={() => setCreateRequest(null)}
          onCreate={handleCreate}
        />
      )}

      {startRequest && (
        <StartTransitionModal
          issues={[startRequest.issue]}
          members={space.members}
          assigneeId={startAssigneeId}
          onAssigneeChange={setStartAssigneeId}
          onClose={() => setStartRequest(null)}
          onConfirm={(assignee) => {
            onUpdateTask(startRequest.issue.id, { status: startRequest.status, assignee });
            setToast({ type: 'success', message: `${issueKey(startRequest.issue)} moved to ${startRequest.status}.` });
            setStartRequest(null);
          }}
        />
      )}
    </div>
  );
}
