import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import UserAvatar from './UserAvatar';
import { searchText } from '../../services/searchText';
import './ChipSelect.css';

/**
 * Searchable multi-select shown as chips (like the Nexus "User" / "User in Field" pickers).
 * options: [{ value, label, sublabel?, user? }] — `user` adds an avatar.
 * The option list opens on focus, filters as you type and is rendered in a portal, so a
 * scrolling dialog never clips it.
 */
export default function ChipSelect({
  options = [],
  value = [],
  onChange = () => {},
  placeholder = 'Select',
  ariaLabel,
  chipLabel = (option) => option.label,
  emptyText = 'No matches',
  disabled = false,
  id
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState(null);
  const fieldRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const byValue = new Map(options.map((option) => [option.value, option]));
  const needle = searchText(query).trim();
  const available = options.filter((option) => !value.includes(option.value)
    && (!needle || needle.split(/\s+/).every((word) => searchText(`${option.label} ${option.sublabel || ''}`).includes(word))));
  const activeIndex = Math.min(active, Math.max(available.length - 1, 0));
  const listId = `${id || 'chip-select'}-list`;

  const place = useCallback(() => {
    const field = fieldRef.current;
    if (!field) return;
    const rect = field.getBoundingClientRect();
    const height = Math.min(listRef.current?.offsetHeight || 220, 240);
    const below = window.innerHeight - rect.bottom;
    const up = below < height + 12 && rect.top > below;
    setPosition({ left: rect.left, width: rect.width, top: up ? rect.top - height - 4 : rect.bottom + 4, up });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place, query, value.length]);

  useEffect(() => {
    if (!open) return undefined;
    const onScroll = (event) => { if (!listRef.current?.contains(event.target)) place(); };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', onScroll, true); };
  }, [open, place]);

  function pick(option) {
    onChange([...value, option.value]);
    setQuery('');
    setActive(0);
    inputRef.current?.focus();
  }

  // Removing a chip does not reopen the list (it would cover the fields below).
  function remove(optionValue) {
    onChange(value.filter((item) => item !== optionValue));
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive((index) => Math.min(index + 1, available.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
    else if (event.key === 'Enter') { event.preventDefault(); if (open && available[activeIndex]) pick(available[activeIndex]); }
    else if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false); }
    else if (event.key === 'Backspace' && !query && value.length) onChange(value.slice(0, -1));
  }

  return (
    <>
      <div
        ref={fieldRef}
        className={`cs-field ${open ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''}`}
        onMouseDown={(event) => {
          if (disabled || event.target.closest('.cs-chip')) return;
          if (event.target !== inputRef.current) event.preventDefault();
          inputRef.current?.focus();
          setOpen(true);
        }}
      >
        <div className="cs-values">
          {value.map((item) => {
            const option = byValue.get(item) || { value: item, label: item };
            return (
              <span className="cs-chip" key={item}>
                {option.user && <UserAvatar user={option.user} size={18} />}
                <span className="cs-chip-label">{chipLabel(option)}</span>
                {!disabled && <button type="button" onClick={() => remove(item)} aria-label={`Remove ${option.label}`}><Icon name="close" size={10} /></button>}
              </span>
            );
          })}
          <input
            id={id}
            ref={inputRef}
            value={query}
            disabled={disabled}
            onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(0); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
            placeholder={value.length ? '' : placeholder}
            role="combobox"
            aria-label={ariaLabel}
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && available[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          />
        </div>
        <Icon name="chevron" size={14} className="cs-chevron" />
      </div>
      {open && !disabled && createPortal(
        <ul
          ref={listRef}
          id={listId}
          className={`cs-list ${position?.up ? 'is-up' : ''}`}
          role="listbox"
          aria-label={ariaLabel}
          style={position ? { left: position.left, top: position.top, width: position.width } : { visibility: 'hidden' }}
          onMouseDown={(event) => event.preventDefault()}
        >
          {available.length ? available.map((option, index) => (
            <li
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={`cs-option ${index === activeIndex ? 'is-active' : ''}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => pick(option)}
            >
              {option.user && <UserAvatar user={option.user} size={24} />}
              <span className="cs-option-text">
                <strong>{option.label}</strong>
                {option.sublabel && <small>{option.sublabel}</small>}
              </span>
            </li>
          )) : <li className="cs-empty" role="status">{query.trim() ? emptyText : value.length ? 'Everything is already selected.' : emptyText}</li>}
        </ul>,
        document.body
      )}
    </>
  );
}
