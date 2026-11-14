import { useEffect, useMemo, useState } from 'react';
import Header from '../../components/layout/Header';
import Sidebar from '../../components/layout/Sidebar';
import Icon from '../../components/common/Icon';
import Toast from '../../components/common/Toast';
import UserAvatar from '../../components/common/UserAvatar';
import Pagination from '../../components/common/Pagination';
import { api } from '../../services/api';
import ProjectHeader from '../SpacesList/ProjectHeader';
import { MultiFilter } from '../SpacesList/IssueFilters';
import MenuButton from '../SpaceBacklog/MenuButton';
import { ConfirmModal } from '../SpaceBacklog/SprintModals';
import TeamFormModal from './TeamFormModal';
import './SpaceTeams.css';

const PAGE_SIZES = [10, 20, 50];
const STATUS_LABELS = { active: 'Active', inactive: 'Inactive' };

function formatDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  const pad = (number) => String(number).padStart(2, '0');
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
}

const personName = (person) => person?.fullName || person?.name || person?.username || '';
const uniqueSorted = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));

function Person({ person }) {
  if (!person) return <span className="tt-muted">—</span>;
  return (
    <span className="tt-person">
      <UserAvatar user={{ fullName: personName(person), avatarUrl: person.avatarUrl }} size={22} />
      <span>{personName(person)}</span>
    </span>
  );
}

export default function SpaceTeams({
  space = {},
  tasks = [],
  spaces = [],
  onNavigate = () => {},
  onCreateSpace = () => {},
  onOpenSpaceSettings = () => {},
  onDeleteSpace = () => {},
  onRefreshData = () => {},
  onGlobalCreate = () => {},
  onOpenTask = () => {}
}) {
  const [teams, setTeams] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [users, setUsers] = useState([]);
  const [usersError, setUsersError] = useState('');
  const [search, setSearch] = useState('');
  const [statuses, setStatuses] = useState([]);
  const [leads, setLeads] = useState([]);
  const [creators, setCreators] = useState([]);
  const [memberFilter, setMemberFilter] = useState([]);
  const [units, setUnits] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [form, setForm] = useState(null); // { team } (team null = create)
  const [confirm, setConfirm] = useState(null);
  const [toast, setToast] = useState(null);

  // Teams belong to this project only; App remounts the page per Space (key={space.id}).
  useEffect(() => {
    if (!space.id) return undefined;
    let active = true;
    api.getTeams(space.id)
      .then((rows) => { if (active) { setTeams(rows); setLoadError(''); } })
      .catch((error) => { if (active) setLoadError(error.message || 'Unable to load teams.'); });
    return () => { active = false; };
  }, [space.id, reloadKey]);

  useEffect(() => {
    let active = true;
    api.getUsers()
      .then((rows) => { if (active) setUsers(rows); })
      .catch((error) => { if (active) setUsersError(error.status === 401 ? 'Sign in again to load the user directory.' : error.message); });
    return () => { active = false; };
  }, []);

  const list = useMemo(() => teams || [], [teams]);
  const options = useMemo(() => ({
    leads: uniqueSorted(list.map((team) => personName(team.lead))),
    creators: uniqueSorted(list.map((team) => personName(team.creator))),
    members: uniqueSorted(list.flatMap((team) => team.members.map(personName))),
    units: uniqueSorted(list.map((team) => team.unit))
  }), [list]);

  const filtered = useMemo(() => {
    const text = search.trim().toLowerCase();
    return list.filter((team) => {
      if (text && ![team.code, team.name, team.description].some((value) => String(value || '').toLowerCase().includes(text))) return false;
      if (statuses.length && !statuses.includes(STATUS_LABELS[team.status])) return false;
      if (leads.length && !leads.includes(personName(team.lead))) return false;
      if (creators.length && !creators.includes(personName(team.creator))) return false;
      if (memberFilter.length && !team.members.some((member) => memberFilter.includes(personName(member)))) return false;
      if (units.length && !units.includes(team.unit)) return false;
      return true;
    });
  }, [list, search, statuses, leads, creators, memberFilter, units]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const hasFilters = Boolean(search || statuses.length || leads.length || creators.length || memberFilter.length || units.length);
  const selectedOnPage = pageRows.filter((team) => selectedIds.has(team.id));
  const allOnPageSelected = pageRows.length > 0 && selectedOnPage.length === pageRows.length;
  const selectedTeams = list.filter((team) => selectedIds.has(team.id));

  // Any filter change goes back to page 1.
  function filterSetter(setter) {
    return (value) => { setter(value); setPage(1); };
  }

  function clearFilters() {
    setSearch(''); setStatuses([]); setLeads([]); setCreators([]); setMemberFilter([]); setUnits([]); setPage(1);
  }

  function replaceTeam(saved) {
    setTeams((current) => {
      const exists = (current || []).some((team) => team.id === saved.id);
      return exists ? current.map((team) => team.id === saved.id ? saved : team) : [saved, ...(current || [])];
    });
  }

  async function saveTeam(values) {
    try {
      const saved = form.team ? await api.updateTeam(form.team.id, values) : await api.createTeam(space.id, values);
      replaceTeam(saved);
      onRefreshData(); // so work item forms see the new/renamed team
      setToast({ type: 'success', message: `Team ${saved.code} ${form.team ? 'updated' : 'created'}.` });
      return '';
    } catch (error) {
      return error.message;
    }
  }

  async function setStatus(team, status) {
    try {
      replaceTeam(await api.updateTeam(team.id, { status }));
      onRefreshData();
      setToast({ type: 'success', message: `Team ${team.code} is now ${STATUS_LABELS[status].toLowerCase()}.` });
    } catch (error) {
      setToast({ type: 'error', message: error.message });
    }
  }

  function confirmDelete(targets) {
    const label = targets.length === 1 ? `team ${targets[0].code || targets[0].name}` : `${targets.length} teams`;
    const issues = targets.reduce((sum, team) => sum + team.issueCount, 0);
    setConfirm({
      title: `Delete ${label}?`,
      message: `${label[0].toUpperCase()}${label.slice(1)} will be deleted.${issues ? ` ${issues} work item${issues === 1 ? '' : 's'} will no longer have a team; the work items are kept.` : ''}`,
      onConfirm: async () => {
        const failures = [];
        for (const team of targets) {
          try { await api.deleteTeam(team.id); } catch (error) { failures.push(error.message); }
        }
        setSelectedIds(new Set());
        setReloadKey((value) => value + 1);
        onRefreshData();
        setToast(failures.length
          ? { type: 'error', message: failures[0] }
          : { type: 'success', message: `${label[0].toUpperCase()}${label.slice(1)} deleted.` });
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

  return (
    <div className="app-shell spaces-list-shell">
      <Header spaces={spaces} tasks={tasks} onGlobalCreate={onGlobalCreate} onOpenTask={onOpenTask} />
      <Sidebar activeSection="Spaces" activeSpaceId={space.id} spaces={spaces} onCreateSpace={onCreateSpace} onNavigate={onNavigate} onOpenSpaceSettings={onOpenSpaceSettings} onDeleteSpace={onDeleteSpace} />

      <main className="spaces-list-main tt-main">
        <ProjectHeader space={space} title={`${space.code || space.name || 'Space'} teams`} activeTab="Teams" onNavigate={onNavigate} />

        <section className="slv-toolbar tt-toolbar" aria-label="Team filters">
          <div className="slv-search">
            <Icon name="search" size={15} />
            <input placeholder="Search team" value={search} onChange={(event) => filterSetter(setSearch)(event.target.value)} aria-label="Search teams by code, name or description" />
          </div>
          <MultiFilter label="Status" options={Object.values(STATUS_LABELS)} selected={statuses} onChange={filterSetter(setStatuses)} />
          <MultiFilter label="Team lead" options={options.leads} selected={leads} onChange={filterSetter(setLeads)} width={220} />
          <MultiFilter label="Creator" options={options.creators} selected={creators} onChange={filterSetter(setCreators)} width={220} />
          <MultiFilter label="Member" options={options.members} selected={memberFilter} onChange={filterSetter(setMemberFilter)} width={220} />
          <MultiFilter label="Unit" options={options.units} selected={units} onChange={filterSetter(setUnits)} width={220} />
          {hasFilters && (
            <button type="button" className="it-clear-filters" onClick={clearFilters}><Icon name="close" size={13} /> Clear filters</button>
          )}
          <button type="button" className="tt-create" onClick={() => setForm({ team: null })}>
            <Icon name="plus" size={15} /> Create Team
          </button>
        </section>

        {selectedTeams.length > 0 && (
          <div className="tt-bulk" role="region" aria-label="Selected teams">
            <strong>{selectedTeams.length} selected</strong>
            <button type="button" className="danger" onClick={() => confirmDelete(selectedTeams)}><Icon name="trash" size={14} /> Delete</button>
            <button type="button" onClick={() => setSelectedIds(new Set())}>Clear selection</button>
          </div>
        )}

        <section className="tt-card">
          <div className="tt-scroll">
            <table className="tt-table">
              <thead>
                <tr>
                  <th className="tt-check">
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      disabled={!pageRows.length}
                      onChange={() => setSelectedIds((current) => {
                        const next = new Set(current);
                        pageRows.forEach((team) => (allOnPageSelected ? next.delete(team.id) : next.add(team.id)));
                        return next;
                      })}
                      aria-label="Select all teams on this page"
                    />
                  </th>
                  <th>[Code] Name</th>
                  <th>Team lead</th>
                  <th className="tt-num">Members</th>
                  <th className="tt-num">Issues</th>
                  <th>Status</th>
                  <th>Creator</th>
                  <th>Create date</th>
                  <th className="tt-actions"><span className="tt-visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((team) => (
                  <tr key={team.id} className={selectedIds.has(team.id) ? 'is-selected' : ''}>
                    <td className="tt-check">
                      <input type="checkbox" checked={selectedIds.has(team.id)} onChange={() => toggleSelected(team.id)} aria-label={`Select team ${team.code || team.name}`} />
                    </td>
                    <td>
                      <button type="button" className="tt-name" onClick={() => setForm({ team })}>
                        <strong>{team.code ? `[${team.code}] ` : ''}{team.name}</strong>
                        {(team.unit || team.description) && <small>{[team.unit, team.description].filter(Boolean).join(' · ')}</small>}
                      </button>
                    </td>
                    <td><Person person={team.lead} /></td>
                    <td className="tt-num" title={team.members.map(personName).join(', ')}>{team.memberCount}</td>
                    <td className="tt-num">
                      <span className="tt-issues" title={`${team.issueCount} work item${team.issueCount === 1 ? '' : 's'} assigned to this team`}>
                        <Icon name="tasks" size={14} /> {team.issueCount}
                      </span>
                    </td>
                    <td>
                      <select
                        className={`tt-status is-${team.status}`}
                        value={team.status}
                        onChange={(event) => setStatus(team, event.target.value)}
                        aria-label={`Status of team ${team.code || team.name}`}
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </td>
                    <td><Person person={team.creator} /></td>
                    <td className="tt-date">{formatDate(team.createdAt)}</td>
                    <td className="tt-actions">
                      <MenuButton
                        label={`Actions for team ${team.code || team.name}`}
                        icon="moreVertical"
                        items={[
                          { label: 'Edit team', onSelect: () => setForm({ team }) },
                          team.status === 'active'
                            ? { label: 'Deactivate', onSelect: () => setStatus(team, 'inactive') }
                            : { label: 'Activate', onSelect: () => setStatus(team, 'active') },
                          { label: 'Delete', danger: true, onSelect: () => confirmDelete([team]) }
                        ]}
                      />
                    </td>
                  </tr>
                ))}
                {teams !== null && !pageRows.length && (
                  <tr>
                    <td colSpan={9} className="tt-empty">
                      <Icon name="users" size={28} />
                      <strong>{list.length ? 'No teams match your filters' : 'No teams in this project yet'}</strong>
                      <span>{list.length ? 'Try changing the search or filters.' : 'Teams created here are only available in this project.'}</span>
                    </td>
                  </tr>
                )}
                {teams === null && (
                  <tr><td colSpan={9} className="tt-empty">{loadError ? <>{loadError} <button type="button" className="tt-link" onClick={() => setReloadKey((value) => value + 1)}>Retry</button></> : 'Loading teams…'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={currentPage}
            pageSize={pageSize}
            total={filtered.length}
            pageSizes={PAGE_SIZES}
            label="Teams"
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          />
        </section>
      </main>

      <Toast toast={toast} onClose={() => setToast(null)} />

      {form && (
        <TeamFormModal
          team={form.team}
          users={users}
          usersError={usersError}
          unitOptions={options.units}
          onClose={() => setForm(null)}
          onSubmit={saveTeam}
        />
      )}

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          onClose={() => setConfirm(null)}
          onConfirm={() => { confirm.onConfirm(); setConfirm(null); }}
        />
      )}
    </div>
  );
}
