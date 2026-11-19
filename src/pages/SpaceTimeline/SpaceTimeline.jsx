import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Header from '../../components/layout/Header';
import Sidebar from '../../components/layout/Sidebar';
import Icon from '../../components/common/Icon';
import Toast from '../../components/common/Toast';
import TaskDetailDrawer from '../SpacesList/TaskDetailDrawer';
import { IssueModal } from '../SpacesList/SpacesList';
import IssueToolbar from '../SpacesList/IssueToolbar';
import ProjectHeader from '../SpacesList/ProjectHeader';
import StatusBadge from '../SpacesList/StatusBadge';
import useIssueFilters from '../SpacesList/useIssueFilters';
import {
  ISSUE_TYPES,
  getAllowedChildTypes,
  iconForType,
  isCompletedStatus,
  isInSpace,
  issueKey,
  issueSummary,
  issueType
} from '../SpacesList/issueHelpers';
import { getChildIssues, getIssueStatus } from '../SpacesList/workflows';
import {
  ZOOM_LEVELS,
  addDays,
  computeRange,
  diffDays,
  formatDay,
  getIssueSpan,
  monthSegments,
  startOfDay,
  weekSegments
} from './timelineScale';
import { useProjectPermissions } from '../../services/projectPermissions';
import './SpaceTimeline.css';

const COMPACT_QUERY = '(max-width: 760px)';

/** Width of the work item list pane; narrower on small screens. */
function useLeftWidth() {
  const [compact, setCompact] = useState(() => window.matchMedia?.(COMPACT_QUERY).matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.(COMPACT_QUERY);
    if (!query) return undefined;
    const update = () => setCompact(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return compact ? 280 : 460;
}
const TYPE_CLASS = (type) => `type-${type.toLowerCase().replace(/[^a-z]+/g, '-')}`;

function RowMenu({ issue, canAddChild, canDelete = true, hasBar, onOpen, onAddChild, onScrollTo, onDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (!ref.current?.contains(event.target)) setOpen(false); };
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = (action) => () => { setOpen(false); action(); };
  return (
    <div className="tl-menu-wrap" ref={ref}>
      <button
        type="button"
        className="tl-icon-button"
        aria-label={`More actions for ${issueKey(issue)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="moreVertical" size={15} />
      </button>
      {open && (
        <div className="tl-menu" role="menu">
          <button type="button" role="menuitem" onClick={run(onOpen)}>View details</button>
          {canAddChild && <button type="button" role="menuitem" onClick={run(onAddChild)}>Add child work item</button>}
          {hasBar && <button type="button" role="menuitem" onClick={run(onScrollTo)}>Scroll to bar</button>}
          {canDelete && <button type="button" role="menuitem" className="danger" onClick={run(onDelete)}>Delete</button>}
        </div>
      )}
    </div>
  );
}

function dueText(span, completed, today) {
  if (!span) return { text: 'No dates', tone: 'muted' };
  const due = formatDay(span.end);
  if (completed) return { text: due, tone: '' };
  const late = diffDays(span.end, today);
  if (late > 0) return { text: due, extra: `${late} day${late === 1 ? '' : 's'} overdue`, tone: 'overdue' };
  if (late === 0) return { text: due, extra: 'Due today', tone: 'today' };
  return { text: due, tone: '' };
}

export default function SpaceTimeline({
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
  onGlobalCreate = () => {},
  onOpenTask = () => {}
}) {
  const [zoom, setZoom] = useState('week');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [detailIssueId, setDetailIssueId] = useState(null);
  const [createRequest, setCreateRequest] = useState(null); // { parentId, allowedIssueTypes }
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [toast, setToast] = useState(null);
  const { can } = useProjectPermissions(space);
  const mayCreate = can('task.create');
  const scrollRef = useRef(null);
  const leftWidth = useLeftWidth();

  const spaceName = space.name || space.code || 'Untitled Space';
  const inSpace = useMemo(
    () => (Array.isArray(tasks) ? tasks : []).filter((task) => isInSpace(task, space)),
    [tasks, space]
  );
  const filters = useIssueFilters(inSpace);
  const { filtered } = filters;
  const today = useMemo(() => startOfDay(new Date()), []);
  const dayWidth = ZOOM_LEVELS[zoom].dayWidth;

  const spans = useMemo(() => new Map(inSpace.map((issue) => [String(issue.id), getIssueSpan(issue)])), [inSpace]);
  const range = useMemo(() => computeRange([...spans.values()].filter(Boolean), today), [spans, today]);
  const chartWidth = range.days * dayWidth;
  const todayOffset = diffDays(range.start, today);

  // Tree of the filtered items: an item whose parent is filtered out becomes a root.
  const rows = useMemo(() => {
    const childrenOf = new Map();
    const childIds = new Set();
    filtered.forEach((issue) => {
      const children = getChildIssues(issue, filtered);
      childrenOf.set(String(issue.id), children);
      children.forEach((child) => childIds.add(String(child.id)));
    });
    const result = [];
    const walk = (issue, depth, trail) => {
      const id = String(issue.id);
      if (trail.has(id)) return; // guard against cyclic parent links
      const children = childrenOf.get(id) || [];
      result.push({ issue, depth, childCount: children.length });
      if (!collapsed.has(id)) {
        const nextTrail = new Set(trail).add(id);
        children.forEach((child) => walk(child, depth + 1, nextTrail));
      }
    };
    filtered.filter((issue) => !childIds.has(String(issue.id))).forEach((issue) => walk(issue, 0, new Set()));
    return result;
  }, [filtered, collapsed]);

  const scrollToDay = useCallback((offset, behavior = 'auto') => {
    const node = scrollRef.current;
    if (!node) return;
    const viewport = node.clientWidth - leftWidth;
    node.scrollTo({ left: Math.max(0, offset * dayWidth - viewport / 3), behavior });
  }, [dayWidth, leftWidth]);

  // Start at today, and bring today back into view when switching Week/Month.
  // Not on every data change, so editing an item does not move the user's scroll position.
  const scrolledZoomRef = useRef(null);
  useLayoutEffect(() => {
    if (scrolledZoomRef.current === zoom) return;
    scrolledZoomRef.current = zoom;
    scrollToDay(todayOffset);
  }, [scrollToDay, todayOffset, zoom]);

  const months = useMemo(() => monthSegments(range), [range]);
  const weeks = useMemo(() => weekSegments(range), [range]);
  const days = useMemo(() => Array.from({ length: range.days }, (_, index) => addDays(range.start, index)), [range]);

  const legendTypes = useMemo(() => {
    const present = new Set(rows.filter((row) => spans.get(String(row.issue.id))).map((row) => issueType(row.issue)));
    return ISSUE_TYPES.filter((type) => present.has(type));
  }, [rows, spans]);

  function toggle(id) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openCreate(parent = null) {
    if (!parent) {
      setCreateRequest({ parentId: '', allowedIssueTypes: null });
      return;
    }
    setCreateRequest({ parentId: String(parent.id), allowedIssueTypes: getAllowedChildTypes(issueType(parent)) });
    setCollapsed((current) => {
      const next = new Set(current);
      next.delete(String(parent.id));
      return next;
    });
  }

  async function handleCreate(payload) {
    const created = await onCreateTask(payload);
    if (created) setToast({ type: 'success', message: `${issueKey(created)} created.` });
    return created;
  }

  const gridStyle = {
    '--tl-left': `${leftWidth}px`,
    '--tl-day': `${dayWidth}px`,
    '--tl-grid-step': `${zoom === 'week' ? dayWidth : dayWidth * 7}px`,
    width: leftWidth + chartWidth
  };

  const detailIssue = detailIssueId === null ? null : inSpace.find((issue) => String(issue.id) === String(detailIssueId));

  return (
    <div className="app-shell spaces-list-shell">
      <Header spaces={spaces} tasks={tasks} onGlobalCreate={onGlobalCreate} onOpenTask={onOpenTask} />
      <Sidebar activeSection="Spaces" activeSpaceId={space.id} spaces={spaces} onCreateSpace={onCreateSpace} onNavigate={onNavigate} onOpenSpaceSettings={onOpenSpaceSettings} onDeleteSpace={onDeleteSpace} />

      <main className="spaces-list-main tl-main">
        <ProjectHeader space={space} title={`${space.code || spaceName} timeline`} activeTab="Timeline" onNavigate={onNavigate} />
        <IssueToolbar filters={filters} searchLabel="Search work items on the timeline" />

        {legendTypes.length > 0 && (
          <div className="tl-legend" aria-label="Bar colours by issue type">
            {legendTypes.map((type) => (
              <span key={type}><i className={`tl-swatch ${TYPE_CLASS(type)}`} aria-hidden="true" />{type}</span>
            ))}
            <span><i className="tl-swatch is-overdue" aria-hidden="true" />Overdue</span>
          </div>
        )}

        <div className="tl-scroll" ref={scrollRef}>
          <div className={`tl-grid zoom-${zoom}`} style={gridStyle}>
            <div className="tl-head">
              <div className="tl-corner">
                <span className="tl-corner-title">Timeline</span>
                <div className="tl-zoom" role="group" aria-label="Time scale">
                  {Object.entries(ZOOM_LEVELS).map(([key, level]) => (
                    <button key={key} type="button" className={zoom === key ? 'active' : ''} aria-pressed={zoom === key} onClick={() => setZoom(key)}>
                      {level.label}
                    </button>
                  ))}
                </div>
                <button type="button" className="tl-today-button" onClick={() => scrollToDay(todayOffset, 'smooth')}>Today</button>
              </div>
              <div className="tl-scale" style={{ width: chartWidth }}>
                <div className="tl-scale-row tl-scale-months">
                  {months.map((month) => (
                    <span key={month.key} style={{ left: month.offset * dayWidth, width: month.length * dayWidth }}>
                      <b>{month.length * dayWidth > 110 ? month.label : month.shortLabel}</b>
                    </span>
                  ))}
                </div>
                <div className="tl-scale-row tl-scale-units">
                  {zoom === 'week'
                    ? days.map((day, index) => {
                      const weekend = day.getDay() === 0 || day.getDay() === 6;
                      return (
                        <span key={index} className={`${weekend ? 'is-weekend' : ''} ${index === todayOffset ? 'is-today' : ''}`} style={{ left: index * dayWidth, width: dayWidth }}>
                          {day.getDate()}
                        </span>
                      );
                    })
                    : weeks.map((week) => (
                      <span key={week.key} style={{ left: week.offset * dayWidth, width: week.length * dayWidth }}>{week.label}</span>
                    ))}
                </div>
              </div>
            </div>

            <div className="tl-body">
              {todayOffset >= 0 && todayOffset < range.days && (
                <div className="tl-today-line" style={{ left: leftWidth + todayOffset * dayWidth + dayWidth / 2 }} aria-hidden="true" />
              )}

              {rows.map(({ issue, depth, childCount }) => {
                const id = String(issue.id);
                const type = issueType(issue);
                const status = getIssueStatus(issue);
                const completed = isCompletedStatus(status);
                const span = spans.get(id);
                const due = dueText(span, completed, today);
                const childTypes = getAllowedChildTypes(type);
                const startOffset = span ? diffDays(range.start, span.start) : 0;
                const length = span ? diffDays(span.start, span.end) + 1 : 0;
                const endOffset = startOffset + length - 1;
                const overdueDays = span && !completed ? todayOffset - endOffset : 0;
                return (
                  <div className="tl-row" key={id}>
                    <div className="tl-cell" style={{ paddingLeft: 10 + depth * 22 }}>
                      {childCount > 0 ? (
                        <button type="button" className="tl-toggle" aria-expanded={!collapsed.has(id)} aria-label={`${collapsed.has(id) ? 'Expand' : 'Collapse'} ${issueKey(issue)}`} onClick={() => toggle(id)}>
                          <Icon name="chevron" size={14} />
                        </button>
                      ) : <span className="tl-toggle-spacer" />}
                      <span className={`slv-type-icon ${TYPE_CLASS(type)}`} title={type}><Icon name={iconForType(type)} size={15} /></span>
                      <div className="tl-cell-text">
                        <div className="tl-cell-title">
                          <button type="button" className={`tl-key ${completed ? 'is-completed' : ''}`} onClick={() => setDetailIssueId(issue.id)}>{issueKey(issue)}</button>
                          <span className={completed ? 'is-completed' : ''} title={issueSummary(issue)}>{issueSummary(issue)}</span>
                        </div>
                        <div className={`tl-cell-due tone-${due.tone || 'normal'}`}>
                          <Icon name="flag" size={12} />
                          <span>{due.text}</span>
                          {due.extra && <strong>{due.extra}</strong>}
                        </div>
                      </div>
                      <StatusBadge status={status} />
                      <button
                        type="button"
                        className="tl-icon-button"
                        onClick={() => openCreate(issue)}
                        disabled={!childTypes.length || !mayCreate}
                        aria-label={`Add child work item to ${issueKey(issue)}`}
                        title={childTypes.length ? `Add ${childTypes.join(', ')}` : `${type} cannot have child work items`}
                      >
                        <Icon name="plus" size={15} />
                      </button>
                      <RowMenu
                        issue={issue}
                        canAddChild={childTypes.length > 0 && mayCreate}
                        canDelete={can('task.delete', issue)}
                        hasBar={Boolean(span)}
                        onOpen={() => setDetailIssueId(issue.id)}
                        onAddChild={() => openCreate(issue)}
                        onScrollTo={() => scrollToDay(startOffset, 'smooth')}
                        onDelete={() => setDeleteTarget(issue)}
                      />
                    </div>
                    <div className="tl-track">
                      {span && (
                        <button
                          type="button"
                          className={`tl-bar ${TYPE_CLASS(type)} ${completed ? 'is-completed' : ''}`}
                          style={{ left: startOffset * dayWidth + 2, width: Math.max(length * dayWidth - 4, 6) }}
                          title={`${issueKey(issue)} · ${issueSummary(issue)}\n${formatDay(span.start)} → ${formatDay(span.end)} (${length} day${length === 1 ? '' : 's'})`}
                          aria-label={`${issueKey(issue)} from ${formatDay(span.start)} to ${formatDay(span.end)}. Open details.`}
                          onClick={() => setDetailIssueId(issue.id)}
                        />
                      )}
                      {overdueDays > 0 && (
                        <span
                          className="tl-overdue"
                          style={{ left: (endOffset + 1) * dayWidth, width: overdueDays * dayWidth }}
                          title={`${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue`}
                          aria-hidden="true"
                        />
                      )}
                    </div>
                  </div>
                );
              })}

              {rows.length === 0 && (
                <div className="tl-row tl-empty-row">
                  <div className="tl-cell tl-empty">
                    {inSpace.length ? 'No work items match your filters.' : 'No work items yet.'}
                  </div>
                  <div className="tl-track" />
                </div>
              )}

              <div className="tl-row tl-create-row">
                <div className="tl-cell">
                  {mayCreate && (
                    <button type="button" className="tl-create" onClick={() => openCreate()}>
                      <Icon name="plus" size={15} /> Create work item
                    </button>
                  )}
                </div>
                <div className="tl-track" />
              </div>
            </div>
          </div>
        </div>
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
          onCloneTask={(payload) => onCreateTask(payload)}
          onCreateChild={(parentIssue) => openCreate(parentIssue)}
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

      {deleteTarget && (
        <div className="slv-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteTarget(null); }}>
          <div className="slv-modal slv-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="tl-delete-title">
            <div className="slv-modal-head">
              <h2 id="tl-delete-title">Delete {issueKey(deleteTarget)}?</h2>
              <button type="button" onClick={() => setDeleteTarget(null)} aria-label="Close">×</button>
            </div>
            <div className="slv-modal-content">
              <p className="slv-confirm-text">“{issueSummary(deleteTarget)}” will be permanently deleted.</p>
            </div>
            <div className="slv-modal-foot">
              <button type="button" className="slv-btn secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button
                type="button"
                className="slv-btn danger"
                onClick={() => {
                  onDeleteTasks([deleteTarget.id]);
                  setToast({ type: 'success', message: `${issueKey(deleteTarget)} deleted.` });
                  setDeleteTarget(null);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
