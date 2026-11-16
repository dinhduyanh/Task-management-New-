import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import './DatePicker.css';

import {
  MONTHS, MONTHS_SHORT, POPOVER_WIDTH, WEEKDAYS, WEEKDAY_NAMES,
  addDays, addMonths, formatDisplayDate, parseIso, sameDay, startOfDay, toIso
} from './dateUtils';

/** The 42 days shown for a month (weeks start on Monday). */
function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => new Date(year, month, 1 - offset + index));
}

/**
 * Calendar popup anchored to an element (`anchorEl`). Rendered in a portal with fixed positioning so
 * tables, drawers and modals never clip it; opens above the anchor when there is no room below.
 */
export function CalendarPopover({ anchorEl, value, min, max, onSelect, onClose, allowClear = true }) {
  const selected = parseIso(value);
  const minDate = parseIso(min);
  const maxDate = parseIso(max);
  const today = startOfDay(new Date());
  const [cursor, setCursor] = useState(() => selected || (maxDate && today > maxDate ? maxDate : minDate && today < minDate ? minDate : today));
  const [view, setView] = useState('days'); // days | months
  const [position, setPosition] = useState(null);
  const popoverRef = useRef(null);
  const gridRef = useRef(null);

  const outOfRange = useCallback((date) => (minDate && date < minDate) || (maxDate && date > maxDate), [minDate, maxDate]);

  const place = useCallback(() => {
    const anchor = anchorEl;
    const popover = popoverRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const height = popover ? popover.offsetHeight : 360;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow < height + 12 && rect.top > height + 12 ? rect.top - height - 6 : Math.min(rect.bottom + 6, Math.max(8, window.innerHeight - height - 8));
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - POPOVER_WIDTH - 8));
    setPosition({ top, left });
  }, [anchorEl]);

  useLayoutEffect(() => {
    place();
  }, [place, view]);

  useEffect(() => {
    const onPointer = (event) => {
      if (popoverRef.current?.contains(event.target) || anchorEl?.contains(event.target)) return;
      onClose();
    };
    const onScroll = (event) => { if (!popoverRef.current?.contains(event.target)) place(); };
    document.addEventListener('mousedown', onPointer);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [anchorEl, onClose, place]);

  // Keep keyboard focus on the highlighted day.
  useEffect(() => {
    if (view !== 'days') return;
    gridRef.current?.querySelector('[data-cursor="true"]')?.focus({ preventScroll: true });
  }, [cursor, view, position]);

  const days = useMemo(() => monthGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);

  function choose(date) {
    if (outOfRange(date)) return;
    onSelect(toIso(date));
    onClose(true);
  }

  function onKeyDown(event) {
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(true); return; }
    if (view !== 'days') return;
    if (moves[event.key]) { event.preventDefault(); setCursor((current) => addDays(current, moves[event.key])); }
    else if (event.key === 'PageUp') { event.preventDefault(); setCursor((current) => addMonths(current, event.shiftKey ? -12 : -1)); }
    else if (event.key === 'PageDown') { event.preventDefault(); setCursor((current) => addMonths(current, event.shiftKey ? 12 : 1)); }
    else if (event.key === 'Home') { event.preventDefault(); setCursor((current) => addDays(current, -((current.getDay() + 6) % 7))); }
    else if (event.key === 'End') { event.preventDefault(); setCursor((current) => addDays(current, 6 - ((current.getDay() + 6) % 7))); }
    else if (event.key === 'Enter' || event.key === ' ') { if (event.target.dataset.day) { event.preventDefault(); choose(cursor); } }
  }

  return createPortal(
    <div
      ref={popoverRef}
      className="dp-popover"
      role="dialog"
      aria-label="Choose date"
      style={position ? { top: position.top, left: position.left } : { visibility: 'hidden' }}
      onKeyDown={onKeyDown}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="dp-head">
        <button type="button" className="dp-nav" onClick={() => setCursor((current) => addMonths(current, view === 'days' ? -1 : -12))} aria-label={view === 'days' ? 'Previous month' : 'Previous year'}>
          <Icon name="chevron" size={15} />
        </button>
        <button type="button" className="dp-title" onClick={() => setView(view === 'days' ? 'months' : 'days')} aria-label={view === 'days' ? 'Choose month and year' : 'Back to days'}>
          {view === 'days' ? <>{MONTHS[cursor.getMonth()]} <span>{cursor.getFullYear()}</span></> : <span>{cursor.getFullYear()}</span>}
          <Icon name="chevron" size={12} />
        </button>
        <button type="button" className="dp-nav is-next" onClick={() => setCursor((current) => addMonths(current, view === 'days' ? 1 : 12))} aria-label={view === 'days' ? 'Next month' : 'Next year'}>
          <Icon name="chevron" size={15} />
        </button>
      </div>

      {view === 'days' ? (
        <div className="dp-body" key={`${cursor.getFullYear()}-${cursor.getMonth()}`}>
          <div className="dp-weekdays" aria-hidden="true">
            {WEEKDAYS.map((day, index) => <span key={day} className={index > 4 ? 'is-weekend' : ''}>{day}</span>)}
          </div>
          <div className="dp-grid" role="grid" ref={gridRef}>
            {days.map((date) => {
              const inMonth = date.getMonth() === cursor.getMonth();
              const disabled = outOfRange(date);
              const isSelected = sameDay(date, selected);
              const isCursor = sameDay(date, cursor);
              const classes = [
                'dp-day',
                inMonth ? '' : 'is-outside',
                sameDay(date, today) ? 'is-today' : '',
                isSelected ? 'is-selected' : '',
                date.getDay() === 0 || date.getDay() === 6 ? 'is-weekend' : '',
                disabled ? 'is-disabled' : ''
              ].filter(Boolean).join(' ');
              return (
                <button
                  key={toIso(date)}
                  type="button"
                  role="gridcell"
                  className={classes}
                  data-day={toIso(date)}
                  data-cursor={isCursor ? 'true' : undefined}
                  tabIndex={isCursor ? 0 : -1}
                  aria-selected={isSelected}
                  aria-disabled={disabled || undefined}
                  aria-label={`${WEEKDAY_NAMES[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}${sameDay(date, today) ? ' (today)' : ''}`}
                  onClick={() => choose(date)}
                  onMouseEnter={() => { if (!disabled && inMonth) setCursor(date); }}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="dp-months" role="grid">
          {MONTHS_SHORT.map((month, index) => (
            <button
              key={month}
              type="button"
              className={`dp-month ${index === cursor.getMonth() ? 'is-cursor' : ''} ${selected && selected.getFullYear() === cursor.getFullYear() && selected.getMonth() === index ? 'is-selected' : ''} ${today.getFullYear() === cursor.getFullYear() && today.getMonth() === index ? 'is-today' : ''}`}
              onClick={() => { setCursor((current) => new Date(current.getFullYear(), index, Math.min(current.getDate(), new Date(current.getFullYear(), index + 1, 0).getDate()))); setView('days'); }}
            >
              {month}
            </button>
          ))}
        </div>
      )}

      <div className="dp-foot">
        <button type="button" className="dp-link" onClick={() => (outOfRange(today) ? setCursor(today) : choose(today))}>Today</button>
        <span className="dp-selected">{selected ? `${WEEKDAY_NAMES[selected.getDay()].slice(0, 3)}, ${formatDisplayDate(value)}` : 'No date'}</span>
        {allowClear && <button type="button" className="dp-link is-muted" onClick={() => { onSelect(''); onClose(true); }} disabled={!value}>Clear</button>}
      </div>
    </div>,
    document.body
  );
}

/**
 * Date field: a button showing the date (and a clear button) that opens the calendar.
 * `renderTrigger({ ref, open, toggle, label })` replaces the default field look.
 */
export default function DatePicker({
  value = '',
  onChange = () => {},
  min,
  max,
  placeholder = 'Select date',
  ariaLabel = 'Choose date',
  disabled = false,
  clearable = true,
  className = '',
  id,
  renderTrigger = null
}) {
  const [open, setOpen] = useState(false);
  // The trigger element (kept in state so custom triggers can receive a plain callback ref).
  const [anchorEl, setAnchorEl] = useState(null);
  const label = formatDisplayDate(value);
  const toggle = () => { if (!disabled) setOpen((current) => !current); };
  const close = useCallback((restoreFocus) => {
    setOpen(false);
    if (restoreFocus) anchorEl?.querySelector?.('button, [tabindex]')?.focus?.();
  }, [anchorEl]);

  return (
    <>
      {renderTrigger ? renderTrigger({ ref: setAnchorEl, open, toggle, label, disabled }) : (
        <div ref={setAnchorEl} className={`dp-field ${open ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''} ${className}`}>
          <button
            id={id}
            type="button"
            className="dp-field-button"
            onClick={toggle}
            disabled={disabled}
            aria-label={label ? `${ariaLabel}: ${label}` : ariaLabel}
            aria-haspopup="dialog"
            aria-expanded={open}
          >
            <Icon name="calendar" size={15} />
            <span className={label ? 'dp-value' : 'dp-placeholder'}>{label || placeholder}</span>
          </button>
          {clearable && value && !disabled && (
            <button type="button" className="dp-clear" onClick={() => onChange('')} aria-label={`Clear ${ariaLabel}`} title="Clear"><Icon name="close" size={12} /></button>
          )}
        </div>
      )}
      {open && <CalendarPopover anchorEl={anchorEl} value={value} min={min} max={max} onSelect={onChange} onClose={close} allowClear={clearable} />}
    </>
  );
}
