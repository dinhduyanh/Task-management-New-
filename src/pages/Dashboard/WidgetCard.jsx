import { useEffect, useState } from 'react';
import Icon from '../../components/common/Icon';
import WidgetView from '../../components/widgets/WidgetView';
import { CHART_TYPE_LABELS } from '../../components/widgets/chartTypes';
import { api } from '../../services/api';
import './Dashboard.css';

/**
 * One SQL widget on a dashboard. Loads its data itself; `refreshKey` reloads it.
 * `available` false = the viewer may not see this widget (admin-only, inactive or removed).
 * `toolbar` replaces the refresh button (the builder puts its controls there).
 */
export default function WidgetCard({ widget, available = true, size = 1, refreshKey = 0, toolbar = null, height = 240, className = '', ...rest }) {
  const [state, setState] = useState({ loading: true });
  const [localKey, setLocalKey] = useState(0);

  useEffect(() => {
    if (!available) return undefined;
    let active = true;
    api.getDashboardWidgetData(widget.id)
      .then((result) => { if (active) setState({ result }); })
      .catch((error) => { if (active) setState({ error: error.message }); });
    return () => { active = false; };
  }, [widget.id, available, refreshKey, localKey]);

  return (
    <article className={`db-card size-${size} ${className}`} aria-busy={available && state.loading ? 'true' : undefined} {...rest}>
      <header className="db-card-head">
        <div className="db-card-title">
          <h2>{widget.name}</h2>
          {widget.description && <p>{widget.description}</p>}
        </div>
        {toolbar || (available && (
          <button type="button" className="db-icon-button" onClick={() => { setState({ loading: true }); setLocalKey((value) => value + 1); }} aria-label={`Refresh ${widget.name}`} title="Refresh">
            <Icon name="refresh" size={14} />
          </button>
        ))}
      </header>
      <div className="db-card-body">
        {!available && (
          <div className="db-unavailable">
            <Icon name="lock" size={18} />
            <span>This widget is not available to you{widget.name === 'Removed widget' ? ' (it was removed)' : ''}.</span>
            <small>{CHART_TYPE_LABELS[widget.chartType] || 'Widget'}</small>
          </div>
        )}
        {available && state.loading && <div className="db-skeleton" style={{ height: height - 40 }} aria-label="Loading" />}
        {available && state.error && <p className="db-error" role="alert"><Icon name="info" size={14} /> {state.error}</p>}
        {available && state.result && <WidgetView chartType={widget.chartType} result={state.result} height={height} />}
        {available && state.result?.truncated && <small className="db-note">Showing the first 500 rows.</small>}
      </div>
    </article>
  );
}
