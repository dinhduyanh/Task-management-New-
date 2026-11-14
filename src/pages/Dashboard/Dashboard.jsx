import { useCallback, useEffect, useState } from 'react';
import Header from '../../components/layout/Header';
import Sidebar from '../../components/layout/Sidebar';
import Icon from '../../components/common/Icon';
import WidgetView from '../../components/widgets/WidgetView';
import { api } from '../../services/api';
import './Dashboard.css';

function WidgetCard({ widget, refreshKey }) {
  const [state, setState] = useState({ loading: true });
  const [localKey, setLocalKey] = useState(0);

  useEffect(() => {
    let active = true;
    api.getDashboardWidgetData(widget.id)
      .then((result) => { if (active) setState({ result }); })
      .catch((error) => { if (active) setState({ error: error.message }); });
    return () => { active = false; };
  }, [widget.id, refreshKey, localKey]);

  const wide = widget.chartType === 'table' || widget.chartType === 'line';

  return (
    <article className={`db-card ${wide ? 'is-wide' : ''}`} aria-busy={state.loading ? 'true' : undefined}>
      <header className="db-card-head">
        <div>
          <h2>{widget.name}</h2>
          {widget.description && <p>{widget.description}</p>}
        </div>
        <button type="button" className="db-icon-button" onClick={() => { setState({ loading: true }); setLocalKey((value) => value + 1); }} aria-label={`Refresh ${widget.name}`} title="Refresh">
          <Icon name="refresh" size={14} />
        </button>
      </header>
      <div className="db-card-body">
        {state.loading && <div className="db-skeleton" aria-label="Loading" />}
        {state.error && <p className="db-error" role="alert"><Icon name="info" size={14} /> {state.error}</p>}
        {state.result && <WidgetView chartType={widget.chartType} result={state.result} height={240} />}
        {state.result?.truncated && <small className="db-note">Showing the first 500 rows.</small>}
      </div>
    </article>
  );
}

export default function Dashboard({
  spaces = [],
  tasks = [],
  isAdmin = false,
  onNavigate = () => {},
  onCreateSpace = () => {},
  onOpenSpaceSettings = () => {},
  onDeleteSpace = () => {},
  onGlobalCreate = () => {},
  onOpenTask = () => {}
}) {
  const [widgets, setWidgets] = useState(null);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(() => {
    let active = true;
    api.getDashboardWidgets()
      .then((rows) => { if (active) { setWidgets(rows); setError(''); } })
      .catch((loadError) => { if (active) setError(loadError.message); });
    return () => { active = false; };
  }, []);

  useEffect(() => load(), [load, refreshKey]);

  return (
    <div className="app-shell">
      <Header spaces={spaces} tasks={tasks} onGlobalCreate={onGlobalCreate} onOpenTask={onOpenTask} />
      <Sidebar activeSection="Dashboard" spaces={spaces} onNavigate={onNavigate} onCreateSpace={onCreateSpace} onOpenSpaceSettings={onOpenSpaceSettings} onDeleteSpace={onDeleteSpace} />

      <main className="main-content db-main">
        <div className="page-heading db-heading">
          <div>
            <h1>Dashboard</h1>
            <p className="db-subtitle">Widgets configured by your administrators.</p>
          </div>
          <div className="db-actions">
            <button type="button" className="db-button" onClick={() => setRefreshKey((value) => value + 1)}><Icon name="refresh" size={14} /> Refresh</button>
            {isAdmin && (
              <button type="button" className="db-button is-primary" onClick={() => onNavigate('systemSettings', { tab: 'widgets' })}>
                <Icon name="settings" size={14} /> Manage widgets
              </button>
            )}
          </div>
        </div>

        {widgets === null && (
          <div className="db-state">{error ? <>{error} <button type="button" className="db-link" onClick={() => setRefreshKey((value) => value + 1)}>Retry</button></> : 'Loading widgets…'}</div>
        )}

        {widgets !== null && !widgets.length && (
          <div className="db-empty">
            <span className="db-empty-icon"><Icon name="dashboard" size={28} /></span>
            <h2>No widgets yet</h2>
            <p>{isAdmin ? 'Create SQL widgets in System settings to show charts and numbers here.' : 'Your administrators have not shared any widgets with you yet.'}</p>
            {isAdmin && <button type="button" className="db-button is-primary" onClick={() => onNavigate('systemSettings', { tab: 'widgets' })}><Icon name="plus" size={14} /> Create a widget</button>}
          </div>
        )}

        {widgets?.length > 0 && (
          <div className="db-grid">
            {widgets.map((widget) => <WidgetCard key={widget.id} widget={widget} refreshKey={refreshKey} />)}
          </div>
        )}
      </main>
    </div>
  );
}
