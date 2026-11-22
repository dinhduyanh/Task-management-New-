import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Header from '../../components/layout/Header';
import Sidebar from '../../components/layout/Sidebar';
import Icon from '../../components/common/Icon';
import Toast from '../../components/common/Toast';
import DatePicker from '../../components/common/DatePicker';
import PersonAvatar from '../../components/common/PersonAvatar';
import { useAppShell } from '../../context/appShellContext';
import { api } from '../../services/api';
import { buildXlsx, downloadBlob } from '../../services/xlsx';
import FilterDropdown from '../Filters/components/FilterDropdown';
import { iconForType } from '../SpacesList/issueHelpers';
import {
  CATEGORIES, CHILD_LABEL, MAX_DAY_COLUMNS, PERIODS, SUB_GROUPS, buildColumns, buildRows, daysBetween, defaultRange,
  formatTime, rangeLabel, rangeTitle, shiftRange, toHours, todayIso
} from './timesheetModel';
import '../Filters/Filters.css';
import './Timesheet.css';

const EMPTY_FILTERS = { projects: [], users: [], teams: [], types: [], statuses: [] };
const DAY_TARGET_MINUTES = 8 * 60; // full bar = 8h a day
const OPTIONS_KEY = 'taskflow:timesheet-options';

function readOptions() {
  try { return { unit: 'hours', weekends: true, bars: true, ...JSON.parse(window.localStorage.getItem(OPTIONS_KEY) || '{}') }; } catch { return { unit: 'hours', weekends: true, bars: true }; }
}

/** Popover listing the logged work behind one cell. */
function CellPopover({ detail, unit, onClose, onOpenTask, onDelete }) {
  const ref = useRef(null);
  const [position, setPosition] = useState(null);
  useLayoutEffect(() => {
    const rect = detail.rect;
    const height = ref.current?.offsetHeight || 300;
    const width = 380;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const below = rect.bottom + 6 + height < window.innerHeight;
    setPosition({ left, top: below ? rect.bottom + 6 : Math.max(8, rect.top - height - 6) });
  }, [detail]);
  useEffect(() => {
    const onPointer = (event) => { if (!ref.current?.contains(event.target)) onClose(); };
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    // The click that opened it may scroll the cell into view: ignore that first scroll.
    const openedAt = Date.now();
    const onScroll = (event) => { if (Date.now() - openedAt > 250 && !ref.current?.contains(event.target)) onClose(); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => { document.removeEventListener('mousedown', onPointer); document.removeEventListener('keydown', onKey); window.removeEventListener('scroll', onScroll, true); };
  }, [onClose]);
  const total = detail.entries.reduce((sum, entry) => sum + entry.minutes, 0);
  const byDate = [...detail.entries].sort((a, b) => b.date.localeCompare(a.date) || a.workItem.key.localeCompare(b.workItem.key));
  return createPortal(
    <section ref={ref} className="ts-popover" role="dialog" aria-label={`Logged work: ${detail.title}`} style={position ? { left: position.left, top: position.top } : { visibility: 'hidden' }}>
      <header className="ts-popover-head">
        <div>
          <strong>{detail.title}</strong>
          <small>{detail.columnLabel}</small>
        </div>
        <span className="ts-popover-total">{formatTime(total, unit)}</span>
        <button type="button" onClick={onClose} aria-label="Close"><Icon name="close" size={13} /></button>
      </header>
      {byDate.length ? (
        <ul className="ts-popover-list">
          {byDate.map((entry) => (
            <li key={entry.id}>
              <div className="ts-entry-top">
                <span className={`slv-type-icon type-${String(entry.workItem.type || 'task').toLowerCase().replace(/[^a-z]+/g, '-')}`}><Icon name={iconForType(entry.workItem.type)} size={12} /></span>
                <button type="button" className="ts-entry-task" onClick={() => onOpenTask(entry.workItem.id)} title={`Open ${entry.workItem.key}`}>
                  <strong>{entry.workItem.key}</strong> {entry.workItem.title}
                </button>
                <span className="ts-entry-time">{formatTime(entry.minutes, unit)}</span>
              </div>
              {entry.description && <p className="ts-entry-desc">{entry.description}</p>}
              <div className="ts-entry-meta">
                <PersonAvatar person={entry.user} className="ts-entry-avatar" />
                <span>{entry.user.fullName}</span>
                <span>·</span>
                <span>{entry.project.name}</span>
                <span>·</span>
                <time dateTime={entry.date}>{entry.date.split('-').reverse().join('/')}</time>
                {entry.own && <button type="button" className="ts-entry-delete" onClick={() => onDelete(entry)} aria-label={`Delete work log of ${entry.date}`} title="Delete my work log"><Icon name="trash" size={12} /></button>}
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="ts-popover-empty">No work logged.</p>}
    </section>,
    document.body
  );
}

/** Small dropdown panel (Options, Export, date range). */
function Panel({ label, icon, children, className = '', testId, buttonClass = 'fs-pill' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => { if (!ref.current?.contains(event.target) && !event.target.closest?.('.dp-popover')) setOpen(false); };
    const onKey = (event) => { if (event.key === 'Escape' && !document.querySelector('.dp-popover')) setOpen(false); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className={`ts-panel-wrap ${className}`} ref={ref}>
      <button type="button" className={`${buttonClass} ${open ? 'is-open' : ''}`} onClick={() => setOpen((value) => !value)} aria-expanded={open} data-testid={testId}>
        {icon && <Icon name={icon} size={14} />}<span>{label}</span><Icon name="chevron" size={13} />
      </button>
      {open && <div className="ts-panel" role="dialog" aria-label={label}>{typeof children === 'function' ? children(() => setOpen(false)) : children}</div>}
    </div>
  );
}

/** Resource management > Timesheet: logged work per user / project and day. */
export default function Timesheet({ spaces = [], allTasks = [], onNavigate, onCreateSpace, onOpenSpaceSettings, onDeleteSpace, onGlobalCreate, onOpenTask }) {
  const { user, openTaskById } = useAppShell();
  const [meta, setMeta] = useState(null);
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [period, setPeriod] = useState('day');
  const [range, setRange] = useState(() => defaultRange('day'));
  const [category, setCategory] = useState('user');
  const [subGroup, setSubGroup] = useState('project');
  const [options, setOptions] = useState(readOptions);
  const [data, setData] = useState(null);
  const [loadedKey, setLoadedKey] = useState(null);
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [detail, setDetail] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [toast, setToast] = useState(null);
  const [customRange, setCustomRange] = useState(range);

  useEffect(() => { api.getTimesheetMeta().then(setMeta).catch(() => {}); }, []);
  useEffect(() => { try { window.localStorage.setItem(OPTIONS_KEY, JSON.stringify(options)); } catch { /* storage unavailable */ } }, [options]);

  const requestKey = JSON.stringify({ range, applied, refresh });
  const loading = loadedKey !== requestKey;
  useEffect(() => {
    let active = true;
    api.getTimesheet({ ...range, ...applied })
      .then((result) => { if (active) { setData(result); setError(''); setLoadedKey(requestKey); } })
      .catch((loadError) => { if (active) { setError(loadError.message || 'Could not load the timesheet.'); setLoadedKey(requestKey); } });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const options$ = useMemo(() => {
    if (!meta) return { projects: [], users: [], teams: [], types: [], statuses: [] };
    return {
      projects: meta.projects.map((project) => ({ value: project.id, label: project.name, sublabel: project.code, shortLabel: project.code, aliases: [project.code] })),
      users: meta.users.map((person) => ({ value: person.id, label: person.fullName, sublabel: person.email, user: person, isCurrentUser: String(person.id) === String(user?.id), pinned: String(person.id) === String(user?.id), aliases: [person.email, person.username] })),
      teams: meta.teams.map((team) => ({ value: team.id, label: team.name, sublabel: team.project })),
      types: meta.types.map((name) => ({ value: name, label: name, icon: <span className={`slv-type-icon type-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`}><Icon name={iconForType(name)} size={13} /></span> })),
      statuses: meta.statuses.map((name) => ({ value: name, label: name }))
    };
  }, [meta, user]);

  const allColumns = useMemo(() => buildColumns(range, period), [range, period]);
  const columns = period === 'day' && !options.weekends ? allColumns.filter((column) => !column.weekend) : allColumns;
  const grid = useMemo(() => buildRows(data?.entries || [], { category, subGroup, period }), [data, category, subGroup, period]);
  const pending = JSON.stringify(draft) !== JSON.stringify(applied);
  const maxCell = Math.max(DAY_TARGET_MINUTES * (period === 'day' ? 1 : period === 'week' ? 5 : 21), 1);

  function changePeriod(next) {
    setPeriod(next);
    const nextRange = next === 'month' ? defaultRange('month', range.from) : defaultRange(next, period === 'month' ? todayIso() : range.from);
    setRange(nextRange);
    setCustomRange(nextRange);
  }
  function moveRange(direction) { const next = shiftRange(range, period, direction); setRange(next); setCustomRange(next); }
  function thisPeriod() { const next = defaultRange(period); setRange(next); setCustomRange(next); }
  const toggleRow = (id) => setCollapsed((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const allCollapsed = grid.rows.length > 0 && grid.rows.every((row) => collapsed.has(row.id));

  function openCell(event, row, column) {
    const days = new Set(column ? column.days : []);
    const entries = column ? row.entries.filter((entry) => days.has(entry.date)) : row.entries;
    setDetail({ rect: event.currentTarget.getBoundingClientRect(), title: row.label, columnLabel: column ? `${column.label}${column.sub ? ` (${column.sub})` : ''}` : `Total · ${rangeLabel(range)}`, entries });
  }

  async function deleteEntry(entry) {
    try {
      await api.deleteWorkLog(entry.id);
      setDetail((current) => (current ? { ...current, entries: current.entries.filter((item) => item.id !== entry.id) } : current));
      setRefresh((value) => value + 1);
      setToast({ type: 'success', message: 'Work log deleted.' });
    } catch (deleteError) { setToast({ type: 'error', message: deleteError.message || 'Could not delete the work log.' }); }
  }

  function exportRows() {
    const header = [category === 'user' ? 'User / Project' : 'Project / User', 'Level', 'Total (h)', ...columns.map((column) => (column.sub ? `${column.label} (${column.sub})` : column.label))];
    const rows = [header, ['Total', '', toHours(grid.total.total), ...columns.map((column) => toHours(grid.total.cells[column.key] || 0))]];
    for (const row of grid.rows) {
      rows.push([row.label, CATEGORIES.find((item) => item.id === category).label, toHours(row.total), ...columns.map((column) => toHours(row.cells[column.key] || 0))]);
      for (const child of row.children) rows.push([`    ${child.label}`, SUB_GROUPS.find((item) => item.id === child.kind)?.label || '', toHours(child.total), ...columns.map((column) => toHours(child.cells[column.key] || 0))]);
    }
    return rows;
  }
  function exportXlsx() {
    const rows = exportRows();
    downloadBlob(buildXlsx(rows, { sheetName: 'Timesheet', bold: [0, 1], widths: [42, 12, 10, ...columns.map(() => 13)] }), `timesheet_${range.from}_${range.to}.xlsx`);
    setToast({ type: 'success', message: 'Timesheet exported to Excel.' });
  }
  function exportCsv() {
    const quote = (value) => (typeof value === 'number' ? String(value) : `"${String(value).replace(/"/g, '""')}"`);
    const text = exportRows().map((row) => row.map(quote).join(',')).join('\r\n');
    downloadBlob(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }), `timesheet_${range.from}_${range.to}.csv`);
  }

  const customDays = daysBetween(customRange.from, customRange.to).length;
  const customError = !customRange.from || !customRange.to ? 'Choose both dates.' : customDays === 0 ? 'The end date must be on or after the start date.' : customDays > MAX_DAY_COLUMNS ? `Choose at most ${MAX_DAY_COLUMNS} days.` : '';
  const cellBox = (minutes, extra = '') => (
    <span className={`ts-box ${minutes ? 'has-time' : ''} ${extra}`}>
      <span>{formatTime(minutes, options.unit)}</span>
      {options.bars && <span className="ts-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, (minutes / maxCell) * 100)}%` }} /></span>}
    </span>
  );

  return (
    <div className="app-shell">
      <Header spaces={spaces} tasks={allTasks} onGlobalCreate={onGlobalCreate} onOpenTask={onOpenTask} />
      <Sidebar activeSection="Timesheet" spaces={spaces} onCreateSpace={onCreateSpace} onNavigate={onNavigate} onOpenSpaceSettings={onOpenSpaceSettings} onDeleteSpace={onDeleteSpace} />
      <main className="main-content fs-page ts-page">
        <div className="fs-head">
          <div className="fs-title"><h1>Timesheet</h1></div>
          <div className="fs-head-actions">
            <Panel label="Export excel" icon="download" testId="ts-export" buttonClass="fs-all-filters">
              {(close) => (
                <div className="ts-menu">
                  <button type="button" onClick={() => { exportXlsx(); close(); }}><Icon name="download" size={14} /> Excel (.xlsx)</button>
                  <button type="button" onClick={() => { exportCsv(); close(); }}><Icon name="file" size={14} /> CSV (.csv)</button>
                </div>
              )}
            </Panel>
          </div>
        </div>

        <div className="fs-toolbar ts-toolbar" role="search" aria-label="Timesheet filters">
          <FilterDropdown label="Project" options={options$.projects} value={draft.projects} onChange={(values) => setDraft({ ...draft, projects: values })} testId="ts-project" />
          <FilterDropdown label="User" people options={options$.users} value={draft.users} onChange={(values) => setDraft({ ...draft, users: values })} testId="ts-user" />
          <FilterDropdown label="Team" options={options$.teams} value={draft.teams} onChange={(values) => setDraft({ ...draft, teams: values })} emptyText="No teams" testId="ts-team" />
          <FilterDropdown label="Issue Type" options={options$.types} value={draft.types} onChange={(values) => setDraft({ ...draft, types: values })} testId="ts-type" />
          <FilterDropdown label="Status" options={options$.statuses} value={draft.statuses} onChange={(values) => setDraft({ ...draft, statuses: values })} testId="ts-status" />
        </div>
        <div className="fs-toolbar ts-toolbar">
          <FilterDropdown label="Period" single searchable={false} options={PERIODS.map((item) => ({ value: item.id, label: item.label }))} value={period} onChange={changePeriod} testId="ts-period" />
          <FilterDropdown label="Categorize By" single searchable={false} options={CATEGORIES.map((item) => ({ value: item.id, label: item.label }))} value={category} onChange={(value) => { setCategory(value); if (value === subGroup) setSubGroup(value === 'user' ? 'project' : 'user'); }} testId="ts-category" />
          <FilterDropdown label="Group by" single searchable={false} options={SUB_GROUPS.filter((item) => item.id !== category).map((item) => ({ value: item.id, label: item.label }))} value={subGroup} onChange={setSubGroup} testId="ts-group" />
          <button type="button" className={`tql-run ts-apply ${pending ? 'is-pending' : ''}`} onClick={() => setApplied(draft)} aria-label="Apply filters" title={pending ? 'Apply the changed filters' : 'Search'}><Icon name="search" size={15} /></button>
          {(pending || JSON.stringify(applied) !== JSON.stringify(EMPTY_FILTERS)) && (
            <button type="button" className="fs-clear" onClick={() => { setDraft(EMPTY_FILTERS); setApplied(EMPTY_FILTERS); }} title="Clear filters" aria-label="Clear filters"><Icon name="filter" size={14} /><Icon name="close" size={9} className="fs-clear-x" /></button>
          )}
          <span className="ts-spacer" />
          <Panel label="Options" icon="sliders" testId="ts-options">
            <div className="ts-options">
              <span className="ts-options-title">Show time as</span>
              {[['hours', 'Hours (1.5h)'], ['hm', 'Hours and minutes (1h 30m)']].map(([value, label]) => (
                <label key={value}><input type="radio" name="ts-unit" checked={options.unit === value} onChange={() => setOptions({ ...options, unit: value })} /> {label}</label>
              ))}
              <span className="ts-options-title">Columns</span>
              <label><input type="checkbox" checked={options.weekends} onChange={(event) => setOptions({ ...options, weekends: event.target.checked })} /> Show weekends</label>
              <label><input type="checkbox" checked={options.bars} onChange={(event) => setOptions({ ...options, bars: event.target.checked })} /> Show progress bars (8h a day)</label>
            </div>
          </Panel>
        </div>

        <section className="ts-card" aria-label="Timesheet">
          <div className="ts-card-head">
            <button type="button" className="ts-icon-button" onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(grid.rows.map((row) => row.id)))} title={allCollapsed ? 'Expand all' : 'Collapse all'} aria-label={allCollapsed ? 'Expand all' : 'Collapse all'}><Icon name="list" size={15} /></button>
            <h2>{rangeTitle(range, period)}</h2>
            {loading && <span className="ts-loading">Loading…</span>}
            <span className="ts-spacer" />
            <button type="button" className="ts-link" onClick={thisPeriod}><Icon name="calendar" size={14} /> {period === 'month' ? 'This Year' : 'This Month'}</button>
            {period !== 'month' ? (
              <Panel label={rangeLabel(range)} buttonClass="ts-range-button" testId="ts-range">
                {(close) => (
                  <form className="ts-range-form" onSubmit={(event) => { event.preventDefault(); if (!customError) { setRange(customRange); close(); } }}>
                    <label>From<DatePicker value={customRange.from} onChange={(value) => setCustomRange({ ...customRange, from: value || '' })} ariaLabel="Timesheet from" clearable={false} /></label>
                    <label>To<DatePicker value={customRange.to} min={customRange.from} onChange={(value) => setCustomRange({ ...customRange, to: value || '' })} ariaLabel="Timesheet to" clearable={false} /></label>
                    {customError && <p className="lw-error">{customError}</p>}
                    <button type="submit" className="slv-btn primary" disabled={Boolean(customError)}>Apply</button>
                  </form>
                )}
              </Panel>
            ) : <span className="ts-range-static">Jan - Dec</span>}
            <button type="button" className="ts-icon-button" onClick={() => moveRange(-1)} aria-label="Previous period"><Icon name="chevron" size={15} className="ts-chevron-left" /></button>
            <button type="button" className="ts-icon-button" onClick={() => moveRange(1)} aria-label="Next period"><Icon name="chevron" size={15} className="ts-chevron-right" /></button>
          </div>

          {error ? <p className="ts-error" role="alert">{error}</p> : (
            <div className="ts-scroll">
              <table className="ts-table" aria-busy={loading || undefined}>
                <thead>
                  <tr>
                    <th className="ts-name-col">{category === 'user' ? 'User/Project' : 'Project/User'}</th>
                    <th className="ts-total-col">Total</th>
                    {columns.map((column) => <th key={column.key} className={`${column.weekend ? 'is-weekend' : ''} ${column.today ? 'is-today' : ''}`} title={column.sub}>{column.label}{column.sub && <small>{column.sub}</small>}</th>)}
                  </tr>
                </thead>
                <tbody>
                  <tr className="ts-total-row">
                    <th className="ts-name-col" scope="row">Total</th>
                    <td className="ts-total-col"><button type="button" className="ts-cell-button" onClick={(event) => openCell(event, { label: 'Everyone', entries: data?.entries || [] }, null)}>{formatTime(grid.total.total, options.unit)}</button></td>
                    {columns.map((column) => <td key={column.key} className={column.weekend ? 'is-weekend' : ''}>{formatTime(grid.total.cells[column.key] || 0, options.unit)}</td>)}
                  </tr>
                  {grid.rows.map((row) => {
                    const open = !collapsed.has(row.id);
                    return (
                      <Fragment key={row.id}>
                        <tr className="ts-group-row">
                          <th className="ts-name-col" scope="row">
                            <div className="ts-name">
                              {row.children.length > 0 ? <button type="button" className={`ts-toggle ${open ? 'is-open' : ''}`} onClick={() => toggleRow(row.id)} aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${row.label}`}><Icon name="chevron" size={13} /></button> : <span className="ts-toggle-space" />}
                              {row.kind === 'user' ? <PersonAvatar person={row.person} className="ts-avatar" /> : <span className="ts-project-icon"><Icon name="spaces" size={14} /></span>}
                              <span className="ts-name-text">
                                <strong title={row.label}>{row.label}</strong>
                                <small>{row.childCount} {CHILD_LABEL[row.childKind]}{row.childCount === 1 ? '' : 's'}</small>
                              </span>
                            </div>
                          </th>
                          <td className="ts-total-col"><button type="button" className="ts-cell-button" onClick={(event) => openCell(event, row, null)}>{formatTime(row.total, options.unit)}</button></td>
                          {columns.map((column) => {
                            const minutes = row.cells[column.key] || 0;
                            return (
                              <td key={column.key} className={column.weekend ? 'is-weekend' : ''}>
                                <button type="button" className="ts-cell-button" onClick={(event) => openCell(event, row, column)} aria-label={`${row.label}, ${column.label}: ${formatTime(minutes, options.unit)}`}>{cellBox(minutes)}</button>
                              </td>
                            );
                          })}
                        </tr>
                        {open && row.children.map((child) => (
                          <tr key={child.id} className="ts-child-row">
                            <th className="ts-name-col" scope="row">
                              <div className="ts-name is-child">
                                {child.kind === 'user' && <PersonAvatar person={child.person} className="ts-avatar is-small" />}
                                {child.kind === 'project' && <span className="ts-folder"><Icon name="spaces" size={14} /></span>}
                                {child.kind === 'workItem' && <span className={`slv-type-icon type-${String(child.workItem.type || 'task').toLowerCase().replace(/[^a-z]+/g, '-')}`}><Icon name={iconForType(child.workItem.type)} size={12} /></span>}
                                {child.kind === 'workItem'
                                  ? <button type="button" className="ts-child-link" onClick={() => openTaskById?.(child.workItem.id)} title={`${child.key} ${child.title}`}><strong>{child.key}</strong> {child.title}</button>
                                  : <span className="ts-child-label" title={child.label}>{child.label}</span>}
                              </div>
                            </th>
                            <td className="ts-total-col">{formatTime(child.total, options.unit)}</td>
                            {columns.map((column) => {
                              const minutes = child.cells[column.key] || 0;
                              return (
                                <td key={column.key} className={column.weekend ? 'is-weekend' : ''}>
                                  {minutes ? <button type="button" className="ts-cell-button ts-child-value" onClick={(event) => openCell(event, child, column)}>{formatTime(minutes, options.unit)}</button> : <span className="ts-dash">-</span>}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                  {!loading && !grid.rows.length && (
                    <tr><td colSpan={columns.length + 2} className="ts-empty"><Icon name="clock" size={26} /><strong>No work logged in this period</strong><span>Log work from a task (Work log tab) or change the filters.</span></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {detail && (
        <CellPopover
          detail={detail}
          unit={options.unit}
          onClose={() => setDetail(null)}
          onOpenTask={(id) => { setDetail(null); openTaskById?.(id); }}
          onDelete={deleteEntry}
        />
      )}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
