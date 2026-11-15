import { useMemo, useState } from 'react';
import Header from '../../components/layout/Header';
import Sidebar from '../../components/layout/Sidebar';
import Icon from '../../components/common/Icon';
import Pagination from '../../components/common/Pagination';
import Toast from '../../components/common/Toast';
import { useAppShell } from '../../context/appShellContext';
import { api } from '../../services/api';
import MenuButton from '../SpaceBacklog/MenuButton';
import { ConfirmModal } from '../SpaceBacklog/SprintModals';
import './Dashboards.css';

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (number) => String(number).padStart(2, '0');
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
}

/** All dashboards the user can open: search by code / name, filter by status and publish, star. */
export default function DashboardsList({
  spaces = [],
  tasks = [],
  onNavigate = () => {},
  onCreateSpace = () => {},
  onOpenSpaceSettings = () => {},
  onDeleteSpace = () => {},
  onGlobalCreate = () => {},
  onOpenTask = () => {}
}) {
  const { dashboards, upsertDashboard, removeDashboard, reloadDashboards } = useAppShell();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState('all');
  const [visibility, setVisibility] = useState('all');
  const [starredOnly, setStarredOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [confirm, setConfirm] = useState(null);
  const [toast, setToast] = useState(null);

  const filtered = useMemo(() => {
    const codeNeedle = code.trim().toLowerCase();
    const nameNeedle = name.trim().toLowerCase();
    return dashboards
      .filter((item) => !codeNeedle || item.code.toLowerCase().includes(codeNeedle))
      .filter((item) => !nameNeedle || item.name.toLowerCase().includes(nameNeedle))
      .filter((item) => status === 'all' || item.status === status)
      .filter((item) => visibility === 'all' || item.visibility === visibility)
      .filter((item) => !starredOnly || item.starred)
      .sort((left, right) => (Number(right.starred) - Number(left.starred)) || left.name.localeCompare(right.name));
  }, [dashboards, code, name, status, visibility, starredOnly]);
  const hasFilters = Boolean(code || name || status !== 'all' || visibility !== 'all' || starredOnly);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const rows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const filterSetter = (setter) => (value) => { setter(value); setPage(1); };

  async function toggleStar(dashboard) {
    upsertDashboard({ ...dashboard, starred: !dashboard.starred });
    try {
      upsertDashboard(await api.starDashboard(dashboard.id, !dashboard.starred));
    } catch (error) {
      upsertDashboard(dashboard);
      setToast({ type: 'error', message: error.message });
    }
  }

  async function setDashboardStatus(dashboard, next) {
    try {
      upsertDashboard(await api.updateDashboard(dashboard.id, { status: next }));
      setToast({ type: 'success', message: `${dashboard.name} is now ${next}.` });
    } catch (error) {
      setToast({ type: 'error', message: error.message });
    }
  }

  function confirmDelete(dashboard) {
    setConfirm({
      title: `Delete ${dashboard.name}?`,
      message: 'The dashboard is deleted for everyone. Its widgets stay available in System settings.',
      onConfirm: async () => {
        try {
          await api.deleteDashboard(dashboard.id);
          removeDashboard(dashboard.id);
          setToast({ type: 'success', message: `${dashboard.name} deleted.` });
        } catch (error) {
          setToast({ type: 'error', message: error.message });
          reloadDashboards();
        }
      }
    });
  }

  return (
    <div className="app-shell">
      <Header spaces={spaces} tasks={tasks} onGlobalCreate={onGlobalCreate} onOpenTask={onOpenTask} />
      <Sidebar activeSection="Dashboard" spaces={spaces} onNavigate={onNavigate} onCreateSpace={onCreateSpace} onOpenSpaceSettings={onOpenSpaceSettings} onDeleteSpace={onDeleteSpace} />

      <main className="main-content dbx-main">
        <div className="dbx-heading">
          <h1>Dashboard <span className="dbx-total">( {dashboards.length} )</span></h1>
          <button type="button" className="dbx-button is-primary" onClick={() => onNavigate('dashboardBuilder')}>
            <Icon name="plus" size={15} /> New dashboard
          </button>
        </div>

        <div className="dbx-toolbar" role="search">
          <label className="dbx-input">
            <Icon name="search" size={14} />
            <input value={code} onChange={(event) => filterSetter(setCode)(event.target.value)} placeholder="Search code" aria-label="Search code" />
          </label>
          <label className="dbx-input">
            <Icon name="search" size={14} />
            <input value={name} onChange={(event) => filterSetter(setName)(event.target.value)} placeholder="Search name" aria-label="Search name" />
          </label>
          <label className="dbx-select">
            <span>Status</span>
            <select value={status} onChange={(event) => filterSetter(setStatus)(event.target.value)} aria-label="Status">
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <label className="dbx-select">
            <span>Publish</span>
            <select value={visibility} onChange={(event) => filterSetter(setVisibility)(event.target.value)} aria-label="Publish">
              <option value="all">All</option>
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select>
          </label>
          <button type="button" className={`dbx-chip ${starredOnly ? 'is-on' : ''}`} aria-pressed={starredOnly} onClick={() => filterSetter(setStarredOnly)(!starredOnly)}>
            <Icon name={starredOnly ? 'starFilled' : 'star'} size={14} /> Starred
          </button>
          {hasFilters && (
            <button type="button" className="dbx-clear" onClick={() => { setCode(''); setName(''); setStatus('all'); setVisibility('all'); setStarredOnly(false); setPage(1); }}>
              <Icon name="close" size={13} /> Clear
            </button>
          )}
        </div>

        <section className="dbx-card">
          <div className="dbx-scroll">
            <table className="dbx-table">
              <thead>
                <tr>
                  <th className="dbx-code">Code</th>
                  <th>Name</th>
                  <th>Publish</th>
                  <th>Status</th>
                  <th>Owner</th>
                  <th>Widgets</th>
                  <th>Updated</th>
                  <th className="dbx-actions"><span className="dbx-visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((dashboard) => (
                  <tr key={dashboard.id} className={dashboard.status === 'inactive' ? 'is-inactive' : ''}>
                    <td className="dbx-code"><span>{dashboard.code}</span></td>
                    <td>
                      <button type="button" className="dbx-name" onClick={() => onNavigate('dashboard', { id: dashboard.id })}>
                        <Icon name="chart" size={15} />
                        <span>{dashboard.name}</span>
                      </button>
                      {dashboard.description && <small className="dbx-desc">{dashboard.description}</small>}
                    </td>
                    <td><span className={`dbx-pill is-${dashboard.visibility}`}>{dashboard.visibility === 'public' ? 'Public' : 'Private'}</span></td>
                    <td><span className={`dbx-status is-${dashboard.status}`}>{dashboard.status === 'active' ? 'Active' : 'Inactive'}</span></td>
                    <td className="dbx-owner">{dashboard.owner?.name || '—'}</td>
                    <td className="dbx-num">{dashboard.widgetCount}</td>
                    <td className="dbx-date">{formatDate(dashboard.updatedAt)}</td>
                    <td className="dbx-actions">
                      <button
                        type="button"
                        className={`dbx-star ${dashboard.starred ? 'is-starred' : ''}`}
                        onClick={() => toggleStar(dashboard)}
                        aria-pressed={dashboard.starred}
                        aria-label={`${dashboard.starred ? 'Unstar' : 'Star'} ${dashboard.name}`}
                        title={dashboard.starred ? 'Remove from starred' : 'Star (pin to the sidebar)'}
                      >
                        <Icon name={dashboard.starred ? 'starFilled' : 'star'} size={16} />
                      </button>
                      <MenuButton
                        label={`Actions for ${dashboard.name}`}
                        icon="moreVertical"
                        items={[
                          { label: 'Open', onSelect: () => onNavigate('dashboard', { id: dashboard.id }) },
                          dashboard.canEdit ? { label: 'Edit layout', onSelect: () => onNavigate('dashboardBuilder', { id: dashboard.id }) } : null,
                          dashboard.canEdit ? (dashboard.status === 'active'
                            ? { label: 'Deactivate', onSelect: () => setDashboardStatus(dashboard, 'inactive') }
                            : { label: 'Activate', onSelect: () => setDashboardStatus(dashboard, 'active') }) : null,
                          dashboard.canEdit ? { label: 'Delete', danger: true, onSelect: () => confirmDelete(dashboard) } : null
                        ]}
                      />
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={8} className="dbx-empty">
                      <Icon name="dashboard" size={28} />
                      <strong>{dashboards.length ? 'No dashboards match your filters' : 'No dashboards yet'}</strong>
                      <span>{dashboards.length ? 'Try another code, name or status.' : 'Create a dashboard and arrange the SQL widgets you need.'}</span>
                      {!dashboards.length && <button type="button" className="dbx-button is-primary" onClick={() => onNavigate('dashboardBuilder')}><Icon name="plus" size={14} /> New dashboard</button>}
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
            label="dashboards"
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          />
        </section>
      </main>

      {confirm && <ConfirmModal title={confirm.title} message={confirm.message} onClose={() => setConfirm(null)} onConfirm={() => { confirm.onConfirm(); setConfirm(null); }} />}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
