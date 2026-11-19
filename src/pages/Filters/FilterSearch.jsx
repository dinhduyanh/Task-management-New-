import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Header from '../../components/layout/Header';
import Sidebar from '../../components/layout/Sidebar';
import Icon from '../../components/common/Icon';
import Toast from '../../components/common/Toast';
import DatePicker from '../../components/common/DatePicker';
import PersonAvatar from '../../components/common/PersonAvatar';
import { useAppShell } from '../../context/appShellContext';
import { api } from '../../services/api';
import { findUser } from '../../services/userDirectory';
import { spaceOfItem } from '../../services/projectPermissions';
import { IssueModal, MoveModal, StartTransitionModal } from '../SpacesList/SpacesList';
import TaskDetailDrawer from '../SpacesList/TaskDetailDrawer';
import StatusBadge from '../SpacesList/StatusBadge';
import { assigneeName, iconForType, isInSpace, issueKey, issueSummary, issueType } from '../SpacesList/issueHelpers';
import { validateIssueTransition } from '../SpacesList/workflows';
import { ConfirmModal } from '../SpaceBacklog/SprintModals';
import TaskTable from '../MyTasks/components/TaskTable';
import FilterDropdown from './components/FilterDropdown';
import TqlEditor from './components/TqlEditor';
import SaveFilterModal from './components/SaveFilterModal';
import { buildOptions, matchConfigValues, useFilterMeta } from './filterOptions';
import {
  DEFAULT_ORDER, ORDER_OPTIONS, configToTql, emptyConfig, orderLabel, stringify, tqlToConfig, validate
} from '../../../shared/tql';
import './Filters.css';

const MODE_KEY = 'taskflow:filters-mode';
const VIEW_KEY = 'taskflow:filters-view';
const readPref = (key, fallback, allowed) => {
  try { const value = window.localStorage.getItem(key); return allowed.includes(value) ? value : fallback; } catch { return fallback; }
};
const writePref = (key, value) => { try { window.localStorage.setItem(key, value); } catch { /* storage unavailable */ } };

const MAIN_FIELDS = [
  ['project', 'Project'], ['priority', 'Priority'], ['assignee', 'Assignee'], ['creator', 'Creator'],
  ['type', 'Issue Type'], ['status', 'Status'], ['sprint', 'Sprint']
];
const MORE_FIELDS = [
  ['startDate', 'Start Date'], ['dueDate', 'Due Date'], ['created', 'Created Date'], ['updated', 'Updated Date'], ['labels', 'Labels']
];
const DEFAULT_SORT_DIRECTION = { created: 'DESC', updated: 'DESC', priority: 'DESC' };

/** The same query written the same way (for "has the filter changed?"). */
function normalizeTql(text) {
  const result = validate(text || '');
  return result.ok ? stringify(result.ast) : String(text || '').trim();
}

/** Fields of More filters that hold a value (they stay visible). */
function usedMoreFields(config) {
  return MORE_FIELDS.map(([name]) => name).filter((name) => (name === 'labels' ? config.labels?.length : config.dates?.[name]?.from || config.dates?.[name]?.to));
}

function DateRangeFilter({ label, range = {}, onChange, onRemove }) {
  const trigger = (placeholder) => function DateTrigger({ ref, toggle, label: text, open }) {
    return <button type="button" ref={ref} className={`fs-date-button ${open ? 'is-open' : ''} ${text ? 'has-value' : ''}`} onClick={toggle}>{text || placeholder}</button>;
  };
  return (
    <div className={`fs-pill fs-date-pill ${range.from || range.to ? 'has-value' : ''}`} role="group" aria-label={label}>
      <span className="fs-pill-label">{label}</span>
      <DatePicker value={range.from || ''} max={range.to || undefined} onChange={(value) => onChange({ ...range, from: value || '' })} ariaLabel={`${label} from`} renderTrigger={trigger('From')} />
      <span className="fs-date-sep" aria-hidden="true">→</span>
      <DatePicker value={range.to || ''} min={range.from || undefined} onChange={(value) => onChange({ ...range, to: value || '' })} ariaLabel={`${label} to`} renderTrigger={trigger('To')} />
      <button type="button" className="fs-pill-remove" onClick={onRemove} aria-label={`Remove ${label} filter`} title="Remove"><Icon name="close" size={10} /></button>
    </div>
  );
}

/** Filters > Search work items: Default (dropdowns) or TQL, saved filters, list / split view. */
export default function FilterSearch({
  spaces = [], allTasks = [], routeData = null,
  onNavigate, onCreateSpace, onOpenSpaceSettings, onDeleteSpace, onGlobalCreate, onOpenTask,
  onUpdateTask = async () => null, onCreateTask = async () => null, onDeleteTasks = async () => {}, onMoveTasks = async () => null
}) {
  const { user, users = [] } = useAppShell();
  const meta = useFilterMeta();
  const options = useMemo(() => buildOptions(meta, user), [meta, user]);

  const [mode, setMode] = useState(() => readPref(MODE_KEY, 'default', ['default', 'tql']));
  const [view, setView] = useState(() => readPref(VIEW_KEY, 'list', ['list', 'split']));
  const [config, setConfig] = useState(emptyConfig);
  const [textDraft, setTextDraft] = useState({ key: '', summary: '' });
  const [moreFields, setMoreFields] = useState([]);
  const [tqlDraft, setTqlDraft] = useState('');
  const [appliedTql, setAppliedTql] = useState('');
  const [filter, setFilter] = useState(null); // the saved filter that is open
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [result, setResult] = useState({ items: [], total: 0, orderBy: [] });
  const [loadedKey, setLoadedKey] = useState(null); // the search whose results are shown
  const [serverError, setServerError] = useState(null);
  const [notice, setNotice] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState(null);
  const [saveRequest, setSaveRequest] = useState(null); // { kind: 'new' | 'copy' | 'edit' }
  const [helpOpen, setHelpOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null); // split view
  const [detailTaskId, setDetailTaskId] = useState(null); // list view drawer
  const [createRequest, setCreateRequest] = useState(null);
  const [moveRequest, setMoveRequest] = useState(null);
  const [deleteRequest, setDeleteRequest] = useState(null);
  const [startRequest, setStartRequest] = useState(null);
  const [startAssigneeId, setStartAssigneeId] = useState('');

  /* ---------------------------------------------------------- query state */

  // Default mode: the dropdown values are the query.
  const applyConfig = useCallback((next) => {
    setConfig(next);
    setAppliedTql(configToTql(next));
    setPage(1);
  }, []);

  // Key / summary boxes apply after a short pause (or Enter).
  useEffect(() => {
    if (mode !== 'default') return undefined;
    if (textDraft.key === config.key && textDraft.summary === config.summary) return undefined;
    const timer = window.setTimeout(() => applyConfig({ ...config, ...textDraft }), 400);
    return () => window.clearTimeout(timer);
  }, [textDraft, config, mode, applyConfig]);

  function loadQuery(tql, preferredMode, savedFilter = null) {
    setFilter(savedFilter);
    setServerError(null);
    setNotice('');
    setPage(1);
    setTqlDraft(tql);
    setAppliedTql(tql);
    const parsed = tqlToConfig(tql);
    if (parsed.config) {
      const matched = matchConfigValues(parsed.config, options);
      setConfig(matched);
      setTextDraft({ key: matched.key, summary: matched.summary });
      setMoreFields(usedMoreFields(matched));
    }
    const nextMode = parsed.config ? preferredMode : 'tql';
    setMode(nextMode);
    if (preferredMode === 'default' && !parsed.config) setNotice(parsed.error);
  }

  // Open a saved filter (or a query) passed by the route.
  const routeFilterId = routeData?.filterId || null;
  const routeTql = routeData?.tql ?? null;
  const routeKey = routeData?.openRequestId || routeFilterId || routeTql;
  const loadedRoute = useRef(undefined);
  useEffect(() => {
    if (loadedRoute.current === routeKey) return;
    const firstVisit = loadedRoute.current === undefined;
    loadedRoute.current = routeKey;
    if (routeFilterId) {
      api.getSavedFilter(routeFilterId)
        .then((saved) => loadQuery(saved.tql, readPref(MODE_KEY, 'default', ['default', 'tql']), saved))
        .catch((error) => setToast({ type: 'error', message: error.message || 'Could not open the filter.' }));
    } else if (routeTql !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the route opened a query
      loadQuery(routeTql, readPref(MODE_KEY, 'default', ['default', 'tql']));
    } else if (!firstVisit) {
      // "Search work items" in the sidebar while a filter is open: start a new search.
      loadQuery('', readPref(MODE_KEY, 'default', ['default', 'tql']));
      setConfig(emptyConfig());
      setTextDraft({ key: '', summary: '' });
      setMoreFields([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  // Values typed in TQL ("alice nguyen") shown as the matching dropdown options.
  const shownConfig = useMemo(() => matchConfigValues(config, options), [config, options]);

  // Search whenever the applied query, page or page size changes.
  const searchKey = `${appliedTql}\u0000${page}\u0000${pageSize}\u0000${refreshKey}`;
  const loading = loadedKey !== searchKey;
  useEffect(() => {
    const controller = new AbortController();
    api.searchWorkItems({ tql: appliedTql, page, pageSize }, { signal: controller.signal })
      .then((data) => {
        setResult(data);
        setServerError(null);
        setLoadedKey(searchKey);
        if (data.items.length && !data.items.some((item) => String(item.id) === String(selectedId))) setSelectedId(data.items[0].id);
      })
      .catch((error) => {
        if (error.name === 'AbortError') return;
        setLoadedKey(searchKey);
        setResult({ items: [], total: 0, orderBy: [] });
        setServerError(error.payload?.position ? { message: error.message, ...error.payload.position } : { message: error.message });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedTql, page, pageSize, refreshKey]);

  // Rows show the latest copy of each work item (inline edits update the app's list).
  const latest = useMemo(() => new Map(allTasks.map((task) => [String(task.id), task])), [allTasks]);
  const rows = result.items.map((item) => latest.get(String(item.id)) || item);
  const sort = result.orderBy?.[0] ? { field: result.orderBy[0].field, direction: result.orderBy[0].direction } : { field: 'created', direction: 'DESC' };

  /* --------------------------------------------------------------- modes */

  function switchMode(next) {
    if (next === mode) return;
    if (next === 'tql') {
      const text = configToTql({ ...config, ...textDraft });
      setTqlDraft(text);
      setAppliedTql(text);
      setNotice('');
      setMode('tql');
      writePref(MODE_KEY, 'tql');
      return;
    }
    const parsed = tqlToConfig(tqlDraft);
    if (!parsed.config) { setNotice(parsed.error); return; }
    const matched = matchConfigValues(parsed.config, options);
    setConfig(matched);
    setTextDraft({ key: matched.key, summary: matched.summary });
    setMoreFields(usedMoreFields(matched));
    setAppliedTql(configToTql(matched));
    setNotice('');
    setMode('default');
    writePref(MODE_KEY, 'default');
  }

  function runTql(text = tqlDraft) {
    const check = validate(text);
    if (!check.ok) { setServerError(null); return; }
    setNotice('');
    setPage(1);
    if (text === appliedTql) setRefreshKey((key) => key + 1);
    else setAppliedTql(text);
  }

  function changeSort(field) {
    const direction = sort.field === field ? (sort.direction === 'DESC' ? 'ASC' : 'DESC') : (DEFAULT_SORT_DIRECTION[field] || 'ASC');
    const id = `${field} ${direction}`;
    if (mode === 'default') { applyConfig({ ...config, orderBy: id }); return; }
    const check = validate(tqlDraft);
    if (!check.ok) return;
    const text = stringify({ ...check.ast, orderBy: [{ field, direction }] });
    setTqlDraft(text);
    setAppliedTql(text);
    setPage(1);
  }

  function setList(name, values) { applyConfig({ ...config, ...textDraft, [name]: values }); }
  function setDates(name, range) { applyConfig({ ...config, ...textDraft, dates: { ...config.dates, [name]: range } }); }
  function removeMore(name) {
    setMoreFields((current) => current.filter((item) => item !== name));
    if (name === 'labels') setList('labels', []);
    else { const dates = { ...config.dates }; delete dates[name]; applyConfig({ ...config, ...textDraft, dates }); }
  }
  function clearAll() {
    const next = { ...emptyConfig(), orderBy: config.orderBy };
    setTextDraft({ key: '', summary: '' });
    setMoreFields([]);
    applyConfig(next);
  }

  /* --------------------------------------------------------------- saving */

  const currentTql = mode === 'tql' ? tqlDraft : configToTql({ ...config, ...textDraft });
  const dirty = filter ? normalizeTql(currentTql) !== normalizeTql(filter.tql) : false;
  const hasConditions = Boolean(currentTql.trim());

  async function saveFilter({ name, description, visibility }) {
    const tql = currentTql.trim();
    const check = validate(tql);
    if (!check.ok) return `Fix the query first: ${check.error.message}`;
    try {
      if (saveRequest.kind === 'edit') {
        const saved = await api.updateSavedFilter(filter.id, { name, description, visibility });
        setFilter(saved);
        setToast({ type: 'success', message: `Filter "${saved.name}" updated.` });
      } else {
        const saved = await api.createSavedFilter({ name, description, visibility, tql });
        setFilter(saved);
        setToast({ type: 'success', message: `Filter "${saved.name}" saved. Find it in View all filters.` });
      }
      setSaveRequest(null);
      return '';
    } catch (error) {
      return error.message || 'Could not save the filter.';
    }
  }

  async function saveChange() {
    const tql = currentTql.trim();
    const check = validate(tql);
    if (!check.ok) { setToast({ type: 'error', message: `Fix the query first: ${check.error.message}` }); return; }
    try {
      const saved = await api.updateSavedFilter(filter.id, { tql });
      setFilter(saved);
      setToast({ type: 'success', message: `Changes to "${saved.name}" saved.` });
    } catch (error) {
      setToast({ type: 'error', message: error.message || 'Could not save the changes.' });
    }
  }

  /* ---------------------------------------------------------- task actions */

  const tasksOf = (space) => (space ? allTasks.filter((task) => isInSpace(task, space)) : []);
  function changeStatus(task, status) {
    const space = spaceOfItem(spaces, task);
    const check = validateIssueTransition(task, status, tasksOf(space));
    if (!check.allowed) { setToast({ type: 'error', message: check.reason || 'This transition is not allowed.' }); return; }
    if (status === 'In Progress' && !assigneeName(task)) { setStartRequest({ task, status }); setStartAssigneeId(''); return; }
    onUpdateTask(task.id, { status });
  }
  async function moveTasks(targetId) {
    const target = spaces.find((space) => String(space.id) === String(targetId));
    if (!target || !moveRequest) return;
    const moved = await onMoveTasks(moveRequest.tasks, target);
    if (moved) { setToast({ type: 'success', message: `${moved.length} work item${moved.length === 1 ? '' : 's'} moved to ${target.name}.` }); moveRequest.done?.(); setRefreshKey((key) => key + 1); }
    setMoveRequest(null);
  }

  const detailTask = detailTaskId ? latest.get(String(detailTaskId)) || rows.find((row) => String(row.id) === String(detailTaskId)) : null;
  const splitTask = view === 'split' && selectedId ? latest.get(String(selectedId)) || rows.find((row) => String(row.id) === String(selectedId)) : null;
  const drawerProps = (task, close) => {
    const space = spaceOfItem(spaces, task);
    return {
      issue: task,
      allIssues: tasksOf(space),
      space: space || {},
      onClose: close,
      onUpdateTask,
      onDeleteTask: (issue) => { onDeleteTasks([issue.id]); close(); setRefreshKey((key) => key + 1); },
      onCloneTask: async (payload) => { const created = await onCreateTask(payload); if (created) { setToast({ type: 'success', message: `${issueKey(created)} created.` }); setRefreshKey((key) => key + 1); } return created; },
      onCreateChild: (parent, allowedIssueTypes) => setCreateRequest({ space, parentId: String(parent.id), allowedIssueTypes }),
      onOpenIssue: (issueId) => (view === 'split' ? setSelectedId(issueId) : setDetailTaskId(issueId)),
      onMoveTask: (issue) => setMoveRequest({ tasks: [issue], space })
    };
  };

  /* ---------------------------------------------------------------- view */

  const title = filter?.name || 'All work items';
  const orderOptions = [...ORDER_OPTIONS.map((option) => ({ value: option.id, label: option.label })),
    ...(ORDER_OPTIONS.some((option) => option.id === config.orderBy) ? [] : [{ value: config.orderBy, label: orderLabel(config.orderBy) }])];
  const visibleMore = [...new Set([...moreFields, ...usedMoreFields(config)])];
  const activeCount = configToTql({ ...config, ...textDraft, orderBy: DEFAULT_ORDER }) ? 1 : 0;

  const tqlActions = (
    <div className="tql-actions">
      {tqlDraft && <button type="button" className="tql-icon" onClick={() => { setTqlDraft(''); runTql(''); }} aria-label="Clear query" title="Clear"><Icon name="close" size={13} /></button>}
      <button type="button" className="tql-icon" onClick={async () => { try { await navigator.clipboard.writeText(tqlDraft); setToast({ type: 'success', message: 'Query copied.' }); } catch { setToast({ type: 'error', message: 'Copy is not available.' }); } }} aria-label="Copy query" title="Copy query"><Icon name="copy" size={14} /></button>
      <button type="button" className={`tql-icon ${helpOpen ? 'is-active' : ''}`} onClick={() => setHelpOpen((open) => !open)} aria-label="TQL help" title="TQL syntax" aria-expanded={helpOpen}><Icon name="info" size={14} /></button>
      <button type="button" className="tql-run" onClick={() => runTql()} aria-label="Search" title="Search (Enter)"><Icon name="search" size={15} /></button>
    </div>
  );

  return (
    <div className="app-shell">
      <Header spaces={spaces} tasks={allTasks} onGlobalCreate={onGlobalCreate} onOpenTask={onOpenTask} />
      <Sidebar activeSection="Filters" activeFilterView="search" spaces={spaces} onCreateSpace={onCreateSpace} onNavigate={onNavigate} onOpenSpaceSettings={onOpenSpaceSettings} onDeleteSpace={onDeleteSpace} />

      <main className="main-content fs-page">
        <nav className="breadcrumb fs-breadcrumb" aria-label="Breadcrumb">
          <span>Filters</span><span>/</span>
          {filter ? <><button type="button" onClick={() => onNavigate('filters')}>View all filters</button><span>/</span><strong>{filter.name}</strong></> : <strong>Search work items</strong>}
        </nav>

        <div className="fs-head">
          <div className="fs-title">
            {filter && <button type="button" className="fs-back" onClick={() => onNavigate('filters')} aria-label="Back to all filters"><Icon name="arrowLeft" size={16} /></button>}
            <h1>{title}</h1>
            {filter?.permissions?.edit && <button type="button" className="fs-rename" onClick={() => setSaveRequest({ kind: 'edit' })} aria-label="Edit filter details" title="Rename / edit details"><Icon name="edit" size={15} /></button>}
            {filter && <span className={`fl-access-badge is-${filter.visibility}`}>{filter.isSystem ? 'Default' : filter.visibility === 'public' ? 'Public' : 'Private'}</span>}
            {filter && dirty && <span className="fs-dirty">Edited</span>}
          </div>
          <div className="fs-head-actions">
            <button type="button" className="fs-all-filters" onClick={() => onNavigate('filters')} title="View all filters"><Icon name="list" size={14} /> All filters</button>
            <div className="fs-segment" role="group" aria-label="View">
              <button type="button" aria-pressed={view === 'list'} className={view === 'list' ? 'is-active' : ''} onClick={() => { setView('list'); writePref(VIEW_KEY, 'list'); }} title="List view" aria-label="List view"><Icon name="list" size={15} /></button>
              <button type="button" aria-pressed={view === 'split'} className={view === 'split' ? 'is-active' : ''} onClick={() => { setView('split'); writePref(VIEW_KEY, 'split'); }} title="Detail split view" aria-label="Detail split view"><Icon name="layout" size={15} /></button>
            </div>
            <div className="fs-segment fs-mode" role="group" aria-label="Search mode">
              <button type="button" aria-pressed={mode === 'default'} className={mode === 'default' ? 'is-active' : ''} onClick={() => switchMode('default')}>Default</button>
              <button type="button" aria-pressed={mode === 'tql'} className={mode === 'tql' ? 'is-active' : ''} onClick={() => switchMode('tql')}>TQL</button>
            </div>
          </div>
        </div>

        {notice && (
          <div className="fs-notice" role="status">
            <Icon name="info" size={14} /> <span>{notice}</span>
            <button type="button" onClick={() => setNotice('')} aria-label="Dismiss"><Icon name="close" size={11} /></button>
          </div>
        )}

        {mode === 'default' ? (
          <div className="fs-toolbar" role="search" aria-label="Filter work items">
            <label className="fs-search">
              <Icon name="search" size={14} />
              <input value={textDraft.key} onChange={(event) => setTextDraft((draft) => ({ ...draft, key: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter') applyConfig({ ...config, ...textDraft }); }} placeholder="Search issue key" aria-label="Search issue key" />
            </label>
            <label className="fs-search fs-search-wide">
              <Icon name="search" size={14} />
              <input value={textDraft.summary} onChange={(event) => setTextDraft((draft) => ({ ...draft, summary: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter') applyConfig({ ...config, ...textDraft }); }} placeholder="Search summary" aria-label="Search summary" />
            </label>
            {MAIN_FIELDS.map(([name, label]) => (
              <FilterDropdown key={name} label={label} options={options[name]} value={shownConfig[name]} onChange={(values) => setList(name, values)} people={name === 'assignee' || name === 'creator'} testId={`filter-${name}`} />
            ))}
            {visibleMore.map((name) => (name === 'labels'
              ? <span key={name} className="fs-more-field"><FilterDropdown label="Labels" options={options.labels} value={shownConfig.labels} onChange={(values) => setList('labels', values)} testId="filter-labels" /><button type="button" className="fs-pill-remove is-outside" onClick={() => removeMore('labels')} aria-label="Remove Labels filter"><Icon name="close" size={10} /></button></span>
              : <DateRangeFilter key={name} label={MORE_FIELDS.find(([field]) => field === name)[1]} range={config.dates?.[name]} onChange={(range) => setDates(name, range)} onRemove={() => removeMore(name)} />))}
            <FilterDropdown
              label="More filters"
              options={MORE_FIELDS.map(([value, label]) => ({ value, label }))}
              value={visibleMore}
              searchable={false}
              onChange={(values) => {
                const removed = visibleMore.filter((name) => !values.includes(name));
                setMoreFields(values);
                removed.forEach(removeMore);
              }}
              testId="filter-more"
            />
            <FilterDropdown label="Order by" single searchable={false} options={orderOptions} value={config.orderBy} onChange={(value) => applyConfig({ ...config, ...textDraft, orderBy: value })} testId="filter-order" />
            <button type="button" className="fs-clear" onClick={clearAll} disabled={!activeCount} title="Clear all filters" aria-label="Clear all filters"><Icon name="filter" size={14} /><Icon name="close" size={9} className="fs-clear-x" /></button>
          </div>
        ) : (
          <div className="fs-tql-row">
            <TqlEditor
              value={tqlDraft}
              onChange={setTqlDraft}
              onSubmit={runTql}
              meta={meta}
              currentUser={user}
              serverError={tqlDraft === appliedTql ? serverError : null}
              placeholder='e.g. project = "PRJ-01" AND assignee = currentUser() AND status IN ("To Do", "In Progress") ORDER BY dueDate ASC'
              actions={tqlActions}
            />
            {helpOpen && (
              <div className="tql-help" role="region" aria-label="TQL syntax">
                <div><strong>Fields</strong><p>project, key, summary, description, status, statusCategory, priority, type, assignee, creator, sprint, labels, created, updated, startDate, dueDate</p></div>
                <div><strong>Operators</strong><p>= &nbsp;!= &nbsp;~ (contains) &nbsp;!~ &nbsp;&gt; &nbsp;&gt;= &nbsp;&lt; &nbsp;&lt;= &nbsp;IN (…) &nbsp;NOT IN (…) &nbsp;IS EMPTY &nbsp;IS NOT EMPTY</p></div>
                <div><strong>Logic &amp; sorting</strong><p>AND, OR, NOT, ( … ), ORDER BY field ASC | DESC</p></div>
                <div><strong>Functions</strong><p>currentUser(), now(), startOfDay(), endOfDay(), startOfWeek(), endOfWeek(), startOfMonth(), endOfMonth() — with an offset such as startOfDay(-1). Relative dates: -7d, +1w.</p></div>
                <div className="tql-help-examples"><strong>Examples</strong>
                  {[
                    'assignee = currentUser() AND statusCategory != "Done" ORDER BY priority DESC',
                    'dueDate < startOfDay() AND statusCategory NOT IN ("Done", "Closed")',
                    '(type = Bug OR priority = Highest) AND updated >= -7d',
                    'summary ~ "thông báo" AND assignee IS EMPTY'
                  ].map((example) => <button type="button" key={example} onClick={() => { setTqlDraft(example); runTql(example); }}><code>{example}</code></button>)}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="fs-save-row">
          {!filter && <button type="button" className="fs-link" onClick={() => setSaveRequest({ kind: 'new' })} disabled={!hasConditions} title={hasConditions ? 'Save these conditions as a filter' : 'Add a condition first'}><Icon name="star" size={13} /> Save filter</button>}
          {filter?.permissions?.edit && <button type="button" className="fs-link" onClick={saveChange} disabled={!dirty}>Save change</button>}
          {filter && <button type="button" className="fs-link" onClick={() => setSaveRequest({ kind: 'copy' })}>Save as a copy</button>}
          {filter && dirty && <button type="button" className="fs-link is-muted" onClick={() => loadQuery(filter.tql, mode, filter)}>Discard changes</button>}
          {mode === 'default' && hasConditions && <code className="fs-tql-preview" title="The same search as TQL">{currentTql}</code>}
        </div>

        {view === 'list' ? (
          <TaskTable
            tasks={rows}
            allTasks={allTasks}
            spaces={spaces}
            title="Work items"
            subtitle={loading ? 'Searching…' : `${result.total} match${result.total === 1 ? '' : 'es'} · sorted by ${orderLabel(`${sort.field} ${sort.direction}`)}`}
            onOpenTask={(task) => setDetailTaskId(task.id)}
            onUpdateTask={onUpdateTask}
            onChangeStatus={changeStatus}
            onMoveSelected={(selected, done) => setMoveRequest({ tasks: selected, space: spaceOfItem(spaces, selected[0]), done })}
            onDeleteSelected={(selected, done) => setDeleteRequest({ tasks: selected, done })}
            paging={{ page, pageSize, total: result.total, onPageChange: setPage, onPageSizeChange: (size) => { setPageSize(size); setPage(1); } }}
            sort={sort}
            onSort={changeSort}
            loading={loading}
            emptyTitle={serverError ? 'The query could not run' : 'No work items match'}
            emptyText={serverError ? serverError.message : 'Try removing a condition or changing the query.'}
            headerActions={<button type="button" className="fs-refresh" onClick={() => setRefreshKey((key) => key + 1)} aria-label="Refresh results" title="Refresh"><Icon name="refresh" size={14} /></button>}
          />
        ) : (
          <section className="fs-split" aria-label="Work items">
            <div className="fs-split-list">
              <div className="fs-split-head">
                <strong>{loading ? 'Searching…' : `${rows.length ? (page - 1) * pageSize + 1 : 0}-${(page - 1) * pageSize + rows.length} of ${result.total}`}</strong>
                <div>
                  <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">‹</button>
                  <button type="button" disabled={page * pageSize >= result.total} onClick={() => setPage(page + 1)} aria-label="Next page">›</button>
                  <button type="button" onClick={() => setRefreshKey((key) => key + 1)} aria-label="Refresh results" title="Refresh"><Icon name="refresh" size={13} /></button>
                </div>
              </div>
              <ul role="listbox" aria-label="Results">
                {rows.map((task) => {
                  const type = issueType(task);
                  const active = String(task.id) === String(selectedId);
                  return (
                    <li key={task.id} role="option" aria-selected={active}>
                      <button type="button" className={`fs-split-item ${active ? 'is-active' : ''}`} onClick={() => setSelectedId(task.id)}>
                        <span className="fs-split-top">
                          <span className={`slv-type-icon type-${type.toLowerCase().replace(/[^a-z]+/g, '-')}`} title={type}><Icon name={iconForType(type)} size={13} /></span>
                          <span className="fs-split-key">{issueKey(task)}</span>
                          <StatusBadge status={task.status} className="fs-split-status" />
                        </span>
                        <span className="fs-split-title" title={issueSummary(task)}>{issueSummary(task)}</span>
                        <span className="fs-split-meta">
                          <PersonAvatar person={task.assignee} className="fs-split-avatar" fallback={task.assignee ? null : '?'} />
                          <span>{assigneeName(task) || (task.assignee ? findUser(users, task.assignee)?.fullName : '') || 'Unassigned'}</span>
                          <span className="fs-split-project">{spaceOfItem(spaces, task)?.name || task.spaceCode}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
                {!rows.length && <li className="fs-split-empty">{loading ? 'Searching…' : serverError ? serverError.message : 'No work items match.'}</li>}
              </ul>
            </div>
            <div className="fs-split-detail">
              {splitTask && spaceOfItem(spaces, splitTask)
                ? <TaskDetailDrawer key={splitTask.id} embedded {...drawerProps(splitTask, () => setSelectedId(null))} />
                : <div className="fs-split-placeholder"><Icon name="file" size={28} /><span>Select a work item to see its details.</span></div>}
            </div>
          </section>
        )}
      </main>

      {view === 'list' && detailTask && spaceOfItem(spaces, detailTask) && (
        <TaskDetailDrawer key={detailTask.id} {...drawerProps(detailTask, () => setDetailTaskId(null))} />
      )}

      {saveRequest && (
        <SaveFilterModal
          title={saveRequest.kind === 'edit' ? 'Edit filter details' : saveRequest.kind === 'copy' ? 'Save as a copy' : 'Save filter'}
          submitLabel={saveRequest.kind === 'edit' ? 'Save' : 'Save filter'}
          initial={saveRequest.kind === 'edit' ? filter : saveRequest.kind === 'copy' ? { name: `${filter.name} (copy)`, description: filter.description } : {}}
          tql={currentTql}
          showQuery={saveRequest.kind !== 'edit'}
          onClose={() => setSaveRequest(null)}
          onSubmit={saveFilter}
        />
      )}

      {createRequest && (
        <IssueModal space={createRequest.space} existingIssues={tasksOf(createRequest.space)} initialParentId={createRequest.parentId} allowedIssueTypes={createRequest.allowedIssueTypes} onClose={() => setCreateRequest(null)} onCreate={onCreateTask} />
      )}
      {moveRequest && (
        <MoveModal spaces={spaces} currentSpace={moveRequest.space} count={moveRequest.tasks.length} onClose={() => setMoveRequest(null)} onMove={moveTasks} />
      )}
      {deleteRequest && (
        <ConfirmModal
          title={`Delete ${deleteRequest.tasks.length === 1 ? issueKey(deleteRequest.tasks[0]) : `${deleteRequest.tasks.length} work items`}?`}
          message="Deleted work items cannot be restored."
          onClose={() => setDeleteRequest(null)}
          onConfirm={async () => { await onDeleteTasks(deleteRequest.tasks.map((task) => task.id)); deleteRequest.done?.(); setDeleteRequest(null); setRefreshKey((key) => key + 1); }}
        />
      )}
      {startRequest && (
        <StartTransitionModal
          issues={[startRequest.task]}
          members={spaceOfItem(spaces, startRequest.task)?.members || []}
          assigneeId={startAssigneeId}
          onAssigneeChange={setStartAssigneeId}
          onClose={() => setStartRequest(null)}
          onConfirm={(assignee) => { onUpdateTask(startRequest.task.id, { status: startRequest.status, assignee }); setStartRequest(null); }}
        />
      )}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
