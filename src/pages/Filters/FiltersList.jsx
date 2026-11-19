import { useEffect, useMemo, useState } from 'react';
import Header from '../../components/layout/Header';
import Sidebar from '../../components/layout/Sidebar';
import Icon from '../../components/common/Icon';
import Toast from '../../components/common/Toast';
import PersonAvatar from '../../components/common/PersonAvatar';
import { api } from '../../services/api';
import { searchText } from '../../services/searchText';
import { ConfirmModal } from '../SpaceBacklog/SprintModals';
import SaveFilterModal from './components/SaveFilterModal';
import { classifyTokens } from '../../../shared/tql';
import './Filters.css';
// The table and modal styles of the List view are shared.
import '../SpacesList/SpacesList.css';
import '../MyTasks/components/TaskTable.css';
import '../../components/common/Pagination.css';

let openCount = 0;

const TABS = [
  { id: 'all', label: 'All filters' },
  { id: 'mine', label: 'My filters' },
  { id: 'system', label: 'Default filters' },
  { id: 'shared', label: 'Shared with me' }
];

/** A query with the TQL colours (read-only). */
export function TqlText({ text }) {
  if (!text) return <span className="fl-tql-empty">All work items</span>;
  const tokens = classifyTokens(text);
  const parts = [];
  let at = 0;
  tokens.forEach((token, index) => {
    if (token.start > at) parts.push(text.slice(at, token.start));
    parts.push(<span key={index} className={`tql-${token.role}`}>{text.slice(token.start, token.end)}</span>);
    at = token.end;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

/** Filters > View all filters: saved filters of the user, the defaults and public filters. */
export default function FiltersList({ spaces = [], allTasks = [], onNavigate, onCreateSpace, onOpenSpaceSettings, onDeleteSpace, onGlobalCreate, onOpenTask }) {
  const [filters, setFilters] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [toast, setToast] = useState(null);

  const load = () => api.getSavedFilters()
    .then((rows) => { setFilters(rows); setError(''); })
    .catch((loadError) => setError(loadError.message || 'Could not load the filters.'));
  useEffect(() => { load(); }, []);

  const counts = useMemo(() => {
    const list = filters || [];
    return { all: list.length, mine: list.filter((f) => f.isMine).length, system: list.filter((f) => f.isSystem).length, shared: list.filter((f) => !f.isMine && !f.isSystem).length };
  }, [filters]);

  const rows = useMemo(() => {
    const needle = searchText(query).trim();
    return (filters || []).filter((filter) => (
      tab === 'all' || (tab === 'mine' && filter.isMine) || (tab === 'system' && filter.isSystem) || (tab === 'shared' && !filter.isMine && !filter.isSystem)
    ) && (!needle || searchText(`${filter.name} ${filter.description} ${filter.tql} ${filter.owner?.fullName || ''}`).includes(needle)));
  }, [filters, tab, query]);

  const open = (filter) => onNavigate('filterSearch', { filterId: filter.id, openRequestId: `${filter.id}-${++openCount}` });

  async function copy(filter) {
    try {
      const created = await api.copySavedFilter(filter.id);
      setFilters((current) => [...(current || []), created]);
      setToast({ type: 'success', message: `"${created.name}" created in My filters.` });
    } catch (copyError) { setToast({ type: 'error', message: copyError.message }); }
  }

  async function saveEdit(values) {
    try {
      const saved = await api.updateSavedFilter(editing.id, values);
      setFilters((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      setEditing(null);
      setToast({ type: 'success', message: `"${saved.name}" updated.` });
      return '';
    } catch (saveError) { return saveError.message; }
  }

  async function remove() {
    try {
      await api.deleteSavedFilter(deleting.id);
      setFilters((current) => current.filter((item) => item.id !== deleting.id));
      setToast({ type: 'success', message: `"${deleting.name}" deleted.` });
    } catch (deleteError) { setToast({ type: 'error', message: deleteError.message }); }
    setDeleting(null);
  }

  return (
    <div className="app-shell">
      <Header spaces={spaces} tasks={allTasks} onGlobalCreate={onGlobalCreate} onOpenTask={onOpenTask} />
      <Sidebar activeSection="Filters" activeFilterView="all" spaces={spaces} onCreateSpace={onCreateSpace} onNavigate={onNavigate} onOpenSpaceSettings={onOpenSpaceSettings} onDeleteSpace={onDeleteSpace} />
      <main className="main-content fs-page">
        <nav className="breadcrumb fs-breadcrumb" aria-label="Breadcrumb"><span>Filters</span><span>/</span><strong>View all filters</strong></nav>
        <div className="fs-head">
          <div className="fs-title"><h1>Filters</h1></div>
          <div className="fs-head-actions">
            <button type="button" className="slv-btn primary fl-create" onClick={() => onNavigate('filterSearch', { tql: '', openRequestId: `new-${++openCount}` })}><Icon name="plus" size={14} /> Create filter</button>
          </div>
        </div>

        <div className="fl-toolbar">
          <div className="fl-tabs" role="tablist" aria-label="Which filters">
            {TABS.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'is-active' : ''} onClick={() => setTab(item.id)}>
                {item.label}<span>{counts[item.id]}</span>
              </button>
            ))}
          </div>
          <label className="fs-search fl-search">
            <Icon name="search" size={14} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search filters" aria-label="Search filters" />
          </label>
        </div>

        <section className="table-card fl-card">
          <div className="table-scroll">
            <table className="task-table fl-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Query (TQL)</th>
                  <th>Owner</th>
                  <th>Access</th>
                  <th className="fl-actions-col" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((filter) => (
                  <tr key={filter.id}>
                    <td>
                      <button type="button" className="fl-name" onClick={() => open(filter)} title={`Open ${filter.name}`}>
                        <Icon name={filter.isSystem ? 'starFilled' : 'filter'} size={14} />
                        <span>{filter.name}</span>
                      </button>
                    </td>
                    <td className="fl-desc" title={filter.description}>{filter.description || <span className="fl-muted">—</span>}</td>
                    <td><code className="fl-tql" title={filter.tql}><TqlText text={filter.tql} /></code></td>
                    <td>
                      {filter.owner
                        ? <span className="fl-owner"><PersonAvatar person={filter.owner} className="fl-owner-avatar" /><span>{filter.owner.fullName}{filter.isMine && <small> (You)</small>}</span></span>
                        : <span className="fl-owner"><span className="fl-owner-avatar fl-system-avatar" aria-hidden="true">T</span><span>TASKFLOW</span></span>}
                    </td>
                    <td><span className={`fl-access-badge is-${filter.isSystem ? 'system' : filter.visibility}`}><Icon name={filter.visibility === 'public' || filter.isSystem ? 'users' : 'lock'} size={11} />{filter.isSystem ? 'Default' : filter.visibility === 'public' ? 'Public' : 'Private'}</span></td>
                    <td className="fl-actions">
                      <button type="button" onClick={() => open(filter)} aria-label={`Open ${filter.name}`} title="Open"><Icon name="search" size={14} /></button>
                      <button type="button" onClick={() => setEditing(filter)} disabled={!filter.permissions.edit} aria-label={`Edit ${filter.name}`} title={filter.permissions.edit ? 'Rename / edit' : filter.isSystem ? 'Default filters cannot be changed' : 'Only the owner can edit'}><Icon name="edit" size={14} /></button>
                      <button type="button" onClick={() => copy(filter)} aria-label={`Copy ${filter.name}`} title="Copy to My filters"><Icon name="copy" size={14} /></button>
                      <button type="button" className="danger" onClick={() => setDeleting(filter)} disabled={!filter.permissions.delete} aria-label={`Delete ${filter.name}`} title={filter.permissions.delete ? 'Delete' : 'You cannot delete this filter'}><Icon name="trash" size={14} /></button>
                    </td>
                  </tr>
                ))}
                {filters && !rows.length && (
                  <tr><td colSpan="6" className="empty-state">
                    <Icon name="filter" size={28} />
                    <strong>{query ? 'No filters match your search' : tab === 'mine' ? 'You have not saved any filters yet' : 'No filters here'}</strong>
                    <span>{tab === 'mine' && !query ? 'Search work items, then click "Save filter".' : 'Try another tab or search.'}</span>
                  </td></tr>
                )}
                {!filters && <tr><td colSpan="6" className="empty-state">{error || 'Loading filters…'}</td></tr>}
              </tbody>
            </table>
          </div>
          <footer className="pg-foot fl-foot"><span>{rows.length}/{counts.all} filters</span><button type="button" onClick={load} aria-label="Refresh filters" title="Refresh"><Icon name="refresh" size={13} /></button></footer>
        </section>
      </main>

      {editing && (
        <SaveFilterModal title="Edit filter" submitLabel="Save" initial={editing} tql={editing.tql} showQuery onClose={() => setEditing(null)} onSubmit={saveEdit} />
      )}
      {deleting && (
        <ConfirmModal title={`Delete "${deleting.name}"?`} message={deleting.visibility === 'public' ? 'Other people using this public filter will lose it too. This cannot be undone.' : 'This cannot be undone.'} onClose={() => setDeleting(null)} onConfirm={remove} />
      )}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
