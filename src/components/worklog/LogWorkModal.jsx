import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../common/Icon';
import DatePicker from '../common/DatePicker';
import { api } from '../../services/api';
import { iconForType, issueKey, issueSummary, issueType } from '../../pages/SpacesList/issueHelpers';
import {
  MAX_MINUTES_PER_DAY, MAX_RANGE_DAYS, countDays, formatDay, formatDuration, parseDay, toMinutes, validateWorkLog
} from '../../../shared/worklog';
import './LogWorkModal.css';

const QUICK_HOURS = [1, 2, 4, 8];

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Log work on a work item: task info, one day or a From..To range (max 31 days),
 * hours + minutes per day (max 12h a day, together with what was already logged that
 * day), a description, Cancel / Save. onSaved(result) receives the updated list.
 */
export default function LogWorkModal({ issue, space, onClose, onSaved }) {
  const [mode, setMode] = useState('one'); // one | range
  const [day, setDay] = useState(today);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');
  const [description, setDescription] = useState('');
  const [existing, setExisting] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState('');
  const [saving, setSaving] = useState(false);
  const hoursRef = useRef(null);

  const from = mode === 'one' ? day : fromDate;
  const to = mode === 'one' ? day : toDate;
  const check = useMemo(() => validateWorkLog({ fromDate: from, toDate: to, hours, minutes, description }, existing), [from, to, hours, minutes, description, existing]);
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

  function switchMode(next) {
    if (next === mode) return;
    if (next === 'range') { setFromDate(day); setToDate(day); } else setDay(fromDate);
    setMode(next);
  }

  async function save(event) {
    event.preventDefault();
    setSubmitted(true);
    setServerError('');
    if (!check.ok) return;
    setSaving(true);
    try {
      const result = await api.createWorkLog(issue.id, { fromDate: from, toDate: to, hours: hours === '' ? 0 : Number(hours), minutes: minutes === '' ? 0 : Number(minutes), description: description.trim() });
      onSaved?.(result);
    } catch (error) {
      setServerError(error.message || 'Could not save the work log.');
      setSaving(false);
    }
  }

  const type = issueType(issue);
  const days = check.dates.length;
  const alreadyThatDay = mode === 'one' ? Number(existing[day]) || 0 : 0;
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
            <div className="lw-segment" role="tablist" aria-label="Days">
              <button type="button" role="tab" aria-selected={mode === 'one'} className={mode === 'one' ? 'is-active' : ''} onClick={() => switchMode('one')}>One day</button>
              <button type="button" role="tab" aria-selected={mode === 'range'} className={mode === 'range' ? 'is-active' : ''} onClick={() => switchMode('range')}>Multiple days</button>
            </div>
            {mode === 'one' ? (
              <div className="lw-field">
                <label className="lw-label" htmlFor="lw-day"><span className="lw-required">*</span> Work date</label>
                <DatePicker id="lw-day" value={day} onChange={(value) => setDay(value || '')} ariaLabel="Work date" className={show.range ? 'lw-invalid' : ''} />
              </div>
            ) : (
              <div className="lw-row">
                <div className="lw-field">
                  <label className="lw-label" htmlFor="lw-from"><span className="lw-required">*</span> From</label>
                  <DatePicker id="lw-from" value={fromDate} onChange={(value) => setFromDate(value || '')} ariaLabel="From date" className={show.range ? 'lw-invalid' : ''} />
                </div>
                <div className="lw-field">
                  <label className="lw-label" htmlFor="lw-to"><span className="lw-required">*</span> To</label>
                  <DatePicker id="lw-to" value={toDate} onChange={(value) => setToDate(value || '')} ariaLabel="To date" className={show.range ? 'lw-invalid' : ''} />
                </div>
              </div>
            )}
            {show.range && <p className="lw-error" role="alert">{check.errors.range}</p>}
            {mode === 'range' && !check.errors.range && days > 0 && (
              <p className="lw-summary" role="status">
                <Icon name="info" size={13} />
                Áp dụng cho <strong>{days} ngày</strong>: {formatDay(from)} - {formatDay(to)}
                {!check.errors.duration && perDay > 0 && <> · {formatDuration(perDay)}/ngày · tổng <strong>{formatDuration(check.totalMinutes)}</strong></>}
              </p>
            )}
            <p className="lw-hint">Tối đa {MAX_RANGE_DAYS} ngày (1 tháng) mỗi lần log.</p>
          </section>

          {/* 3. Hours */}
          <section className="lw-card" aria-labelledby="lw-hours-title">
            <h3 id="lw-hours-title"><Icon name="clock" size={15} /> Time spent {mode === 'range' && <small>(mỗi ngày)</small>}</h3>
            <div className="lw-row">
              <div className="lw-field">
                <label className="lw-label" htmlFor="lw-hours"><span className="lw-required">*</span> Hours</label>
                <input id="lw-hours" ref={hoursRef} className={`lw-input ${show.duration || show.daily ? 'lw-invalid' : ''}`} type="number" inputMode="decimal" min="0" max="12" step="0.25" value={hours} onChange={(event) => setHours(event.target.value)} placeholder="0" />
              </div>
              <div className="lw-field">
                <label className="lw-label" htmlFor="lw-minutes">Minutes</label>
                <input id="lw-minutes" className={`lw-input ${show.duration || show.daily ? 'lw-invalid' : ''}`} type="number" inputMode="numeric" min="0" step="5" value={minutes} onChange={(event) => setMinutes(event.target.value)} placeholder="0" />
              </div>
            </div>
            <div className="lw-quick" role="group" aria-label="Quick select">
              <span>Quick select</span>
              {QUICK_HOURS.map((value) => (
                <button key={value} type="button" className={String(hours) === String(value) && !Number(minutes) ? 'is-active' : ''} onClick={() => { setHours(String(value)); setMinutes(''); }}>{value}h</button>
              ))}
            </div>
            {!Number.isNaN(perDay) && Number(minutes) >= 60 && <p className="lw-note">= {formatDuration(perDay)}</p>}
            {show.duration && <p className="lw-error" role="alert">{check.errors.duration}</p>}
            {!show.duration && show.daily && <p className="lw-error" role="alert">{check.errors.daily}</p>}
            {mode === 'one' && alreadyThatDay > 0 && !show.daily && (
              <p className="lw-note">Bạn đã log {formatDuration(alreadyThatDay)} vào ngày này · còn tối đa {formatDuration(Math.max(0, MAX_MINUTES_PER_DAY - alreadyThatDay))}.</p>
            )}
          </section>

          {/* 4. Description */}
          <section className="lw-card" aria-labelledby="lw-desc-title">
            <h3 id="lw-desc-title"><Icon name="file" size={15} /> Work detail</h3>
            <label className="lw-label" htmlFor="lw-description"><span className="lw-required">*</span> Notes</label>
            <textarea id="lw-description" className={`lw-input lw-textarea ${show.description ? 'lw-invalid' : ''}`} rows={4} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Nhập nội dung công việc đã thực hiện..." />
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
