import { useEffect, useMemo, useRef, useState } from 'react';
import Header from '../../components/layout/Header';
import Sidebar from '../../components/layout/Sidebar';
import Icon from '../../components/common/Icon';
import Toast from '../../components/common/Toast';
import { api } from '../../services/api';
import TaskDetailDrawer from '../SpacesList/TaskDetailDrawer';
import { IssueModal, StartTransitionModal } from '../SpacesList/SpacesList';
import IssueToolbar from '../SpacesList/IssueToolbar';
import ProjectHeader from '../SpacesList/ProjectHeader';
import useIssueFilters from '../SpacesList/useIssueFilters';
import { assigneeName, isInSpace, issueKey } from '../SpacesList/issueHelpers';
import { getChildIssues } from '../SpacesList/workflows';
import { ISSUE_DRAG_TYPE } from '../SpaceBoard/BoardCard';
import BacklogRow from './BacklogRow';
import MenuButton from './MenuButton';
import { CompleteSprintModal, ConfirmModal, SprintFormModal } from './SprintModals';
import {
  BACKLOG_ID,
  DEFAULT_VIEW_SETTINGS,
  daysLeft,
  formatShortDate,
  groupByList,
  insertIds,
  isPlannable,
  summarize
} from './backlogModel';
import './SpaceBacklog.css';

const SETTINGS_KEY = 'taskflow.backlog.view';

function readSettings() {
  try {
    return { ...DEFAULT_VIEW_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return DEFAULT_VIEW_SETTINGS;
  }
}

function StatusCounters({ counts }) {
  return (
    <span className="bl-counters" aria-label={`${counts.todo} to do, ${counts.progress} in progress, ${counts.done} done`}>
      <span className="is-todo" title="To do">{counts.todo}</span>
      <span className="is-progress" title="In progress">{counts.progress}</span>
      <span className="is-done" title="Done">{counts.done}</span>
    </span>
  );
}

function PlanIllustration() {
  return (
    <svg className="bl-plan-art" width="76" height="64" viewBox="0 0 76 64" aria-hidden="true">
      <path d="M14 4 30 30H-2Z" transform="translate(4 2)" fill="#a77cf2" />
      <circle cx="38" cy="32" r="13" fill="#f59e0b" />
      <rect x="40" y="36" width="22" height="22" rx="2" fill="#7ab800" />
      <path d="M6 44c10 8 28 8 46-6" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function ViewSettings({ settings, onChange }) {
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
  const toggle = (key) => onChange({ ...settings, [key]: !settings[key] });
  return (
    <div className="bl-menu-wrap" ref={ref}>
      <button type="button" className="bl-icon-button bl-tool" aria-label="View settings" title="View settings" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Icon name="sliders" size={16} />
      </button>
      {open && (
        <div className="bl-menu bl-settings align-right">
          <div className="bl-menu-heading">View settings</div>
          <label><input type="checkbox" checked={settings.showEpics} onChange={() => toggle('showEpics')} /> Show Epics and Features</label>
          <label><input type="checkbox" checked={settings.showSubtasks} onChange={() => toggle('showSubtasks')} /> Show Sub-tasks</label>
          <label><input type="checkbox" checked={settings.showEstimates} onChange={() => toggle('showEstimates')} /> Show estimates</label>
          <p>Epics, Features and Sub-tasks are usually planned through their child or parent work items.</p>
        </div>
      )}
    </div>
  );
}

function InsightsPanel({ sprints, summaries, onClose }) {
  const active = sprints.find((sprint) => sprint.status === 'active');
  const activeSummary = active ? summaries.get(String(active.id)) : null;
  const backlog = summaries.get(BACKLOG_ID);
  const future = sprints.filter((sprint) => sprint.status === 'future');
  const percent = (part, total) => (total ? Math.round((part / total) * 100) : 0);
  const remaining = active ? daysLeft(active.endDate) : null;
  return (
    <aside className="bl-insights" aria-label="Backlog insights">
      <header>
        <h2>Insights</h2>
        <button type="button" className="bl-icon-button" onClick={onClose} aria-label="Close insights"><Icon name="close" size={15} /></button>
      </header>
      <section>
        <h3>Active sprint</h3>
        {active && activeSummary ? (
          <>
            <p className="bl-insights-title">{active.name}</p>
            <p className="bl-insights-muted">
              {formatShortDate(active.startDate)} – {formatShortDate(active.endDate)}
              {remaining !== null && ` · ${remaining >= 0 ? `${remaining} day${remaining === 1 ? '' : 's'} left` : `${-remaining} day${remaining === -1 ? '' : 's'} over`}`}
            </p>
            {active.goal && <p className="bl-insights-goal">{active.goal}</p>}
            <div className="bl-progress" role="img" aria-label={`${activeSummary.counts.done} of ${activeSummary.total} work items done`}>
              <span className="is-done" style={{ width: `${percent(activeSummary.counts.done, activeSummary.total)}%` }} />
              <span className="is-progress" style={{ width: `${percent(activeSummary.counts.progress, activeSummary.total)}%` }} />
            </div>
            <dl>
              <div><dt>Work items done</dt><dd>{activeSummary.counts.done} / {activeSummary.total}</dd></div>
              <div><dt>Estimate done</dt><dd>{activeSummary.doneEstimate} / {activeSummary.estimate}</dd></div>
            </dl>
          </>
        ) : <p className="bl-insights-muted">No sprint is running.</p>}
      </section>
      <section>
        <h3>Planning</h3>
        <dl>
          <div><dt>Future sprints</dt><dd>{future.length}</dd></div>
          <div><dt>Backlog work items</dt><dd>{backlog?.total ?? 0}</dd></div>
          <div><dt>Backlog estimate</dt><dd>{backlog?.estimate ?? 0}</dd></div>
        </dl>
      </section>
    </aside>
  );
}

export default function SpaceBacklog({
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
  onRankTasks = async () => false,
  onRefreshTasks = () => {},
  onGlobalCreate = () => {},
  onOpenTask = () => {}
}) {
  const [sprints, setSprints] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [settings, setSettingsState] = useState(readSettings);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [collapsedLists, setCollapsedLists] = useState(() => new Set());
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [detailIssueId, setDetailIssueId] = useState(null);
  const [createRequest, setCreateRequest] = useState(null); // { listId, parentId, allowedIssueTypes }
  const [sprintForm, setSprintForm] = useState(null); // { mode, sprint }
  const [completeSprint, setCompleteSprint] = useState(null);
  const [confirm, setConfirm] = useState(null); // { title, message, confirmLabel, onConfirm }
  const [startRequest, setStartRequest] = useState(null); // { issue, status }
  const [startAssigneeId, setStartAssigneeId] = useState('');
  const [dragIds, setDragIds] = useState(null);
  const [drop, setDrop] = useState(null); // { listId, rowId, position }
  const [toast, setToast] = useState(null);

  // Sprints are loaded per Space (App remounts this page with key={space.id}).
  useEffect(() => {
    if (!space.id) return undefined;
    let active = true;
    api.getSprints(space.id)
      .then((rows) => { if (active) { setSprints(rows); setLoadError(''); } })
      .catch((error) => { if (active) setLoadError(error.message || 'Unable to load sprints.'); });
    return () => { active = false; };
  }, [space.id, reloadKey]);

  function setSettings(next) {
    setSettingsState(next);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* per-viewer preference only */ }
  }

  const inSpace = useMemo(() => (Array.isArray(tasks) ? tasks : []).filter((task) => isInSpace(task, space)), [tasks, space]);
  const plannable = useMemo(() => inSpace.filter((issue) => isPlannable(issue, settings)), [inSpace, settings]);
  const filters = useIssueFilters(plannable);
  const sortedByFilter = filters.orderBy !== 'All';
  const visibleOrder = useMemo(() => new Map(filters.filtered.map((issue, index) => [String(issue.id), index])), [filters.filtered]);

  const sprintList = useMemo(() => sprints || [], [sprints]);
  const openSprints = sprintList.filter((sprint) => sprint.status !== 'completed');
  const lists = useMemo(() => groupByList(plannable, sprintList), [plannable, sprintList]);
  const visibleLists = useMemo(() => {
    const result = new Map();
    lists.forEach((items, id) => {
      const shown = items.filter((issue) => visibleOrder.has(String(issue.id)));
      if (sortedByFilter) shown.sort((a, b) => visibleOrder.get(String(a.id)) - visibleOrder.get(String(b.id)));
      result.set(id, shown);
    });
    return result;
  }, [lists, visibleOrder, sortedByFilter]);
  const summaries = useMemo(() => new Map([...lists].map(([id, items]) => [id, summarize(items)])), [lists]);
  const childCounts = useMemo(() => new Map(inSpace.map((issue) => [String(issue.id), getChildIssues(issue, inSpace).length])), [inSpace]);

  const totalCount = [...lists.values()].reduce((sum, items) => sum + items.length, 0);
  const visibleCount = [...visibleLists.values()].reduce((sum, items) => sum + items.length, 0);
  const totalEstimate = [...summaries.values()].reduce((sum, item) => sum + item.estimate, 0);
  const visibleEstimate = [...visibleLists.values()].reduce((sum, items) => sum + summarize(items).estimate, 0);
  const hasActiveSprint = openSprints.some((sprint) => sprint.status === 'active');
  const listName = (listId) => listId === BACKLOG_ID ? 'Backlog' : openSprints.find((sprint) => String(sprint.id) === listId)?.name || 'Sprint';
  const listOf = (issueId) => [...lists].find(([, items]) => items.some((issue) => String(issue.id) === String(issueId)))?.[0] || BACKLOG_ID;
  const visualOrderIds = [...visibleLists.values()].flat().map((issue) => String(issue.id));

  function reloadSprints() {
    setReloadKey((value) => value + 1);
  }

  async function moveIssues(ids, targetListId, beforeId = null) {
    const targetIds = (lists.get(targetListId) || []).map((issue) => String(issue.id));
    const nextIds = insertIds(targetIds, ids, beforeId);
    if (nextIds.join() === targetIds.join()) return;
    const ok = await onRankTasks(nextIds, targetListId === BACKLOG_ID ? null : targetListId);
    if (!ok) {
      setToast({ type: 'error', message: 'The work items could not be moved. Please try again.' });
      return;
    }
    const sameList = ids.every((id) => listOf(id) === targetListId);
    if (!sameList) {
      setToast({ type: 'success', message: `${ids.length === 1 ? issueKey(inSpace.find((issue) => String(issue.id) === String(ids[0])) || {}) : `${ids.length} work items`} moved to ${listName(targetListId)}.` });
    }
  }

  function moveToEdge(issue, edge) {
    const listId = listOf(issue.id);
    const ids = (lists.get(listId) || []).map((item) => String(item.id));
    const first = ids.find((id) => id !== String(issue.id)) || null;
    moveIssues([String(issue.id)], listId, edge === 'top' ? first : null);
  }

  // ---- drag and drop -------------------------------------------------------------
  function dragIdsFor(issue) {
    const id = String(issue.id);
    return selectedIds.has(id) ? visualOrderIds.filter((item) => selectedIds.has(item)) : [id];
  }

  function handleRowDragOver(event, listId, issue) {
    if (!Array.from(event.dataTransfer.types || []).includes(ISSUE_DRAG_TYPE)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const position = sortedByFilter ? null : (event.clientY < rect.top + rect.height / 2 ? 'before' : 'after');
    const next = { listId, rowId: position ? String(issue.id) : null, position };
    if (!drop || drop.listId !== next.listId || drop.rowId !== next.rowId || drop.position !== next.position) setDrop(next);
  }

  function handleListDragOver(event, listId) {
    if (!Array.from(event.dataTransfer.types || []).includes(ISSUE_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (!drop || drop.listId !== listId || drop.rowId) setDrop({ listId, rowId: null, position: null });
  }

  function handleDrop(event, listId) {
    event.preventDefault();
    event.stopPropagation();
    let ids = [];
    try { ids = JSON.parse(event.dataTransfer.getData(ISSUE_DRAG_TYPE) || '[]'); } catch { ids = []; }
    const target = drop && drop.listId === listId ? drop : { listId, rowId: null, position: null };
    setDrop(null);
    setDragIds(null);
    if (!ids.length) return;
    let beforeId = null;
    if (target.rowId) {
      const full = (lists.get(listId) || []).map((issue) => String(issue.id));
      if (target.position === 'before') beforeId = target.rowId;
      else {
        const index = full.indexOf(target.rowId);
        beforeId = full.slice(index + 1).find((id) => !ids.includes(id)) || null;
      }
    }
    moveIssues(ids, listId, beforeId);
    setSelectedIds(new Set());
  }

  // ---- work item actions --------------------------------------------------------
  function changeStatus(issue, status) {
    if (status === 'In Progress' && !assigneeName(issue)) {
      setStartRequest({ issue, status });
      setStartAssigneeId('');
      return;
    }
    onUpdateTask(issue.id, { status });
  }

  function confirmDeleteIssues(ids) {
    const label = ids.length === 1 ? issueKey(inSpace.find((issue) => String(issue.id) === ids[0]) || {}) : `${ids.length} work items`;
    setConfirm({
      title: `Delete ${label}?`,
      message: `${label} will be permanently deleted. This cannot be undone.`,
      onConfirm: () => {
        onDeleteTasks(ids);
        setSelectedIds(new Set());
        setToast({ type: 'success', message: `${label} deleted.` });
      }
    });
  }

  function toggleSelected(id) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleList(listId) {
    setCollapsedLists((current) => {
      const next = new Set(current);
      if (next.has(listId)) next.delete(listId);
      else next.add(listId);
      return next;
    });
  }

  // ---- sprint actions -------------------------------------------------------------
  async function createSprint() {
    try {
      const sprint = await api.createSprint(space.id);
      setSprints((current) => [...(current || []), sprint]);
      setToast({ type: 'success', message: `${sprint.name} created.` });
    } catch (error) {
      setToast({ type: 'error', message: error.message });
    }
  }

  async function submitSprintForm(values) {
    const { mode, sprint } = sprintForm;
    try {
      const saved = mode === 'start' ? await api.startSprint(sprint.id, values) : await api.updateSprint(sprint.id, values);
      setSprints((current) => current.map((item) => item.id === saved.id ? saved : item));
      if (mode === 'start') setToast({ type: 'success', message: `${saved.name} started.` });
      return '';
    } catch (error) {
      return error.message;
    }
  }

  async function submitComplete(moveTo) {
    try {
      const result = await api.completeSprint(completeSprint.id, moveTo);
      reloadSprints();
      onRefreshTasks();
      setToast({ type: 'success', message: `${result.sprint.name} completed${result.movedCount ? `; ${result.movedCount} open work item${result.movedCount === 1 ? '' : 's'} moved to ${result.target ? result.target.name : 'Backlog'}` : ''}.` });
      return '';
    } catch (error) {
      return error.message;
    }
  }

  function confirmDeleteSprint(sprint) {
    const count = (lists.get(String(sprint.id)) || []).length;
    setConfirm({
      title: `Delete ${sprint.name}?`,
      message: count
        ? `Its ${count} work item${count === 1 ? '' : 's'} will move to the backlog. The work items are not deleted.`
        : 'This sprint has no work items.',
      onConfirm: async () => {
        try {
          await api.deleteSprint(sprint.id);
          setSprints((current) => current.filter((item) => item.id !== sprint.id));
          onRefreshTasks();
          setToast({ type: 'success', message: `${sprint.name} deleted.` });
        } catch (error) {
          setToast({ type: 'error', message: error.message });
        }
      }
    });
  }

  // ---- rendering ------------------------------------------------------------------
  const moveTargetsFor = (listId) => [
    ...openSprints.filter((sprint) => String(sprint.id) !== listId).map((sprint) => ({ id: String(sprint.id), name: sprint.name })),
    ...(listId !== BACKLOG_ID ? [{ id: BACKLOG_ID, name: 'Backlog' }] : [])
  ];

  function renderRows(listId) {
    const items = visibleLists.get(listId) || [];
    return items.map((issue) => {
      const id = String(issue.id);
      return (
        <BacklogRow
          key={id}
          issue={issue}
          allIssues={inSpace}
          childCount={childCounts.get(id) || 0}
          selected={selectedIds.has(id)}
          showEstimate={settings.showEstimates}
          dragging={Boolean(dragIds?.includes(id))}
          dropPosition={drop && drop.listId === listId && drop.rowId === id ? drop.position : null}
          moveTargets={moveTargetsFor(listId)}
          onToggleSelect={() => toggleSelected(id)}
          onOpen={() => setDetailIssueId(issue.id)}
          onStatusChange={(status) => changeStatus(issue, status)}
          onEstimateChange={(estimate) => onUpdateTask(issue.id, { estimate })}
          onMove={(targetId) => moveIssues([id], targetId)}
          onMoveToEdge={(edge) => moveToEdge(issue, edge)}
          onDelete={() => confirmDeleteIssues([id])}
          onDragStart={(event) => {
            const ids = dragIdsFor(issue);
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData(ISSUE_DRAG_TYPE, JSON.stringify(ids));
            event.dataTransfer.setData('text/plain', ids.length > 1 ? `${ids.length} work items` : `${issueKey(issue)}`);
            setDragIds(ids);
          }}
          onDragEnd={() => { setDragIds(null); setDrop(null); }}
          onDragOver={(event) => handleRowDragOver(event, listId, issue)}
          onDrop={(event) => handleDrop(event, listId)}
        />
      );
    });
  }

  function renderSection({ listId, sprint = null }) {
    const all = lists.get(listId) || [];
    const shown = visibleLists.get(listId) || [];
    const summary = summaries.get(listId) || summarize([]);
    const collapsed = collapsedLists.has(listId);
    const isBacklog = listId === BACKLOG_ID;
    const selectedInList = shown.filter((issue) => selectedIds.has(String(issue.id)));
    const allSelected = shown.length > 0 && selectedInList.length === shown.length;
    const title = isBacklog ? 'Backlog' : sprint.name;
    const startBlocked = sprint && sprint.status === 'future' && (hasActiveSprint ? 'Complete the active sprint first.' : all.length === 0 ? 'Add work items to start this sprint.' : '');
    const isDropTarget = drop && drop.listId === listId && !drop.rowId;

    return (
      <section
        key={listId}
        className={`bl-section ${isBacklog ? 'is-backlog' : ''} ${sprint?.status === 'active' ? 'is-active' : ''} ${isDropTarget ? 'is-drop-target' : ''}`}
        aria-label={`${title}, ${all.length} work items`}
        onDragOver={(event) => handleListDragOver(event, listId)}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDrop(null); }}
        onDrop={(event) => handleDrop(event, listId)}
      >
        <header className="bl-section-head">
          <input
            type="checkbox"
            className="bl-check"
            checked={allSelected}
            disabled={!shown.length}
            ref={(node) => { if (node) node.indeterminate = selectedInList.length > 0 && !allSelected; }}
            onChange={() => setSelectedIds((current) => {
              const next = new Set(current);
              shown.forEach((issue) => (allSelected ? next.delete(String(issue.id)) : next.add(String(issue.id))));
              return next;
            })}
            aria-label={`Select all work items in ${title}`}
          />
          <button type="button" className="bl-collapse" aria-expanded={!collapsed} aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${title}`} onClick={() => toggleList(listId)}>
            <Icon name="chevron" size={15} />
          </button>
          <h2>{title}</h2>
          {sprint?.status === 'active' && <span className="bl-active-badge">Active</span>}
          {sprint && (
            <button type="button" className="bl-dates" onClick={() => setSprintForm({ mode: 'edit', sprint })}>
              <Icon name="edit" size={14} />
              {sprint.startDate || sprint.endDate
                ? `${formatShortDate(sprint.startDate) || '…'} – ${formatShortDate(sprint.endDate) || '…'}`
                : 'Add dates'}
            </button>
          )}
          <span className="bl-count">
            ({shown.length !== all.length ? `${shown.length} of ` : ''}{all.length} work item{all.length === 1 ? '' : 's'})
          </span>
          <span className="bl-head-spacer" />
          {settings.showEstimates && summary.estimate > 0 && <span className="bl-points" title="Total estimate">{summary.estimate} pts</span>}
          <StatusCounters counts={summary.counts} />
          {isBacklog && (
            <button type="button" className="bl-button" onClick={createSprint}>Create sprint</button>
          )}
          {sprint?.status === 'future' && (
            <button
              type="button"
              className="bl-button"
              disabled={Boolean(startBlocked)}
              title={startBlocked || undefined}
              onClick={() => setSprintForm({ mode: 'start', sprint })}
            >
              Start sprint
            </button>
          )}
          {sprint?.status === 'active' && (
            <button type="button" className="bl-button is-primary" onClick={() => setCompleteSprint(sprint)}>Complete sprint</button>
          )}
          {sprint && (
            <MenuButton
              label={`${sprint.name} actions`}
              items={[
                { label: 'Edit sprint', onSelect: () => setSprintForm({ mode: 'edit', sprint }) },
                { label: 'Delete sprint', danger: true, onSelect: () => confirmDeleteSprint(sprint) }
              ]}
            />
          )}
        </header>

        {sprint?.goal && !collapsed && <p className="bl-goal"><strong>Goal:</strong> {sprint.goal}</p>}

        {!collapsed && (
          <>
            <div className="bl-list">
              {shown.length > 0 ? renderRows(listId) : (
                all.length > 0
                  ? <div className="bl-empty">No work items match your filters.</div>
                  : isBacklog
                    ? <div className="bl-empty bl-dropzone">Your backlog is empty. Create work items or drag them here from a sprint.</div>
                    : (
                      <div className="bl-dropzone bl-plan">
                        <PlanIllustration />
                        <div>
                          <strong>Plan your sprint</strong>
                          <p>Drag work items from the <b>Backlog</b> section or create new ones to plan the work for this sprint. Select <b>Start sprint</b> when you&apos;re ready.</p>
                        </div>
                      </div>
                    )
              )}
            </div>
            <button type="button" className="bl-create" onClick={() => setCreateRequest({ listId, parentId: '', allowedIssueTypes: null })}>
              <Icon name="plus" size={15} /> Create
            </button>
          </>
        )}
      </section>
    );
  }

  const detailIssue = detailIssueId === null ? null : inSpace.find((issue) => String(issue.id) === String(detailIssueId));
  const selectedList = visualOrderIds.filter((id) => selectedIds.has(id));

  return (
    <div className="app-shell spaces-list-shell">
      <Header spaces={spaces} tasks={tasks} onGlobalCreate={onGlobalCreate} onOpenTask={onOpenTask} />
      <Sidebar activeSection="Spaces" activeSpaceId={space.id} spaces={spaces} onCreateSpace={onCreateSpace} onNavigate={onNavigate} onOpenSpaceSettings={onOpenSpaceSettings} onDeleteSpace={onDeleteSpace} />

      <main className="spaces-list-main bl-main">
        <ProjectHeader space={space} title={`${space.code || space.name || 'Space'} backlog`} activeTab="Backlog" onNavigate={onNavigate} />

        <IssueToolbar filters={filters} collapsible searchPlaceholder="Search backlog" searchLabel="Search backlog">
          <div className="bl-tools">
            <button type="button" className={`bl-icon-button bl-tool ${insightsOpen ? 'is-on' : ''}`} aria-label="Insights" title="Insights" aria-pressed={insightsOpen} onClick={() => setInsightsOpen((value) => !value)}>
              <Icon name="chart" size={16} />
            </button>
            <ViewSettings settings={settings} onChange={setSettings} />
            <MenuButton
              label="More backlog actions"
              className="bl-tool"
              items={[
                { label: 'Create sprint', onSelect: createSprint },
                { label: 'Expand all', onSelect: () => setCollapsedLists(new Set()) },
                { label: 'Collapse all', onSelect: () => setCollapsedLists(new Set([...lists.keys()])) }
              ]}
            />
          </div>
        </IssueToolbar>

        {selectedList.length > 0 && (
          <div className="bl-bulk" role="region" aria-label="Selected work items">
            <strong>{selectedList.length} selected</strong>
            <label>
              Move to
              <select value="" onChange={(event) => { if (event.target.value) { moveIssues(selectedList, event.target.value); setSelectedIds(new Set()); } }}>
                <option value="">Choose…</option>
                {openSprints.map((sprint) => <option key={sprint.id} value={String(sprint.id)}>{sprint.name}</option>)}
                <option value={BACKLOG_ID}>Backlog</option>
              </select>
            </label>
            <button type="button" className="danger" onClick={() => confirmDeleteIssues(selectedList)}><Icon name="trash" size={14} /> Delete</button>
            <button type="button" onClick={() => setSelectedIds(new Set())}>Clear selection</button>
          </div>
        )}

        {sortedByFilter && <p className="bl-hint"><Icon name="info" size={14} /> Sorted by “{filters.orderBy}”. Reset Order by to drag work items into a custom order.</p>}

        <div className={`bl-layout ${insightsOpen ? 'with-insights' : ''}`}>
          <div className="bl-sections">
            {loadError && (
              <div className="bl-error" role="alert">
                {loadError} <button type="button" onClick={reloadSprints}>Retry</button>
              </div>
            )}
            {sprints === null && !loadError && <div className="bl-loading">Loading sprints…</div>}
            {sprints !== null && openSprints.map((sprint) => renderSection({ listId: String(sprint.id), sprint }))}
            {sprints !== null && (
              <div className="bl-summary">
                <span>{visibleCount} of {totalCount} work items visible</span>
                {settings.showEstimates && (
                  <>
                    <span className="bl-divider" aria-hidden="true">|</span>
                    <span>Estimate: <strong>{visibleEstimate}</strong> of <strong>{totalEstimate}</strong></span>
                  </>
                )}
              </div>
            )}
            {sprints !== null && renderSection({ listId: BACKLOG_ID })}
          </div>
          {insightsOpen && sprints !== null && <InsightsPanel sprints={sprintList} summaries={summaries} onClose={() => setInsightsOpen(false)} />}
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
          onCreateChild={(parentIssue, allowedIssueTypes) => setCreateRequest({ listId: listOf(parentIssue.id), parentId: String(parentIssue.id), allowedIssueTypes })}
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
          onCreate={async (payload) => {
            const { listId } = createRequest;
            const created = await onCreateTask({ ...payload, sprintId: listId === BACKLOG_ID ? null : listId });
            if (created) setToast({ type: 'success', message: `${issueKey(created)} created in ${listName(listId)}.` });
            return created;
          }}
        />
      )}

      {sprintForm && (
        <SprintFormModal
          sprint={sprintForm.sprint}
          mode={sprintForm.mode}
          itemCount={(lists.get(String(sprintForm.sprint.id)) || []).length}
          onClose={() => setSprintForm(null)}
          onSubmit={submitSprintForm}
        />
      )}

      {completeSprint && (
        <CompleteSprintModal
          sprint={completeSprint}
          summary={summaries.get(String(completeSprint.id)) || summarize([])}
          futureSprints={openSprints.filter((sprint) => sprint.status === 'future')}
          onClose={() => setCompleteSprint(null)}
          onSubmit={submitComplete}
        />
      )}

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          onClose={() => setConfirm(null)}
          onConfirm={() => { confirm.onConfirm(); setConfirm(null); }}
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
            setStartRequest(null);
          }}
        />
      )}
    </div>
  );
}
