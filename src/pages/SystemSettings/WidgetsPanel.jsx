import { useEffect, useState } from 'react';
import Icon from '../../components/common/Icon';
import WidgetView from '../../components/widgets/WidgetView';
import { CHART_TYPE_LABELS } from '../../components/widgets/chartTypes';
import { api } from '../../services/api';
import { ConfirmModal } from '../SpaceBacklog/SprintModals';
import SettingsModal from './SettingsModal';

// @me = the id of the user viewing the widget (filled in by the server).
const MY_PROJECTS = "EXISTS (SELECT 1 FROM space_members m WHERE m.space_id = w.space_id AND m.user_id = @me)";
const EXAMPLES = [
  {
    label: 'Assigned to me',
    chartType: 'table',
    description: 'Open work items assigned to the person viewing the dashboard.',
    sql: `SELECT w.issue_key AS "Key", w.title AS "Title", w.status AS "Status",
       w.priority AS "Priority", s.name AS "Project",
       COALESCE(w.due_date, '') AS "Due date"
FROM work_items w
JOIN spaces s ON s.id = w.space_id
WHERE w.assignee_id = @me
  AND w.status NOT IN ('Done', 'Cancel')
  AND ${MY_PROJECTS}
ORDER BY CASE w.priority WHEN 'Highest' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3
         WHEN 'Low' THEN 4 ELSE 5 END,
         w.due_date IS NULL, w.due_date`
  },
  {
    label: 'My open tasks (count)',
    chartType: 'number',
    description: 'How many open work items are assigned to you.',
    sql: `SELECT COUNT(*) AS my_open_tasks
FROM work_items w
WHERE w.assignee_id = @me
  AND w.status NOT IN ('Done', 'Cancel')
  AND ${MY_PROJECTS}`
  },
  {
    label: 'My tasks by status',
    chartType: 'pie',
    description: 'Your assigned work items grouped by status.',
    sql: `SELECT w.status, COUNT(*) AS total
FROM work_items w
WHERE w.assignee_id = @me
  AND ${MY_PROJECTS}
GROUP BY w.status
ORDER BY total DESC`
  },
  { label: 'Work items by status', chartType: 'bar', sql: 'SELECT status, COUNT(*) AS total\nFROM work_items\nGROUP BY status\nORDER BY total DESC' },
  { label: 'Work items per project', chartType: 'pie', sql: 'SELECT s.name AS project, COUNT(w.id) AS work_items\nFROM spaces s\nLEFT JOIN work_items w ON w.space_id = s.id\nGROUP BY s.id\nORDER BY work_items DESC' },
  { label: 'Open work items', chartType: 'number', sql: "SELECT COUNT(*) AS open_work_items\nFROM work_items\nWHERE status NOT IN ('Done', 'Cancel')" },
  { label: 'Created per day (30 days)', chartType: 'line', sql: "SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS created\nFROM work_items\nWHERE created_at >= date('now', '-30 days')\nGROUP BY day\nORDER BY day" }
];

function WidgetFormModal({ widget = null, onClose, onSaved }) {
  const [name, setName] = useState(widget?.name || '');
  const [description, setDescription] = useState(widget?.description || '');
  const [chartType, setChartType] = useState(widget?.chartType || 'table');
  const [visibility, setVisibility] = useState(widget?.visibility || 'admins');
  const [isActive, setIsActive] = useState(widget ? widget.isActive : true);
  const [sql, setSql] = useState(widget?.sql || '');
  const [preview, setPreview] = useState(null); // { result } | { error }
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function runQuery() {
    setRunning(true);
    try {
      setPreview({ result: await api.admin.previewWidget(sql) });
    } catch (runError) {
      setPreview({ error: runError.message });
    } finally {
      setRunning(false);
    }
  }

  async function save() {
    if (!name.trim()) return setError('Widget name is required.');
    if (!sql.trim()) return setError('SQL query is required.');
    setSaving(true);
    setError('');
    try {
      const values = { name: name.trim(), description: description.trim(), chartType, visibility, isActive, sql };
      const saved = widget ? await api.admin.updateWidget(widget.id, values) : await api.admin.createWidget(values);
      onSaved(saved, Boolean(widget));
      onClose();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  function applyExample(example) {
    setSql(example.sql);
    setChartType(example.chartType);
    if (!name.trim()) setName(example.label);
    if (example.description && !description.trim()) setDescription(example.description);
    // Widgets filtered by @me only show each viewer their own data, so they can be shared.
    if (/@me\b/.test(example.sql)) setVisibility('everyone');
    setPreview(null);
  }

  return (
    <SettingsModal
      wide
      title={widget ? `Edit widget: ${widget.name}` : 'New SQL widget'}
      onClose={onClose}
      onSubmit={save}
      footer={<>
        {error && <span className="ss-form-error" role="alert">{error}</span>}
        <button type="button" className="ss-button" onClick={onClose}>Cancel</button>
        <button type="submit" className="ss-button is-primary" disabled={saving}>{saving ? 'Saving…' : widget ? 'Save widget' : 'Create widget'}</button>
      </>}
    >
      <div className="ss-form-grid">
        <label className="ss-field">
          <span>Widget name <b>*</b></span>
          <input value={name} maxLength={80} autoFocus onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="ss-field">
          <span>Display type</span>
          <select value={chartType} onChange={(event) => setChartType(event.target.value)}>
            {Object.entries(CHART_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="ss-field ss-span-2">
          <span>Description</span>
          <input value={description} maxLength={300} onChange={(event) => setDescription(event.target.value)} placeholder="Shown under the widget title" />
        </label>
        <label className="ss-field">
          <span>Visible to</span>
          <select value={visibility} onChange={(event) => setVisibility(event.target.value)}>
            <option value="admins">Admins only</option>
            <option value="everyone">Everyone</option>
          </select>
        </label>
        <label className="ss-check">
          <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
          <span><strong>Show on Dashboard</strong><small>Inactive widgets are kept but hidden.</small></span>
        </label>
        {visibility === 'everyone' && (
          <p className="ss-warning ss-span-2"><Icon name="info" size={15} /> {/@me\b/.test(sql)
            ? 'This query uses @me, so each viewer sees their own rows.'
            : 'Query results are not limited to each viewer’s projects: everyone will see whatever this query returns.'}</p>
        )}
        <div className="ss-field ss-span-2">
          <span className="ss-sql-label">
            SQL query <b>*</b>
            <span className="ss-examples">
              Examples:
              {EXAMPLES.map((example) => <button key={example.label} type="button" onClick={() => applyExample(example)}>{example.label}</button>)}
            </span>
          </span>
          <textarea className="ss-sql" rows={7} spellCheck={false} value={sql} onChange={(event) => { setSql(event.target.value); setPreview(null); }} aria-label="SQL query" placeholder="SELECT status, COUNT(*) AS total FROM work_items GROUP BY status" />
          <small className="ss-hint">One read-only SELECT (or WITH … SELECT). The first column is the label; numeric columns become chart series. Up to 500 rows. Sign-in data (sessions, password hashes) cannot be queried. Use <code>@me</code> for the id of the person viewing the widget (e.g. <code>WHERE assignee_id = @me</code>).</small>
        </div>
        <div className="ss-span-2 ss-preview">
          <div className="ss-preview-head">
            <strong>Preview</strong>
            <button type="button" className="ss-button" onClick={runQuery} disabled={running || !sql.trim()}><Icon name="refresh" size={14} /> {running ? 'Running…' : 'Run query'}</button>
          </div>
          {preview?.error && <p className="ss-form-error" role="alert">{preview.error}</p>}
          {preview?.result && (
            <>
              <small className="ss-hint">{preview.result.rows.length} row{preview.result.rows.length === 1 ? '' : 's'}{preview.result.truncated ? ' (first 500 shown)' : ''}</small>
              <WidgetView chartType={chartType} result={preview.result} height={220} />
            </>
          )}
          {!preview && <small className="ss-hint">Run the query to preview the widget.</small>}
        </div>
      </div>
    </SettingsModal>
  );
}

export default function WidgetsPanel({ onToast, onOpenDashboard }) {
  const [widgets, setWidgets] = useState(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [form, setForm] = useState(null);
  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
    let active = true;
    api.admin.getWidgets()
      .then((rows) => { if (active) { setWidgets(rows); setError(''); } })
      .catch((loadError) => { if (active) setError(loadError.message); });
    return () => { active = false; };
  }, [reloadKey]);

  async function toggleActive(widget) {
    try {
      const saved = await api.admin.updateWidget(widget.id, { isActive: !widget.isActive });
      setWidgets((current) => current.map((item) => (item.id === saved.id ? saved : item)));
    } catch (toggleError) {
      onToast({ type: 'error', message: toggleError.message });
    }
  }

  return (
    <>
      <div className="ss-panel-head">
        <div>
          <h2>Widgets</h2>
          <p>SQL widgets shown on the Dashboard. Queries run on a read-only connection.</p>
        </div>
        <div className="ss-head-actions">
          <button type="button" className="ss-button" onClick={onOpenDashboard}><Icon name="dashboard" size={15} /> Open Dashboard</button>
          <button type="button" className="ss-button is-primary" onClick={() => setForm({ widget: null })}><Icon name="plus" size={15} /> New widget</button>
        </div>
      </div>

      <div className="ss-card">
        <div className="ss-scroll">
          <table className="ss-table">
            <thead><tr><th>Widget</th><th>Display</th><th>Visible to</th><th>Dashboard</th><th>Updated</th><th className="ss-actions"><span className="ss-visually-hidden">Actions</span></th></tr></thead>
            <tbody>
              {(widgets || []).map((widget) => (
                <tr key={widget.id}>
                  <td>
                    <button type="button" className="ss-name-button" onClick={() => setForm({ widget })}>
                      <strong>{widget.name}</strong>
                      <small><code>{widget.sql.replace(/\s+/g, ' ').slice(0, 90)}{widget.sql.length > 90 ? '…' : ''}</code></small>
                    </button>
                  </td>
                  <td className="ss-nowrap">{CHART_TYPE_LABELS[widget.chartType]}</td>
                  <td><span className={`ss-pill ${widget.visibility === 'everyone' ? 'is-everyone' : ''}`}>{widget.visibility === 'everyone' ? 'Everyone' : 'Admins only'}</span></td>
                  <td>
                    <label className="ss-switch" title={widget.isActive ? 'Shown on the Dashboard' : 'Hidden'}>
                      <input type="checkbox" checked={widget.isActive} onChange={() => toggleActive(widget)} aria-label={`Show ${widget.name} on the Dashboard`} />
                      <span aria-hidden="true" />
                    </label>
                  </td>
                  <td className="ss-date">{new Date(widget.updatedAt).toLocaleDateString()}</td>
                  <td className="ss-actions">
                    <button type="button" className="ss-icon-button" onClick={() => setForm({ widget })} aria-label={`Edit ${widget.name}`} title="Edit"><Icon name="edit" size={15} /></button>
                    <button
                      type="button"
                      className="ss-icon-button is-danger"
                      aria-label={`Delete ${widget.name}`}
                      title="Delete"
                      onClick={() => setConfirm({
                        title: `Delete ${widget.name}?`,
                        message: 'The widget is removed from the Dashboard for everyone.',
                        onConfirm: async () => {
                          try {
                            await api.admin.deleteWidget(widget.id);
                            setWidgets((current) => current.filter((item) => item.id !== widget.id));
                            onToast({ type: 'success', message: `${widget.name} deleted.` });
                          } catch (deleteError) {
                            onToast({ type: 'error', message: deleteError.message });
                          }
                        }
                      })}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </td>
                </tr>
              ))}
              {widgets !== null && !widgets.length && <tr><td colSpan={6} className="ss-empty">No widgets yet. Create one to show data on the Dashboard.</td></tr>}
              {widgets === null && <tr><td colSpan={6} className="ss-empty">{error ? <>{error} <button type="button" className="ss-link" onClick={() => setReloadKey((value) => value + 1)}>Retry</button></> : 'Loading widgets…'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {form && (
        <WidgetFormModal
          widget={form.widget}
          onClose={() => setForm(null)}
          onSaved={(saved, editing) => {
            setWidgets((current) => (editing ? current.map((item) => (item.id === saved.id ? saved : item)) : [...current, saved]));
            onToast({ type: 'success', message: `${saved.name} ${editing ? 'saved' : 'created'}.` });
          }}
        />
      )}
      {confirm && <ConfirmModal title={confirm.title} message={confirm.message} onClose={() => setConfirm(null)} onConfirm={() => { confirm.onConfirm(); setConfirm(null); }} />}
    </>
  );
}
