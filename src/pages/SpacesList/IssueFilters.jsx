import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/common/Icon';
import PriorityIcon from '../../components/common/PriorityIcon';
import { EXTRA_FIELDS, ORDER_OPTIONS, PRIORITIES } from './issueHelpers';
import './SpacesList.css';

// Closes a popover when the user clicks outside it or presses Escape.
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => { if (!ref.current?.contains(event.target)) setOpen(false); };
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return [open, setOpen, ref];
}

export function MultiFilter({ label, options, selected, onChange, width = 190, showPriorityIcons = false }) {
  const [open, setOpen, ref] = usePopover();
  const [query, setQuery] = useState('');
  const shown = options.filter((option) => option.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="slv-filter-wrap" ref={ref}>
      <button type="button" className={`slv-filter-pill ${open ? 'is-open' : ''}`} onClick={() => { setOpen((value) => !value); setQuery(''); }}>
        <span>{label}</span><b>{selected.length ? selected.length : 'All'}</b><Icon name="chevron" size={13} />
      </button>
      {open && <div className="slv-popover" style={{ width }}>
        <div className="slv-popover-search"><Icon name="search" size={14} /><input autoFocus placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <div className="slv-popover-options">
          {shown.length ? shown.map((option) => <label className="slv-option" key={option}><input type="checkbox" checked={selected.includes(option)} onChange={() => onChange(selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option])} />{showPriorityIcons && <PriorityIcon priority={option} size={16} />}<span>{option}</span></label>) : <div className="slv-no-options">No options found</div>}
        </div>
        <div className="slv-popover-footer"><button type="button" onClick={() => onChange([])}>Clear</button><button type="button" className="primary-link" onClick={() => setOpen(false)}>Done</button></div>
      </div>}
    </div>
  );
}

export function OrderFilter({ value, onChange }) {
  const [open, setOpen, ref] = usePopover();
  const [query, setQuery] = useState('');
  const shown = ORDER_OPTIONS.filter((item) => item.toLowerCase().includes(query.toLowerCase()));
  return <div className="slv-filter-wrap" ref={ref}>
    <button type="button" className={`slv-filter-pill ${open ? 'is-open' : ''}`} onClick={() => { setOpen((v) => !v); setQuery(''); }}><span>Order by</span><b>{value}</b><Icon name="chevron" size={13} /></button>
    {open && <div className="slv-popover slv-order-popover">
      <div className="slv-popover-search"><Icon name="search" size={14} /><input autoFocus placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      <div className="slv-popover-options">{shown.map((item) => <button type="button" key={item} className={`slv-single-option ${value === item ? 'selected' : ''}`} onClick={() => { onChange(item); setOpen(false); }}>{item}{value === item && <Icon name="check" size={14} />}</button>)}</div>
    </div>}
  </div>;
}

export function MoreFilters({ selected, onChange }) {
  const [open, setOpen, ref] = usePopover();
  const [query, setQuery] = useState('');
  const shown = EXTRA_FIELDS.filter((field) => field.toLowerCase().includes(query.toLowerCase()));
  return <div className="slv-filter-wrap" ref={ref}>
    <button type="button" className={`slv-filter-pill ${open ? 'is-open' : ''}`} onClick={() => { setOpen((v) => !v); setQuery(''); }}>More filters{selected.length > 0 && <b className="slv-count">{selected.length}</b>}<Icon name="chevron" size={13} /></button>
    {open && <div className="slv-popover slv-more-popover">
      <div className="slv-popover-search"><Icon name="search" size={14} /><input autoFocus placeholder="Search fields" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      <div className="slv-popover-options">{shown.map((field) => <label className="slv-option" key={field}><input type="checkbox" checked={selected.includes(field)} onChange={() => onChange(selected.includes(field) ? selected.filter((item) => item !== field) : [...selected, field])} /><span>{field}</span></label>)}</div>
      <div className="slv-popover-footer"><button type="button" onClick={() => onChange([])}>Clear</button><button type="button" className="primary-link" onClick={() => setOpen(false)}>Done</button></div>
    </div>}
  </div>;
}

/** Date-range and priority controls for the fields picked in "More filters". */
export function ExtraFilterControls({ moreFields, dateRanges, onDateRangesChange, priorities, onPrioritiesChange, onRemoveField }) {
  return <>
    {moreFields.filter((field) => field !== 'Priority').map((field) => <div className="slv-date-filter" key={field}><span>{field}</span><input type="date" value={dateRanges[field]?.from || ''} aria-label={`${field} from`} onChange={(event) => onDateRangesChange({ ...dateRanges, [field]: { ...dateRanges[field], from: event.target.value } })} /><span>to</span><input type="date" value={dateRanges[field]?.to || ''} aria-label={`${field} to`} onChange={(event) => onDateRangesChange({ ...dateRanges, [field]: { ...dateRanges[field], to: event.target.value } })} /><button type="button" onClick={() => onRemoveField(field)} aria-label={`Remove ${field}`}>×</button></div>)}
    {moreFields.includes('Priority') && <div className="slv-priority-filter"><MultiFilter label="Priority" options={PRIORITIES} selected={priorities} onChange={onPrioritiesChange} showPriorityIcons /><button type="button" onClick={() => onRemoveField('Priority')} aria-label="Remove priority filter">×</button></div>}
  </>;
}
