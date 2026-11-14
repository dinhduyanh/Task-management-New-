import { useMemo, useState } from 'react';
import Icon from '../../components/common/Icon';
import { StartTransitionModal } from '../SpacesList/SpacesList';
import { assigneeName, issueKey } from '../SpacesList/issueHelpers';
import { getChildIssues, getIssueStatus } from '../SpacesList/workflows';
import BoardCard, { ISSUE_DRAG_TYPE } from './BoardCard';
import { columnTone, findColumnForStatus, resolveTarget } from './boardConfig';

/**
 * Kanban columns shared by Board and Active sprints. Dragging a card to another column
 * changes its status, following the issue type's workflow.
 *
 * `lanes` (optional): [{ id, label, issues }] renders one swimlane per group;
 * otherwise all `issues` are shown in a single lane. `allIssues` is the whole Space,
 * used for workflow checks and child counts.
 */
export default function KanbanBoard({
  columns,
  issues = [],
  allIssues = [],
  lanes = null,
  members = [],
  ariaLabel = 'Board',
  onUpdateTask = () => {},
  onOpenIssue = () => {},
  onCreateInColumn = () => {},
  onToast = () => {},
  canCreate = true,
  canMove = () => true // (issue) => may the signed-in user move it ("Move task")
}) {
  const [draggingId, setDraggingId] = useState(null);
  const [dropCell, setDropCell] = useState(null); // `${laneId}:${columnId}`
  const [collapsedLanes, setCollapsedLanes] = useState(() => new Set());
  const [startRequest, setStartRequest] = useState(null); // { issue, status }
  const [startAssigneeId, setStartAssigneeId] = useState('');

  const laneList = useMemo(() => lanes || [{ id: 'all', label: '', issues }], [lanes, issues]);
  const grouped = Boolean(lanes);

  // lane id -> column id -> issues
  const cells = useMemo(() => new Map(laneList.map((lane) => {
    const byColumn = new Map(columns.map((column) => [column.id, []]));
    lane.issues.forEach((issue) => {
      const column = findColumnForStatus(columns, getIssueStatus(issue));
      if (column) byColumn.get(column.id).push(issue);
    });
    return [lane.id, byColumn];
  })), [laneList, columns]);

  const columnCounts = new Map(columns.map((column) => [
    column.id,
    laneList.reduce((sum, lane) => sum + (cells.get(lane.id)?.get(column.id)?.length || 0), 0)
  ]));

  const childCounts = useMemo(() => {
    const counts = new Map();
    allIssues.forEach((issue) => counts.set(String(issue.id), getChildIssues(issue, allIssues).length));
    return counts;
  }, [allIssues]);

  const draggingIssue = draggingId === null ? null : allIssues.find((issue) => String(issue.id) === String(draggingId));
  const columnDropState = useMemo(() => {
    if (!draggingIssue) return new Map();
    return new Map(columns.map((column) => {
      const target = resolveTarget(draggingIssue, column, allIssues);
      return [column.id, target.same ? 'same' : target.status ? 'allowed' : 'blocked'];
    }));
  }, [draggingIssue, columns, allIssues]);

  function moveIssueToStatus(issue, status) {
    if (status === 'In Progress' && !assigneeName(issue)) {
      setStartRequest({ issue, status });
      setStartAssigneeId('');
      return;
    }
    onUpdateTask(issue.id, { status });
    onToast({ type: 'success', message: `${issueKey(issue)} moved to ${status}.` });
  }

  function handleDrop(event, column) {
    event.preventDefault();
    setDropCell(null);
    const issueId = event.dataTransfer.getData(ISSUE_DRAG_TYPE);
    setDraggingId(null);
    if (!issueId) return;
    const issue = allIssues.find((item) => String(item.id) === issueId);
    if (!issue) return;
    if (!canMove(issue)) {
      onToast({ type: 'error', message: `You do not have the Move task permission for ${issueKey(issue)}.` });
      return;
    }
    const target = resolveTarget(issue, column, allIssues);
    if (target.same) return;
    if (!target.status) {
      onToast({ type: 'error', message: target.reason });
      return;
    }
    moveIssueToStatus(issue, target.status);
  }

  function toggleLane(id) {
    setCollapsedLanes((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <div className={`sb-board ${grouped ? 'is-grouped' : ''}`} aria-label={ariaLabel} style={{ '--sb-cols': columns.length }}>
        <div className="sb-grid">
          {columns.map((column) => (
            <header key={column.id} className={`sb-column-head tone-${columnTone(column)}`}>
              <span className="sb-column-name"><span className="sb-column-dot" aria-hidden="true" />{column.name}</span>
              <span className="sb-column-count">{columnCounts.get(column.id)}</span>
              {canCreate && (
                <button
                  type="button"
                  className="sb-icon-button"
                  onClick={() => onCreateInColumn(column)}
                  aria-label={`Create work item in ${column.name}`}
                  title={`Create in ${column.name}`}
                >
                  <Icon name="plus" size={15} />
                </button>
              )}
            </header>
          ))}

          {laneList.map((lane, laneIndex) => {
            const collapsed = collapsedLanes.has(lane.id);
            const last = laneIndex === laneList.length - 1;
            return [
              grouped && (
                <div key={`${lane.id}-head`} className="sb-lane-head">
                  <button type="button" className="sb-lane-toggle" aria-expanded={!collapsed} onClick={() => toggleLane(lane.id)}>
                    <Icon name="chevron" size={14} />
                    <span>{lane.label}</span>
                    <span className="sb-lane-count">({lane.issues.length} work item{lane.issues.length === 1 ? '' : 's'})</span>
                  </button>
                </div>
              ),
              ...(collapsed ? [] : columns.map((column) => {
                const items = cells.get(lane.id)?.get(column.id) || [];
                const cellId = `${lane.id}:${column.id}`;
                const dropState = columnDropState.get(column.id);
                return (
                  <section
                    key={cellId}
                    className={`sb-column tone-${columnTone(column)} ${last ? 'is-last' : ''} ${dropState ? `drop-${dropState}` : ''} ${dropCell === cellId ? 'is-over' : ''}`}
                    data-column={column.name}
                    aria-label={`${grouped ? `${lane.label}, ` : ''}${column.name}, ${items.length} work items`}
                    onDragOver={(event) => {
                      if (!Array.from(event.dataTransfer.types || []).includes(ISSUE_DRAG_TYPE)) return;
                      event.preventDefault();
                      // Keep the drop enabled on blocked columns so the user is told why it was refused.
                      event.dataTransfer.dropEffect = 'move';
                      if (dropCell !== cellId) setDropCell(cellId);
                    }}
                    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropCell(null); }}
                    onDrop={(event) => handleDrop(event, column)}
                  >
                    <div className="sb-column-body">
                      {items.map((issue) => (
                        <BoardCard
                          key={issue.id}
                          issue={issue}
                          childCount={childCounts.get(String(issue.id)) || 0}
                          dragging={String(draggingId) === String(issue.id)}
                          draggable={canMove(issue)}
                          onOpen={() => onOpenIssue(issue.id)}
                          onDragStart={() => setDraggingId(issue.id)}
                          onDragEnd={() => { setDraggingId(null); setDropCell(null); }}
                        />
                      ))}
                      {items.length === 0 && !grouped && (
                        <div className="sb-column-empty">{column.statuses.length ? 'No work items' : 'No statuses mapped'}</div>
                      )}
                      {dropState === 'blocked' && dropCell === cellId && (
                        <div className="sb-drop-hint" role="status">This transition is not allowed by the workflow.</div>
                      )}
                    </div>
                  </section>
                );
              }))
            ];
          })}
        </div>
      </div>

      {startRequest && (
        <StartTransitionModal
          issues={[startRequest.issue]}
          members={members}
          assigneeId={startAssigneeId}
          onAssigneeChange={setStartAssigneeId}
          onClose={() => setStartRequest(null)}
          onConfirm={(assignee) => {
            onUpdateTask(startRequest.issue.id, { status: startRequest.status, assignee });
            onToast({ type: 'success', message: `${issueKey(startRequest.issue)} moved to ${startRequest.status}.` });
            setStartRequest(null);
          }}
        />
      )}
    </>
  );
}
