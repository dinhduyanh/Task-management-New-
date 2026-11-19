import { useEffect, useState } from 'react';
import Header from '../../components/layout/Header';
import Sidebar from '../../components/layout/Sidebar';
import Icon from '../../components/common/Icon';
import Toast from '../../components/common/Toast';
import { useAppShell } from '../../context/appShellContext';
import { api } from '../../services/api';
import WidgetCard from './WidgetCard';
import './Dashboards.css';

/** One dashboard: its widgets on a 3-column grid. Opening it records the visit. */
export default function DashboardView({
  dashboardId,
  spaces = [],
  tasks = [],
  onNavigate = () => {},
  onCreateSpace = () => {},
  onOpenSpaceSettings = () => {},
  onDeleteSpace = () => {},
  onGlobalCreate = () => {},
  onOpenTask = () => {},
  onBack = () => {}
}) {
  const { upsertDashboard } = useAppShell();
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    let active = true;
    api.getDashboard(dashboardId)
      .then((result) => {
        if (!active) return;
        setDashboard(result);
        upsertDashboard(result);
      })
      .catch((loadError) => { if (active) setError(loadError.status === 404 ? 'not-found' : loadError.message); });
    return () => { active = false; };
    // upsertDashboard changes every render of App; the dashboard only loads per id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardId]);

  async function toggleStar() {
    const next = !dashboard.starred;
    setDashboard((current) => ({ ...current, starred: next }));
    try {
      upsertDashboard(await api.starDashboard(dashboard.id, next));
    } catch (starError) {
      setDashboard((current) => ({ ...current, starred: !next }));
      setToast({ type: 'error', message: starError.message });
    }
  }

  const shell = (content) => (
    <div className="app-shell">
      <Header spaces={spaces} tasks={tasks} onGlobalCreate={onGlobalCreate} onOpenTask={onOpenTask} />
      <Sidebar activeSection="Dashboard" activeDashboardId={dashboardId} spaces={spaces} onNavigate={onNavigate} onCreateSpace={onCreateSpace} onOpenSpaceSettings={onOpenSpaceSettings} onDeleteSpace={onDeleteSpace} />
      <main className="main-content dbx-main">{content}</main>
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );

  if (error) {
    return shell(
      <div className="dbx-state" role="alert">
        <Icon name="dashboard" size={30} />
        <strong>{error === 'not-found' ? 'Dashboard not found' : 'The dashboard could not be loaded'}</strong>
        <span>{error === 'not-found' ? 'It was deleted, made private or deactivated by its owner.' : error}</span>
        <button type="button" className="dbx-button" onClick={() => onNavigate('dashboards')}>All dashboards</button>
      </div>
    );
  }
  if (!dashboard) return shell(<div className="dbx-state">Loading dashboard…</div>);

  return shell(
    <>
      <div className="dbx-heading">
        <div className="dbx-title">
          <button type="button" className="dbx-icon-button" onClick={onBack} aria-label="Back" title="Back"><Icon name="arrowLeft" size={17} /></button>
          <h1>{dashboard.name}</h1>
          <button
            type="button"
            className={`dbx-star ${dashboard.starred ? 'is-starred' : ''}`}
            onClick={toggleStar}
            aria-pressed={dashboard.starred}
            aria-label={dashboard.starred ? 'Unstar dashboard' : 'Star dashboard'}
            title={dashboard.starred ? 'Remove from starred' : 'Star (pin to the sidebar)'}
          >
            <Icon name={dashboard.starred ? 'starFilled' : 'star'} size={18} />
          </button>
          <span className="dbx-code-pill">{dashboard.code}</span>
          <span className={`dbx-pill is-${dashboard.visibility}`}>{dashboard.visibility === 'public' ? 'Public' : 'Private'}</span>
          {dashboard.status === 'inactive' && <span className="dbx-status is-inactive">Inactive</span>}
        </div>
        <div className="dbx-head-actions">
          <button type="button" className="dbx-button" onClick={() => setRefreshKey((value) => value + 1)}><Icon name="refresh" size={14} /> Refresh</button>
          {dashboard.canEdit && (
            <button type="button" className="dbx-button is-primary" onClick={() => onNavigate('dashboardBuilder', { id: dashboard.id })}>
              <Icon name="edit" size={14} /> Edit in builder
            </button>
          )}
        </div>
      </div>
      {dashboard.description && <p className="dbx-description">{dashboard.description}</p>}

      {dashboard.layout.length ? (
        <div className="db-grid dbx-grid">
          {dashboard.layout.map((slot, index) => (
            <WidgetCard key={`${slot.widgetId}-${index}`} widget={slot.widget} available={slot.available} size={slot.size} refreshKey={refreshKey} />
          ))}
        </div>
      ) : (
        <div className="dbx-state">
          <Icon name="layout" size={30} />
          <strong>This dashboard has no widgets yet</strong>
          <span>{dashboard.canEdit ? 'Open the builder and drag widgets onto the dashboard.' : 'Its owner has not added widgets yet.'}</span>
          {dashboard.canEdit && <button type="button" className="dbx-button is-primary" onClick={() => onNavigate('dashboardBuilder', { id: dashboard.id })}><Icon name="edit" size={14} /> Edit in builder</button>}
        </div>
      )}
    </>
  );
}
