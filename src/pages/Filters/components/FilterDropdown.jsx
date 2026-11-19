import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../components/common/Icon';
import PersonAvatar from '../../../components/common/PersonAvatar';
import { searchText } from '../../../services/searchText';

const USER_LIMIT = 10;
const collator = new Intl.Collator('vi', { sensitivity: 'base' });

/**
 * "Label | All ⌄" filter pill with a searchable multi-select menu (rendered in a portal so
 * the toolbar never clips it).
 * options: [{ value, label, sublabel?, icon?, user?, isCurrentUser?, aliases? }]
 * people: user lists keep the current user first (with a label), sort the others A→Z and
 * show at most 10 at a time; typing filters them live (accents ignored).
 * single: one value only (Order by).
 */
export default function FilterDropdown({
  label,
  options = [],
  value = [],
  onChange,
  people = false,
  single = false,
  searchable = true,
  emptyText = 'No matches',
  renderOption = null,
  testId
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const inputRef = useRef(null);
  const selected = single ? [value].filter(Boolean) : value;

  const visible = useMemo(() => {
    const needle = searchText(query).trim();
    const matches = (option) => !needle || needle.split(/\s+/).every((word) => searchText(`${option.label} ${option.sublabel || ''} ${(option.aliases || []).join(' ')}`).includes(word));
    let list = options.filter(matches);
    if (people) {
      const pinned = list.filter((option) => option.isCurrentUser || option.pinned);
      const rest = list.filter((option) => !option.isCurrentUser && !option.pinned).sort((a, b) => collator.compare(a.label, b.label));
      list = [...pinned, ...rest].slice(0, USER_LIMIT);
    }
    return list;
  }, [options, query, people]);
  const hiddenCount = people ? Math.max(0, options.filter((option) => !option.pinned).length - visible.filter((option) => !option.pinned).length) : 0;

  const place = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(240, rect.width);
    const left = Math.min(rect.left, window.innerWidth - width - 8);
    setPosition({ top: rect.bottom + 4, left: Math.max(8, left), width });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (triggerRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKey = (event) => { if (event.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); } };
    const onScroll = (event) => { if (!menuRef.current?.contains(event.target)) place(); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  function toggle(optionValue) {
    if (single) { onChange(optionValue); setOpen(false); return; }
    onChange(selected.includes(optionValue) ? selected.filter((item) => item !== optionValue) : [...selected, optionValue]);
  }

  const byValue = new Map(options.map((option) => [option.value, option]));
  const summary = single
    ? (byValue.get(value)?.label || value || 'All')
    : !selected.length ? 'All'
      : selected.length === 1 ? (byValue.get(selected[0])?.shortLabel || byValue.get(selected[0])?.label || selected[0])
        : `${byValue.get(selected[0])?.shortLabel || byValue.get(selected[0])?.label || selected[0]} +${selected.length - 1}`;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`fs-pill ${open ? 'is-open' : ''} ${!single && selected.length ? 'has-value' : ''}`}
        onClick={() => { setOpen((current) => !current); setQuery(''); }}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={testId}
      >
        <span className="fs-pill-label">{label}</span>
        <span className="fs-pill-value" title={summary}>{summary}</span>
        <Icon name="chevron" size={13} />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="fs-menu"
          style={position ? { top: position.top, left: position.left, minWidth: position.width } : { visibility: 'hidden' }}
          role="dialog"
          aria-label={label}
        >
          {searchable && (
            <div className="fs-menu-search">
              <Icon name="search" size={14} />
              <input
                ref={inputRef}
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={people ? 'Search people' : `Search ${label.toLowerCase()}`}
                aria-label={`Search ${label}`}
              />
              {query && <button type="button" onClick={() => { setQuery(''); inputRef.current?.focus(); }} aria-label="Clear search"><Icon name="close" size={11} /></button>}
            </div>
          )}
          <ul className="fs-menu-list" role="listbox" aria-multiselectable={!single || undefined} aria-label={label}>
            {visible.map((option) => {
              const checked = selected.includes(option.value);
              return (
                <li key={option.value} role="option" aria-selected={checked}>
                  <button type="button" className={`fs-option ${checked ? 'is-selected' : ''}`} onClick={() => toggle(option.value)}>
                    {!single && <span className="fs-check" aria-hidden="true">{checked && <Icon name="check" size={11} />}</span>}
                    {option.user && <PersonAvatar person={option.user} className="fs-avatar" />}
                    {renderOption ? renderOption(option) : option.icon}
                    <span className="fs-option-text">
                      <span className="fs-option-label">{option.label}{option.isCurrentUser && <span className="fs-current-tag">(Current user)</span>}</span>
                      {option.sublabel && <small>{option.sublabel}</small>}
                    </span>
                    {single && checked && <Icon name="check" size={13} className="fs-single-check" />}
                  </button>
                </li>
              );
            })}
            {!visible.length && <li className="fs-menu-empty" role="status">{query ? emptyText : 'Nothing to choose yet'}</li>}
          </ul>
          {people && hiddenCount > 0 && <p className="fs-menu-hint">Showing {USER_LIMIT} people. Type a name to find others.</p>}
          {!single && selected.length > 0 && (
            <div className="fs-menu-foot">
              <span>{selected.length} selected</span>
              <button type="button" onClick={() => onChange([])}>Clear</button>
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
