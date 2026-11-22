import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../common/Icon';
import DatePicker from '../common/DatePicker';
import { api } from '../../services/api';
import { iconForType, issueKey, issueSummary, issueType } from '../../pages/SpacesList/issueHelpers';
import {
  MAX_MINUTES_PER_DAY, MAX_RANGE_DAYS, countDays, effectiveTo, formatDay, formatDuration, logWindow, parseDay, toMinutes, todayIn, validateWorkLog
} from '../../../shared/worklog';
import './LogWorkModal.css';

const QUICK_HOURS = [1, 2, 4, 8];

// Hours and minutes take whole numbers only: no sign, decimal point or exponent.
function blockNonDigits(event) {
  if (['-', '+', '.', ',', 'e', 'E'].includes(event.key)) event.preventDefault();
}

/**
 * Log work on a work item: task info, From (required) .. To (optional: empty = one day),
 * only days within one month up to today,
 * hours + minutes per day (max 12h a day, together with what was already logged that
 * day), a description, Cancel / Save. onSaved(result) receives the updated list.
 */
export default function LogWorkModal({ issue, space, onClose, onSaved }) {
  const [today] = useState(() => todayIn());
  const allowed = logWindow(today); // { min: same day last month, max: today }
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(''); // empty = log the From day only
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');
  const [description, setDescription] = useState('');
  const [existing, setExisting] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState('');
  const [saving, setSaving] = useState(false);
  const hoursRef = useRef(null);

  const from = fromDate;
  const to = effectiveTo(fromDate, toDate);
  const multiple = Boolean(from && to && to !== from);
  const check = useMemo(() => validateWorkLog({ fromDate: from, toDate: to, hours, minutes, description }, existing, today), [from, to, hours, minutes, description, existing, today]);
  const perDay = toMinutes(hours, minutes);
  const durationTouched = hours !== '' || minutes !== '';
  const show = {
    range: check.errors.range && (submitted || (from && to)),
    duration: check.errors.duration && (submitted || durationTouched),
    daily: check.errors.daily,
    description: check.errors.description && submitted
  };

  // What the user already logged on these days (all work items), for the 12h rule.
  useEffect(() => {
    if (parseDay(from) === null || parseDay(to) === null || countDays(from, to) < 1 || countDays(from, to) > MAX_RANGE_DAYS) return undefined;
    let active = true;
    api.getDailyWorkTotals(from, to).then((result) => { if (active) setExisting(result?.totals || {}); }).catch(() => {});
    return () => { active = false; };
  }, [from, to]);

  useEffect(() => {
    hoursRef.current?.focus();
    // Escape closes the modal, unless a calendar is open (then it only closes the calendar).
    const onKey = (event) => {
      if (event.key !== 'Escape' || document.querySelector('.dp-popover')) return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  async function save(event) {
    event.preventDefault();
    setSubmitted(true);
    setServerError('');
    if (!check.ok) return;
    setSaving(true);
    try {
      const result = await api.createWorkLog(issue.id, { fromDate: from, toDate: toDate || '', timezoneOffset: new Date().getTimezoneOffset(), hours: hours === '' ? 0 : Number(hours), minutes: minutes === '' ? 0 : Number(minutes), description: description.trim() });
      onSaved?.(result);
    } catch (error) {
      setServerError(error.message || 'Could not save the work log.');
      setSaving(false);
    }
  }

  const type = issueType(issue);
  const days = check.dates.length;
  const alreadyThatDay = !multiple ? Number(existing[from]) || 0 : 0;
  const blocked = !check.ok;

  return (
    <div className="lw-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="lw-modal" role="dialog" aria-modal="true" aria-labelledby="lw-title" onSubmit={save} noValidate>
        <header className="lw-head">
          <h2 id="lw-title">Log work</h2>
          <button type="button" className="lw-close" onClick={onClose} aria-label="Close"><Icon name="close" size={15} /></button>
        </header>

        <div className="lw-body">
          {/* 1. Task */}
          <section className="lw-card" aria-labelledby="lw-task">
            <h3 id="lw-task"><Icon name="tasks" size={15} /> Task</h3>
            <dl className="lw-info">
              <div>
                <dt>Issue type</dt>
                <dd className="lw-type"><span className={`slv-type-icon type-${type.toLowerCase().replace(/[^a-z]+/g, '-')}`}><Icon name={iconForType(type)} size={13} /></span>{type}</dd>
              </div>
              <div>
                <dt>Project</dt>
                <dd>{space?.name || issue.project?.name || issue.spaceCode || '—'}</dd>
              </div>
              <div className="lw-info-wide">
                <dt>Work item</dt>
                <dd className="lw-task-name" title={`${issueKey(issue)} - ${issueSummary(issue)}`}><strong>{issueKey(issue)}</strong> - {issueSummary(issue)}</dd>
              </div>
            </dl>
          </section>

          {/* 2. Time */}
          <section className="lw-card" aria-labelledby="lw-time">
            <h3 id="lw-time"><Icon name="calendar" size={15} /> Time</h3>
            <div className="lw-row">
              <div className="lw-field">
                <label className="lw-label" htmlFor="lw-from"><span className="lw-required">*</span> From</label>
                <DatePicker id="lw-from" value={fromDate} min={allowed.min} max={allowed.max} clearable={false} onChange={(value) => { setFromDate(value || ''); if (value && toDate && toDate < value) setToDate(''); }} ariaLabel="From date" className={show.range ? 'lw-invalid' : ''} />
              </div>
              <div className="lw-field">
                <label className="lw-label" htmlFor="lw-to">To <small className="lw-optional">(optional)</small></label>
                <DatePicker id="lw-to" value={toDate} min={fromDate || allowed.min} max={allowed.max} placeholder="Same day" onChange={(value) => setToDate(value || '')} ariaLabel="To date" className={show.range ? 'lw-invalid' : ''} />
              </div>
            </div>
            {show.range && <p className="lw-error" role="alert">{check.errors.range}</p>}
            {!check.errors.range && days > 0 && (
              <p className="lw-summary" role="status">
                <Icon name="info" size={13} />
                {multiple
                  ? <>Applies to <strong>{days} days</strong>: {formatDay(from)} - {formatDay(to)}{!check.errors.duration && perDay > 0 && <> · {formatDuration(perDay)}/day · total <strong>{formatDuration(check.totalMinutes)}</strong></>}</>
                  : <>Logs work for <strong>1 day</strong>: {formatDay(from)}</>}
              </p>
            )}
            <p className="lw-hint">Leave To empty to log a single day. You can log work from {formatDay(allowed.min)} to today ({formatDay(allowed.max)}).</p>
          </section>

          {/* 3. Hours */}
          <section className="lw-card" aria-labelledby="lw-hours-title">
            <h3 id="lw-hours-title"><Icon name="clock" size={15} /> Time spent {multiple && <small>(per day)</small>}</h3>
            <div className="lw-row">
              <div className="lw-field">
                <label className="lw-label" htmlFor="lw-hours"><span className="lw-required">*</span> Hours</label>
                <input id="lw-hours" ref={hoursRef} className={`lw-input ${show.duration || show.daily ? 'lw-invalid' : ''}`} type="number" inputMode="numeric" min="1" max="12" step="1" value={hours} onKeyDown={blockNonDigits} onChange={(event) => setHours(event.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="1 - 12" aria-describedby="lw-hours-help" />
              </div>
              <div className="lw-field">
                <label className="lw-label" htmlFor="lw-minutes">Minutes</label>
                <input id="lw-minutes" className={`lw-input ${show.duration || show.daily ? 'lw-invalid' : ''}`} type="number" inputMode="numeric" min="0" step="5" value={minutes} onKeyDown={blockNonDigits} onChange={(event) => setMinutes(event.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="0" />
              </div>
            </div>
            <div className="lw-quick" role="group" aria-label="Quick select">
              <span>Quick select</span>
              {QUICK_HOURS.map((value) => (
                <button key={value} type="button" className={String(hours) === String(value) && !Number(minutes) ? 'is-active' : ''} onClick={() => { setHours(String(value)); setMinutes(''); }}>{value}h</button>
              ))}
            </div>
            <p id="lw-hours-help" className="lw-hint">Hours: a whole number from 1 to 12. Minutes are optional. At most 12 hours a day.</p>
            {!Number.isNaN(perDay) && Number(minutes) >= 60 && <p className="lw-note">= {formatDuration(perDay)}</p>}
            {show.duration && <p className="lw-error" role="alert">{check.errors.duration}</p>}
            {!show.duration && show.daily && <p className="lw-error" role="alert">{check.errors.daily}</p>}
            {!multiple && alreadyThatDay > 0 && !show.daily && (
              <p className="lw-note">You already logged {formatDuration(alreadyThatDay)} on this day · {formatDuration(Math.max(0, MAX_MINUTES_PER_DAY - alreadyThatDay))} left.</p>
            )}
          </section>

          {/* 4. Description */}
          <section className="lw-card" aria-labelledby="lw-desc-title">
            <h3 id="lw-desc-title"><Icon name="file" size={15} /> Work detail</h3>
            <label className="lw-label" htmlFor="lw-description"><span className="lw-required">*</span> Notes</label>
            <textarea id="lw-description" className={`lw-input lw-textarea ${show.description ? 'lw-invalid' : ''}`} rows={4} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe the work you did..." />
            {show.description && <p className="lw-error" role="alert">{check.errors.description}</p>}
          </section>
          {serverError && <p className="lw-error lw-server-error" role="alert">{serverError}</p>}
        </div>

        {/* 5. Actions */}
        <footer className="lw-foot">
          <button type="button" className="lw-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="lw-button is-primary" disabled={saving || (submitted && blocked) || Boolean(check.errors.daily) || (durationTouched && Boolean(check.errors.duration)) || Boolean(show.range)}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </form>
    </div>
  );
}
