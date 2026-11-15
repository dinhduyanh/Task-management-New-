import { useEffect, useRef, useState } from 'react';
import Header from '../../components/layout/Header';
import Icon from '../../components/common/Icon';
import Toast from '../../components/common/Toast';
import { CHART_TYPE_LABELS } from '../../components/widgets/chartTypes';
import { useAppShell } from '../../context/appShellContext';
import { api } from '../../services/api';
import WidgetCard from './WidgetCard';
import './Dashboards.css';

const DRAG_TYPE = 'application/x-taskflow-dashboard';
const SIZES = [
  { value: 1, label: '1/3' },
  { value: 2, label: '2/3' },
  { value: 3, label: 'Full' }
];
const CHART_ICONS = { table: 'list', number: 'info', bar: 'chart', line: 'chart', pie: 'dashboard' };
let slotSeed = 0;
const newSlot = (widgetId, size = 1) => ({ key: `slot-${Date.now()}-${(slotSeed += 1)}`, widgetId, size });

/**
 * Create or edit a dashboard: drag SQL widgets from the palette onto a 3-column grid,
 * reorder them by dragging (or with the arrow buttons), set their width and save.
 */
export default function DashboardBuilder({ dashboardId = null, spaces = [], tasks = [], onGlobalCreate = () => {}, onOpenTask = () => {}, onCancel = () => {}, onSaved = () => {} }) {
  const { upsertDashboard } = useAppShell();
  const [widgets, setWidgets] = useState(null); // widgets the user may add
  const [current, setCurrent] = useState(null); // the stored dashboard (edit)
  const [form, setForm] = useState({ name: '', code: '', description: '', status: 'active', visibility: 'private' });
  const [layout, setLayout] = useState([]);
  const [query, setQuery] = useState('');
  const [drop, setDrop] = useState(null); // { index, position: 'before' | 'after' } | { index: 'end' }
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const dragRef = useRef(null); // { type: 'palette', widgetId } | { type: 'slot', index }

  useEffect(() => {
    let active = true;
    Promise.all([api.getDashboardWidgets(), dashboardId ? api.getDashboard(dashboardId, { visit: false }) : Promise.resolve(null)])
      .then(([widgetRows, dashboard]) => {
        if (!active) return;
        setWidgets(widgetRows);
        if (dashboard) {
          if (!dashboard.canEdit) { setLoadError('Only the owner or an administrator can edit this dashboard.'); return; }
          setCurrent(dashboard);
          setForm({ name: dashboard.name, code: dashboard.code, description: dashboard.description, status: dashboard.status, visibility: dashboard.visibility });
          setLayout(dashboard.layout.map((slot) => ({ ...newSlot(slot.widgetId, slot.size), widget: slot.widget, available: slot.available })));
        }
      })
      .catch((error_) => { if (active) setLoadError(error_.message); });
    return () => { active = false; };
  }, [dashboardId]);

  const widgetById = new Map((widgets || []).map((widget) => [widget.id, widget]));
  const usedIds = new Set(layout.map((slot) => slot.widgetId));
  const needle = query.trim().toLowerCase();
  const palette = (widgets || []).filter((widget) => !needle || `${widget.name} ${widget.description}`.toLowerCase().includes(needle));
  const setField = (name, value) => { setForm((values) => ({ ...values, [name]: value })); setError(''); };

  function slotWidget(slot) {
    const widget = widgetById.get(slot.widgetId);
    if (widget) return { widget, available: true };
    return { widget: slot.widget || { id: slot.widgetId, name: 'Removed widget', chartType: 'table' }, available: Boolean(slot.available) };
  }

  function insertAt(index, slot) {
    setLayout((items) => {
      const next = [...items];
      next.splice(index, 0, slot);
      return next;
    });
  }

  function addWidget(widget) {
    setLayout((items) => [...items, newSlot(widget.id, widget.chartType === 'table' || widget.chartType === 'line' ? 2 : 1)]);
    setToast({ type: 'success', message: `${widget.name} added.` });
  }

  function moveSlot(from, to) {
    setLayout((items) => {
      if (to < 0 || to >= items.length || from === to) return items;
      const next = [...items];
      const [slot] = next.splice(from, 1);
      next.splice(to, 0, slot);
      return next;
    });
  }

  // ---- drag and drop --------------------------------------------------------------
  function startDrag(event, payload, label) {
    dragRef.current = payload;
    event.dataTransfer.effectAllowed = payload.type === 'palette' ? 'copy' : 'move';
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload));
    event.dataTransfer.setData('text/plain', label);
  }

  function endDrag() {
    dragRef.current = null;
    setDrop(null);
  }

  function overSlot(event, index) {
    if (!dragRef.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = dragRef.current.type === 'palette' ? 'copy' : 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const position = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
    if (!drop || drop.index !== index || drop.position !== position) setDrop({ index, position });
  }

  function dropAt(event, targetIndex) {
    event.preventDefault();
    event.stopPropagation();
    const payload = dragRef.current;
    endDrag();
    if (!payload) return;
    if (payload.type === 'palette') {
      const widget = widgetById.get(payload.widgetId);
      if (!widget) return;
      insertAt(targetIndex, newSlot(widget.id, widget.chartType === 'table' || widget.chartType === 'line' ? 2 : 1));
      setToast({ type: 'success', message: `${widget.name} added.` });
      return;
    }
    // Moving within the grid: account for the removed item before the target.
    const from = payload.index;
    const to = from < targetIndex ? targetIndex - 1 : targetIndex;
    moveSlot(from, to);
  }

  function dropIndexFor(index) {
    return drop && drop.index === index && drop.position === 'after' ? index + 1 : index;
  }

  async function save() {
    if (!form.name.trim()) { setError('Dashboard name is required.'); return; }
    setSaving(true);
    setError('');
    const values = {
      name: form.name.trim(),
      description: form.description.trim(),
      status: form.status,
      visibility: form.visibility,
      layout: layout.map(({ widgetId, size }) => ({ widgetId, size }))
    };
    if (form.code.trim()) values.code = form.code.trim();
    try {
      const saved = current ? await api.updateDashboard(current.id, values) : await api.createDashboard(values);
      upsertDashboard(saved);
      onSaved(saved);
    } catch (saveError) {
      setError(saveError.message);
      setSaving(false);
    }
  }

  return (
    <div className="dbx-builder-shell">
      <Header spaces={spaces} tasks={tasks} onGlobalCreate={onGlobalCreate} onOpenTask={onOpenTask} />
      <div className="dbx-builder-bar">
        <div className="dbx-title">
          <button type="button" className="dbx-icon-button" onClick={onCancel} aria-label="Back" title="Back"><Icon name="arrowLeft" size={17} /></button>
          <div>
            <h1>{current ? `Edit ${current.name}` : 'New dashboard'}</h1>
            <small>Drag widgets from the left onto the grid. Drag cards to reorder them.</small>
          </div>
        </div>
        <div className="dbx-head-actions">
          {error && <span className="dbx-error" role="alert">{error}</span>}
          <button type="button" className="dbx-button" onClick={onCancel}>Cancel</button>
          <button type="button" className="dbx-button is-primary" onClick={save} disabled={saving || Boolean(loadError) || widgets === null}>
            <Icon name="check" size={14} /> {saving ? 'Saving…' : 'Save dashboard'}
          </button>
        </div>
      </div>

      {loadError ? (
        <div className="dbx-state" role="alert"><Icon name="lock" size={28} /><strong>{loadError}</strong><button type="button" className="dbx-button" onClick={onCancel}>Back</button></div>
      ) : (
        <div className="dbx-builder">
          <aside className="dbx-palette" aria-label="Available widgets">
            <h2>Widgets <span>{widgets ? widgets.length : ''}</span></h2>
            <p>SQL widgets configured by administrators in System settings.</p>
            <label className="dbx-input">
              <Icon name="search" size={14} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search widgets" aria-label="Search widgets" />
            </label>
            <div className="dbx-palette-list">
              {widgets === null && <div className="dbx-palette-empty">Loading widgets…</div>}
              {widgets !== null && !widgets.length && <div className="dbx-palette-empty">No widgets are available yet. An administrator can create them in System settings › Widgets.</div>}
              {widgets !== null && widgets.length > 0 && !palette.length && <div className="dbx-palette-empty">No widgets match “{query}”.</div>}
              {palette.map((widget) => (
                <div
                  key={widget.id}
                  className="dbx-palette-item"
                  draggable
                  onDragStart={(event) => startDrag(event, { type: 'palette', widgetId: widget.id }, widget.name)}
                  onDragEnd={endDrag}
                  data-widget={widget.name}
                >
                  <span className="dbx-palette-grip" aria-hidden="true"><Icon name="grip" size={14} /></span>
                  <span className="dbx-palette-icon"><Icon name={CHART_ICONS[widget.chartType] || 'chart'} size={15} /></span>
                  <span className="dbx-palette-text">
                    <strong>{widget.name}</strong>
                    <small>{CHART_TYPE_LABELS[widget.chartType]}{usedIds.has(widget.id) ? ' · on dashboard' : ''}</small>
                  </span>
                  <button type="button" className="dbx-icon-button" onClick={() => addWidget(widget)} aria-label={`Add ${widget.name}`} title="Add to the dashboard"><Icon name="plus" size={14} /></button>
                </div>
              ))}
            </div>
          </aside>

          <div className="dbx-canvas-wrap">
            <section className="dbx-settings" aria-label="Dashboard details">
              <label className="dbx-field dbx-span-2">
                <span>Name <b>*</b></span>
                <input value={form.name} maxLength={80} onChange={(event) => setField('name', event.target.value)} placeholder="e.g. Sprint health" autoFocus={!dashboardId} />
              </label>
              <label className="dbx-field">
                <span>Code</span>
                <input value={form.code} maxLength={20} onChange={(event) => setField('code', event.target.value.toUpperCase())} placeholder="Generated (DB-001)" />
              </label>
              <label className="dbx-field">
                <span>Status</span>
                <select value={form.status} onChange={(event) => setField('status', event.target.value)}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
              <label className="dbx-field">
                <span>Publish</span>
                <select value={form.visibility} onChange={(event) => setField('visibility', event.target.value)}>
                  <option value="private">Private (only me)</option>
                  <option value="public">Public (everyone)</option>
                </select>
              </label>
              <label className="dbx-field dbx-span-all">
                <span>Description</span>
                <input value={form.description} maxLength={300} onChange={(event) => setField('description', event.target.value)} placeholder="What is this dashboard for?" />
              </label>
            </section>

            <div className="db-grid dbx-canvas" aria-label="Dashboard layout" onDragOver={(event) => { if (dragRef.current) event.preventDefault(); }} onDrop={(event) => dropAt(event, layout.length)}>
              {layout.map((slot, index) => {
                const { widget, available } = slotWidget(slot);
                const marker = drop && drop.index === index ? `drop-${drop.position}` : '';
                return (
                  <WidgetCard
                    key={slot.key}
                    widget={widget}
                    available={available}
                    size={slot.size}
                    height={200}
                    className={`dbx-slot ${marker}`}
                    data-slot={index}
                    draggable
                    onDragStart={(event) => startDrag(event, { type: 'slot', index }, widget.name)}
                    onDragEnd={endDrag}
                    onDragOver={(event) => overSlot(event, index)}
                    onDrop={(event) => dropAt(event, dropIndexFor(index))}
                    toolbar={(
                      <div className="dbx-slot-tools">
                        <span className="dbx-slot-grip" title="Drag to move" aria-hidden="true"><Icon name="grip" size={14} /></span>
                        <select value={slot.size} onChange={(event) => setLayout((items) => items.map((item) => (item.key === slot.key ? { ...item, size: Number(event.target.value) } : item)))} aria-label={`Width of ${widget.name}`}>
                          {SIZES.map((size) => <option key={size.value} value={size.value}>{size.label}</option>)}
                        </select>
                        <button type="button" className="dbx-icon-button" onClick={() => moveSlot(index, index - 1)} disabled={index === 0} aria-label={`Move ${widget.name} earlier`} title="Move earlier"><Icon name="arrowLeft" size={13} /></button>
                        <button type="button" className="dbx-icon-button dbx-flip" onClick={() => moveSlot(index, index + 1)} disabled={index === layout.length - 1} aria-label={`Move ${widget.name} later`} title="Move later"><Icon name="arrowLeft" size={13} /></button>
                        <button type="button" className="dbx-icon-button is-danger" onClick={() => setLayout((items) => items.filter((item) => item.key !== slot.key))} aria-label={`Remove ${widget.name}`} title="Remove"><Icon name="trash" size={13} /></button>
                      </div>
                    )}
                  />
                );
              })}
              <div
                className={`dbx-dropzone ${drop?.index === 'end' ? 'is-over' : ''} ${layout.length ? '' : 'is-empty'}`}
                onDragOver={(event) => { if (!dragRef.current) return; event.preventDefault(); if (drop?.index !== 'end') setDrop({ index: 'end' }); }}
                onDragLeave={() => setDrop(null)}
                onDrop={(event) => dropAt(event, layout.length)}
              >
                <Icon name="plus" size={18} />
                <span>{layout.length ? 'Drop a widget here to add it at the end' : 'Drag widgets here to build your dashboard'}</span>
              </div>
            </div>
          </div>
        </div>
      )}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
