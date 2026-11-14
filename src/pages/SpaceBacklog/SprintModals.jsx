import { useState } from 'react';
import { todayIso } from './backlogModel';

const DURATIONS = [
  { value: '1', label: '1 week', days: 7 },
  { value: '2', label: '2 weeks', days: 14 },
  { value: '3', label: '3 weeks', days: 21 },
  { value: '4', label: '4 weeks', days: 28 },
  { value: 'custom', label: 'Custom' }
];

function addDaysIso(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year, month - 1, day + days);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function Modal({ titleId, title, children, footer, onClose }) {
  return (
    <div className="slv-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="slv-modal bl-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="slv-modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="slv-modal-content">{children}</div>
        <div className="slv-modal-foot">{footer}</div>
      </div>
    </div>
  );
}

/**
 * Edit a sprint (mode "edit") or confirm starting it (mode "start").
 * onSubmit(values) returns an error message, or '' on success.
 */
export function SprintFormModal({ sprint, mode = 'edit', itemCount = 0, onClose, onSubmit }) {
  const starting = mode === 'start';
  const initialStart = sprint.startDate || (starting ? todayIso() : '');
  const initialEnd = sprint.endDate || (starting ? addDaysIso(initialStart, 14) : '');
  const [name, setName] = useState(sprint.name || '');
  const [duration, setDuration] = useState(() => {
    if (!initialStart || !initialEnd) return 'custom';
    const match = DURATIONS.find((item) => item.days && addDaysIso(initialStart, item.days) === initialEnd);
    return match ? match.value : 'custom';
  });
  const [startDate, setStartDate] = useState(initialStart);
  const [endDate, setEndDate] = useState(initialEnd);
  const [goal, setGoal] = useState(sprint.goal || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function changeStart(value) {
    setStartDate(value);
    const preset = DURATIONS.find((item) => item.value === duration && item.days);
    if (value && preset) setEndDate(addDaysIso(value, preset.days));
  }

  function changeDuration(value) {
    setDuration(value);
    const preset = DURATIONS.find((item) => item.value === value && item.days);
    if (preset) {
      const start = startDate || todayIso();
      setStartDate(start);
      setEndDate(addDaysIso(start, preset.days));
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!name.trim()) return setError('Sprint name is required.');
    if (starting && (!startDate || !endDate)) return setError('Start and end dates are required to start a sprint.');
    if (startDate && endDate && endDate < startDate) return setError('End date cannot be earlier than the start date.');
    setSaving(true);
    setError('');
    const message = await onSubmit({ name: name.trim(), goal: goal.trim(), startDate: startDate || null, endDate: endDate || null });
    setSaving(false);
    if (message) setError(message);
    else onClose();
  }

  const titleId = `bl-sprint-form-${sprint.id}`;
  return (
    <Modal
      titleId={titleId}
      title={starting ? 'Start sprint' : 'Edit sprint'}
      onClose={onClose}
      footer={<>
        <button type="button" className="slv-btn secondary" onClick={onClose}>Cancel</button>
        <button type="submit" form={`${titleId}-form`} className="slv-btn primary" disabled={saving}>
          {saving ? 'Saving…' : starting ? 'Start' : 'Update'}
        </button>
      </>}
    >
      <form id={`${titleId}-form`} className="bl-form" onSubmit={submit} noValidate>
        {starting && (
          <p className="bl-form-note">
            <strong>{itemCount}</strong> work item{itemCount === 1 ? '' : 's'} will be included in this sprint.
          </p>
        )}
        <label>
          <span>Sprint name <b aria-hidden="true">*</b></span>
          <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} autoFocus />
        </label>
        <label>
          <span>Duration</span>
          <select value={duration} onChange={(event) => changeDuration(event.target.value)}>
            {DURATIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <div className="bl-form-row">
          <label>
            <span>Start date{starting && <b aria-hidden="true"> *</b>}</span>
            <input type="date" value={startDate} onChange={(event) => changeStart(event.target.value)} />
          </label>
          <label>
            <span>End date{starting && <b aria-hidden="true"> *</b>}</span>
            <input type="date" value={endDate} min={startDate || undefined} onChange={(event) => { setEndDate(event.target.value); setDuration('custom'); }} />
          </label>
        </div>
        <label>
          <span>Sprint goal</span>
          <textarea rows={3} maxLength={500} value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="What should this sprint achieve?" />
        </label>
        {error && <p className="bl-form-error" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}

/** Completes the active sprint and chooses where its open work items go. */
export function CompleteSprintModal({ sprint, summary, futureSprints, onClose, onSubmit }) {
  const [moveTo, setMoveTo] = useState('backlog');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const open = summary.total - summary.counts.done;

  async function submit() {
    setSaving(true);
    setError('');
    const message = await onSubmit(moveTo);
    setSaving(false);
    if (message) setError(message);
    else onClose();
  }

  return (
    <Modal
      titleId={`bl-complete-${sprint.id}`}
      title={`Complete ${sprint.name}`}
      onClose={onClose}
      footer={<>
        <button type="button" className="slv-btn secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="slv-btn primary" onClick={submit} disabled={saving}>{saving ? 'Completing…' : 'Complete sprint'}</button>
      </>}
    >
      <div className="bl-form">
        <ul className="bl-complete-summary">
          <li><strong>{summary.counts.done}</strong> completed work item{summary.counts.done === 1 ? '' : 's'}</li>
          <li><strong>{open}</strong> open work item{open === 1 ? '' : 's'}</li>
        </ul>
        {open > 0 ? (
          <label>
            <span>Move open work items to</span>
            <select value={moveTo} onChange={(event) => setMoveTo(event.target.value)}>
              <option value="backlog">Backlog</option>
              {futureSprints.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              <option value="new">New sprint</option>
            </select>
          </label>
        ) : <p className="bl-form-note">All work items in this sprint are done.</p>}
        {error && <p className="bl-form-error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}

/** Generic confirmation for destructive actions. */
export function ConfirmModal({ title, message, confirmLabel = 'Delete', onClose, onConfirm }) {
  return (
    <Modal
      titleId="bl-confirm"
      title={title}
      onClose={onClose}
      footer={<>
        <button type="button" className="slv-btn secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="slv-btn danger" onClick={onConfirm}>{confirmLabel}</button>
      </>}
    >
      <p className="slv-confirm-text">{message}</p>
    </Modal>
  );
}
