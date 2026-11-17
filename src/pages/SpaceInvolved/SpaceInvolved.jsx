import { useMemo, useState } from 'react';
import Header from '../../components/layout/Header';
import Sidebar from '../../components/layout/Sidebar';
import Icon from '../../components/common/Icon';
import PersonAvatar from '../../components/common/PersonAvatar';
import Pagination from '../../components/common/Pagination';
import Toast from '../../components/common/Toast';
import { useAppShell } from '../../context/appShellContext';
import { MultiFilter } from '../SpacesList/IssueFilters';
import './SpaceInvolved.css';

const MAX_SAVED_SPACES = 5;
const NO_LEAD = 'No project lead';

/** Project dates are stored as dd-mm-yyyy (or ISO); shown as dd/mm/yyyy. */
function displayDate(value) {
  const text = String(value || '').trim();
  let match = text.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (match) return `${match[1]}/${match[2]}/${match[3]}`;
  match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  return '';
}

function sortableDate(value) {
  const shown = displayDate(value);
  if (!shown) return '';
  const [day, month, year] = shown.split('/');
  return `${year}${month}${day}`;
}

function SortHeader({ field, sort, onSort, children }) {
  const active = sort.field === field;
  return (
    <button type="button" className={`si-sort ${active ? 'is-active' : ''}`} onClick={() => onSort(field)} aria-label={`Sort by ${children}`}>
      <span>{children}</span>
      <svg className="si-sort-icon" width="8" height="12" viewBox="0 0 8 12" aria-hidden="true">
        <path d="M4 1 7 4.5H1Z" className={active && sort.direction === 'asc' ? 'is-on' : ''} />
        <path d="M4 11 1 7.5h6Z" className={active && sort.direction === 'desc' ? 'is-on' : ''} />
      </svg>
    </button>
  );
}

/**
 * Space Involved: the projects the signed-in user owns or is a member of. Starring a
 * project saves it to the Spaces section of the sidebar (at most five).
 */
export default function SpaceInvolved({
  spaces = [],
  tasks = [],
  onNavigate = () => {},
  onCreateSpace = () => {},
  onOpenSpaceSettings = () => {},
  onDeleteSpace = () => {},
  onGlobalCreate = () => {},
  onOpenTask = () => {},
  onPinSpace = async () => ''
}) {
  const { isAdmin } = useAppShell();
  const [query, setQuery] = useState('');
  const [leads, setLeads] = useState([]);
  const [scope, setScope] = useState('involved'); // involved | all (administrators)
  const [sort, setSort] = useState({ field: 'name', direction: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState(null);

  const inScope = useMemo(() => spaces.filter((space) => scope === 'all' || space.involved), [spaces, scope]);
  const savedCount = spaces.filter((space) => space.pinned).length;
  const full = savedCount >= MAX_SAVED_SPACES;
  const leadOptions = useMemo(() => [...new Set(inScope.map((space) => space.lead?.name || NO_LEAD))].sort((a, b) => a.localeCompare(b)), [inScope]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = inScope
      .filter((space) => !needle || `${space.code} ${space.name}`.toLowerCase().includes(needle))
      .filter((space) => !leads.length || leads.includes(space.lead?.name || NO_LEAD));
    const value = (space) => {
      if (sort.field === 'lead') return (space.lead?.name || '').toLowerCase();
      if (sort.field === 'startDate' || sort.field === 'endDate') return sortableDate(space[sort.field]);
      return `${space.name}`.toLowerCase();
    };
    return [...rows].sort((left, right) => {
      const a = value(left);
      const b = value(right);
      if (a === b) return 0;
      if (!a) return 1; // empty values last
      if (!b) return -1;
      return (a < b ? -1 : 1) * (sort.direction === 'asc' ? 1 : -1);
    });
  }, [inScope, query, leads, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const rows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const hasFilters = Boolean(query || leads.length);

  function toggleSort(field) {
    setSort((current) => ({ field, direction: current.field === field && current.direction === 'asc' ? 'desc' : 'asc' }));
  }

  async function togglePin(space) {
    if (!space.pinned && full) {
      setToast({ type: 'error', message: `You can save up to ${MAX_SAVED_SPACES} projects. Unstar a saved project first.` });
      return;
    }
    setBusyId(space.id);
    const message = await onPinSpace(space.id, !space.pinned);
    setBusyId(null);
    if (message) setToast({ type: 'error', message });
    else setToast({ type: 'success', message: space.pinned ? `${space.name} removed from Spaces.` : `${space.name} saved to Spaces.` });
  }

  return (
    <div className="app-shell">
      <Header spaces={spaces} tasks={tasks} onGlobalCreate={onGlobalCreate} onOpenTask={onOpenTask} />
      <Sidebar activeSection="Space Involved" spaces={spaces} onNavigate={onNavigate} onCreateSpace={onCreateSpace} onOpenSpaceSettings={onOpenSpaceSettings} onDeleteSpace={onDeleteSpace} />

      <main className="main-content si-main">
        <div className="si-heading">
          <h1>Projects <span className="si-total">( {inScope.length} )</span></h1>
          <button type="button" className="si-create" onClick={onCreateSpace}><Icon name="plus" size={15} /> Create project</button>
        </div>

        <div className="si-toolbar" role="search">
          <label className="si-search">
            <Icon name="search" size={14} />
            <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search" aria-label="Search projects" />
            {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><Icon name="close" size={12} /></button>}
          </label>
          <MultiFilter label="Project lead" options={leadOptions} selected={leads} onChange={(next) => { setLeads(next); setPage(1); }} width={230} />
          {isAdmin && (
            <div className="si-scope" role="group" aria-label="Which projects">
              <button type="button" aria-pressed={scope === 'involved'} onClick={() => { setScope('involved'); setPage(1); }}>Involved</button>
              <button type="button" aria-pressed={scope === 'all'} onClick={() => { setScope('all'); setPage(1); }}>All projects</button>
            </div>
          )}
          {hasFilters && <button type="button" className="si-clear" onClick={() => { setQuery(''); setLeads([]); setPage(1); }}><Icon name="close" size={12} /> Clear filters</button>}
        </div>

        <div className="si-note">
          <p>Save up to {MAX_SAVED_SPACES} projects to Spaces. Unstar a saved project before adding another when full.</p>
          <span className={`si-saved ${full ? 'is-full' : ''}`} aria-live="polite">
            <Icon name="starFilled" size={13} /> {savedCount} saved<span>/{MAX_SAVED_SPACES}</span>
          </span>
        </div>

        <section className="si-card">
          <div className="si-scroll">
            <table className="si-table">
              <colgroup>
                <col />
                <col className="si-col-lead" />
                <col className="si-col-date" />
                <col className="si-col-date" />
                <col className="si-col-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th><SortHeader field="name" sort={sort} onSort={toggleSort}>[Code] Name</SortHeader></th>
                  <th><SortHeader field="lead" sort={sort} onSort={toggleSort}>Project lead</SortHeader></th>
                  <th><SortHeader field="startDate" sort={sort} onSort={toggleSort}>Start Date</SortHeader></th>
                  <th><SortHeader field="endDate" sort={sort} onSort={toggleSort}>End Date</SortHeader></th>
                  <th className="si-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((space) => (
                  <tr key={space.id} className={space.pinned ? 'is-pinned' : ''}>
                    <td>
                      <div className="si-name-cell">
                      <button type="button" className="si-project" onClick={() => onNavigate('space', { id: space.id, name: space.name })}>
                        {space.icon ? <img className="si-avatar" src={space.icon} alt="" /> : <span className="si-avatar" aria-hidden="true">{(space.name || space.code || 'P').charAt(0).toUpperCase()}</span>}
                        <span className="si-project-text"><span className="si-code">[{space.code}]</span> {space.name}</span>
                      </button>
                      {!space.involved && <span className="si-badge" title="You are not a member (visible as administrator)">Admin access</span>}
                      </div>
                    </td>
                    <td>{space.lead?.name ? <span className="si-lead"><PersonAvatar person={space.lead} className="si-lead-avatar" /><span className="si-lead-name">{space.lead.name}</span></span> : <span className="si-muted">—</span>}</td>
                    <td>{displayDate(space.startDate) || <span className="si-muted">—</span>}</td>
                    <td>{displayDate(space.endDate) || <span className="si-muted">—</span>}</td>
                    <td className="si-actions">
                      <button
                        type="button"
                        className={`si-star ${space.pinned ? 'is-pinned' : ''}`}
                        onClick={() => togglePin(space)}
                        disabled={busyId === space.id || (!space.pinned && full)}
                        aria-pressed={space.pinned}
                        aria-label={`${space.pinned ? 'Unstar' : 'Star'} ${space.name}`}
                        title={space.pinned ? 'Remove from Spaces' : full ? `Spaces is full (${MAX_SAVED_SPACES}). Unstar a project first.` : 'Save to Spaces'}
                      >
                        <Icon name={space.pinned ? 'starFilled' : 'star'} size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={5} className="si-empty">
                      <Icon name="spaces" size={28} />
                      <strong>{inScope.length ? 'No projects match your filters' : 'You are not in any project yet'}</strong>
                      <span>{inScope.length ? 'Try another name or project lead.' : 'Create a project, or ask a project admin to add you.'}</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={currentPage}
            pageSize={pageSize}
            total={filtered.length}
            pageSizes={[10, 20, 50]}
            label="projects"
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          />
        </section>
      </main>
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
