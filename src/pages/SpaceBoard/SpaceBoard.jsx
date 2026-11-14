import { useMemo, useState } from 'react';
import Header from '../../components/layout/Header';
import Sidebar from '../../components/layout/Sidebar';
import Icon from '../../components/common/Icon';
import Toast from '../../components/common/Toast';
import TaskDetailDrawer from '../SpacesList/TaskDetailDrawer';
import { IssueModal, StartTransitionModal } from '../SpacesList/SpacesList';
import IssueToolbar from '../SpacesList/IssueToolbar';
import ProjectHeader from '../SpacesList/ProjectHeader';
import useIssueFilters from '../SpacesList/useIssueFilters';
import { assigneeName, isInSpace, issueKey, statusTone } from '../SpacesList/issueHelpers';
import { getChildIssues, getIssueStatus, validateIssueTransition } from '../SpacesList/workflows';
import BoardCard, { ISSUE_DRAG_TYPE } from './BoardCard';
import BoardSettingsModal from './BoardSettingsModal';
import { collectStatuses, findColumnForStatus, getBoardColumns } from './boardConfig';
import './SpaceBoard.css';

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
    () => (Array.isArray(tasks) ? tasks : []).filter((task) => isInSpace(task, space)),
    [tasks, space]
  );

  const statusOptions = useMemo(() => collectStatuses(columns, inSpace), [columns, inSpace]);
  const filters = useIssueFilters(inSpace);
  const { filtered } = filters;

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

  const detailIssue = detailIssueId === null ? null : inSpace.find((issue) => String(issue.id) === String(detailIssueId));

  return (
    <div className="app-shell spaces-list-shell">
      <Header spaces={spaces} tasks={tasks} onGlobalCreate={onGlobalCreate} onOpenTask={onOpenTask} />
      <Sidebar activeSection="Spaces" activeSpaceId={space.id} spaces={spaces} onCreateSpace={onCreateSpace} onNavigate={onNavigate} onOpenSpaceSettings={onOpenSpaceSettings} onDeleteSpace={onDeleteSpace} />

      <main className="spaces-list-main sb-main">
        <ProjectHeader space={space} title={`${space.code || spaceName} board`} activeTab="Board" onNavigate={onNavigate} />

        <IssueToolbar filters={filters} statusOptions={statusOptions} searchLabel="Search work items on the board">
          <button type="button" className="it-toolbar-button" onClick={() => setSettingsOpen(true)}>
            <Icon name="sliders" size={15} /> Board settings
          </button>
        </IssueToolbar>

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

      <Toast toast={toast} onClose={() => setToast(null)} />

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
