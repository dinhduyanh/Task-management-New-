import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../components/common/Icon';
import { searchText } from '../../../services/searchText';
import { FIELDS, FUNCTIONS, classifyTokens, contextAt, fieldByName, formatValue, operatorsFor, validate } from '../../../../shared/tql';

const MAX_SUGGESTIONS = 12;
const DATE_FUNCTIONS = Object.values(FUNCTIONS).filter((fn) => fn.kinds.includes('date'));

function todayText() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Values the user can pick for a field (from GET /filters/meta). */
function valueSuggestions(field, meta, currentUser) {
  if (!field || !meta) return [];
  switch (field.name) {
    case 'project': return meta.projects.map((p) => ({ text: p.code, label: p.code, detail: p.name }));
    case 'status': return meta.statuses.map((name) => ({ text: name, label: name }));
    case 'statusCategory': return meta.statusCategories.map((name) => ({ text: name, label: name }));
    case 'priority': return meta.priorities.map((name) => ({ text: name, label: name }));
    case 'type': return meta.types.map((name) => ({ text: name, label: name }));
    case 'labels': return meta.labels.map((name) => ({ text: name, label: name }));
    case 'sprint': {
      const seen = new Set();
      return meta.sprints.filter((sprint) => !seen.has(sprint.name) && seen.add(sprint.name)).map((sprint) => ({ text: sprint.name, label: sprint.name, detail: sprint.project }));
    }
    case 'assignee':
    case 'creator': {
      const names = new Map();
      meta.users.forEach((user) => names.set(searchText(user.fullName), (names.get(searchText(user.fullName)) || 0) + 1));
      return [
        { text: 'currentUser()', label: 'currentUser()', detail: currentUser?.fullName ? `${currentUser.fullName} (Current user)` : 'The signed-in user', raw: true },
        ...meta.users.filter((user) => String(user.id) !== String(currentUser?.id)).map((user) => ({
          text: names.get(searchText(user.fullName)) > 1 && user.email ? user.email : user.fullName,
          label: user.fullName,
          detail: user.email
        }))
      ];
    }
    default:
      if (field.kind === 'date' || field.kind === 'datetime') {
        return [
          ...DATE_FUNCTIONS.map((fn) => ({ text: `${fn.name}()`, label: `${fn.name}()`, detail: fn.description, raw: true })),
          { text: todayText(), label: todayText(), detail: 'A date (YYYY-MM-DD)' },
          { text: '-7d', label: '-7d', detail: '7 days ago (also +1w, -3h…)', raw: true }
        ];
      }
      return [];
  }
}

/** Suggestions for the cursor position: [{ label, detail, insert, kind }]. */
function buildSuggestions(ctx, meta, currentUser) {
  const field = ctx.field ? fieldByName(ctx.field) : null;
  const items = [];
  const push = (label, insert, kind, detail = '') => items.push({ label, insert, kind, detail });
  switch (ctx.expect) {
    case 'field':
      FIELDS.forEach((f) => push(f.name, `${f.name} `, 'field', f.label));
      push('NOT', 'NOT ', 'keyword', 'Negate the next condition');
      push('(', '(', 'keyword', 'Group conditions');
      push('ORDER BY', 'ORDER BY ', 'keyword', 'Sort the results');
      break;
    case 'operator':
      operatorsFor(field).forEach((op) => {
        const insert = op === 'IN' || op === 'NOT IN' ? `${op} (` : `${op} `;
        push(op, insert, 'operator', { '~': 'contains', '!~': 'does not contain', IN: 'one of', 'NOT IN': 'none of' }[op] || '');
      });
      break;
    case 'isEmpty':
      push('EMPTY', 'EMPTY ', 'operator'); push('NOT EMPTY', 'NOT EMPTY ', 'operator');
      break;
    case 'listStart':
      push('(', '(', 'operator', 'Start the list');
      break;
    case 'value':
      valueSuggestions(field, meta, currentUser).forEach((value) => push(value.label, value.raw ? value.text : formatValue(value.text), 'value', value.detail));
      break;
    case 'listNext':
      push(',', ', ', 'operator', 'Add another value'); push(')', ') ', 'operator', 'Close the list');
      break;
    case 'logic':
      push('AND', 'AND ', 'keyword'); push('OR', 'OR ', 'keyword'); push('ORDER BY', 'ORDER BY ', 'keyword');
      if (ctx.depth > 0) push(')', ') ', 'keyword', 'Close the group');
      break;
    case 'orderBy':
      push('BY', 'BY ', 'keyword');
      break;
    case 'orderField':
      FIELDS.forEach((f) => push(f.name, `${f.name} `, 'field', f.label));
      break;
    case 'orderDirection':
      push('ASC', 'ASC', 'keyword', 'Ascending'); push('DESC', 'DESC', 'keyword', 'Descending'); push(',', ', ', 'operator', 'Then by…');
      break;
    case 'orderNext':
      push(',', ', ', 'operator', 'Then by…');
      break;
    default: break;
  }
  const needle = searchText(ctx.partial.replace(/^["']/, ''));
  if (!needle) return items.slice(0, 40);
  // Exact match first, then words starting with the text (shortest first), then the rest.
  const exact = items.filter((item) => searchText(item.label) === needle);
  const starts = items.filter((item) => !exact.includes(item) && searchText(item.label).startsWith(needle)).sort((a, b) => a.label.length - b.label.length);
  const contains = items.filter((item) => !exact.includes(item) && !starts.includes(item) && (searchText(item.label).includes(needle) || searchText(item.detail).includes(needle)));
  return [...exact, ...starts, ...contains];
}

/** Coloured copy of the query drawn under the transparent textarea. */
function Highlight({ text, error }) {
  const tokens = classifyTokens(text);
  const parts = [];
  let at = 0;
  tokens.forEach((token, index) => {
    if (token.start > at) parts.push(<span key={`g${index}`}>{text.slice(at, token.start)}</span>);
    const bad = error && token.start < error.end && token.end > error.start;
    parts.push(<span key={index} className={`tql-${token.role} ${bad ? 'tql-bad' : ''}`}>{text.slice(token.start, token.end)}</span>);
    at = token.end;
  });
  if (at < text.length) parts.push(<span key="tail">{text.slice(at)}</span>);
  if (error && error.start >= text.length) parts.push(<span key="end" className="tql-bad tql-end"> </span>);
  return <>{parts}{'\n'}</>;
}

/**
 * TQL input with syntax highlighting, auto-complete and validation.
 * Enter runs the query (onSubmit) unless a suggestion is being chosen.
 */
export default function TqlEditor({ value, onChange, onSubmit, meta, currentUser, serverError = null, placeholder, actions = null }) {
  const inputRef = useRef(null);
  const highlightRef = useRef(null);
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState(value.length);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [showErrors, setShowErrors] = useState(Boolean(value));

  const check = useMemo(() => (value.trim() ? validate(value) : { ok: true }), [value]);
  const localError = !check.ok ? check.error : null;
  const error = (showErrors && localError) || (!localError && serverError) || null;

  // Errors appear once the user pauses, not on every keystroke.
  useEffect(() => {
    if (showErrors) return undefined;
    const timer = window.setTimeout(() => setShowErrors(true), 900);
    return () => window.clearTimeout(timer);
  }, [value, showErrors]);

  const ctx = useMemo(() => contextAt(value, caret), [value, caret]);
  const suggestions = useMemo(() => buildSuggestions(ctx, meta, currentUser).slice(0, MAX_SUGGESTIONS), [ctx, meta, currentUser]);
  const open = focused && !dismissed && suggestions.length > 0;
  const activeIndex = Math.min(active, suggestions.length - 1);

  // Grow with the content (up to a few lines).
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = '0px';
    input.style.height = `${Math.min(input.scrollHeight, 132)}px`;
    if (highlightRef.current) highlightRef.current.scrollTop = input.scrollTop;
  }, [value]);

  // Caret to restore right after an inserted suggestion is rendered (before the next key).
  const pendingCaret = useRef(null);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (pendingCaret.current === null || !input) return;
    input.focus();
    input.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [value]);

  function update(next, nextCaret) {
    pendingCaret.current = nextCaret;
    onChange(next);
    setCaret(nextCaret);
    setShowErrors(false);
    setDismissed(false);
    setActive(0);
  }

  function accept(item) {
    const before = value.slice(0, ctx.from);
    const after = value.slice(caret).replace(/^\S*/, ''); // replace the rest of the word being typed
    const spacer = before && !/[\s(]$/.test(before) ? ' ' : '';
    // Inside IN ( ... ) the next character is "," or ")", so no space after a value.
    const insert = item.kind === 'value' && !ctx.inList ? `${item.insert} ` : item.insert;
    update(`${before}${spacer}${insert}${after.replace(/^ /, '')}`, before.length + spacer.length + insert.length);
  }

  function onKeyDown(event) {
    if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
      return;
    }
    // Enter picks a suggestion only while a word is half typed; a finished word runs the search.
    const finished = open && searchText(suggestions[activeIndex]?.label) === searchText(ctx.partial.replace(/^["']/, ''));
    if (open && (event.key === 'Tab' || (event.key === 'Enter' && ctx.partial && !finished))) {
      event.preventDefault();
      accept(suggestions[activeIndex]);
      return;
    }
    if (event.key === 'Escape' && open) { event.preventDefault(); setDismissed(true); return; }
    if (event.key === 'Enter') {
      event.preventDefault();
      setShowErrors(true);
      setDismissed(true);
      onSubmit?.(value);
    }
    if (event.key === ' ' && event.ctrlKey) { event.preventDefault(); setDismissed(false); }
  }

  const syncCaret = (event) => setCaret(event.target.selectionStart ?? value.length);

  return (
    <div className="tql-wrap">
      <div className={`tql-editor ${error ? 'has-error' : ''} ${focused ? 'is-focused' : ''}`}>
        <div className="tql-field">
          <pre ref={highlightRef} className="tql-layer" aria-hidden="true"><Highlight text={value} error={error} /></pre>
          <textarea
            ref={inputRef}
            className="tql-input"
            value={value}
            rows={1}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            placeholder={placeholder}
            aria-label="TQL query"
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={error ? 'tql-error' : undefined}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls="tql-suggestions"
            onChange={(event) => { onChange(event.target.value.replace(/\n/g, ' ')); setShowErrors(false); setDismissed(false); setActive(0); syncCaret(event); }}
            onKeyDown={onKeyDown}
            onKeyUp={(event) => { if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) syncCaret(event); }}
            onClick={(event) => { syncCaret(event); setDismissed(false); }}
            onFocus={(event) => { setFocused(true); syncCaret(event); }}
            onBlur={() => window.setTimeout(() => setFocused(false), 120)}
            onScroll={(event) => { if (highlightRef.current) highlightRef.current.scrollTop = event.target.scrollTop; }}
          />
        </div>
        {actions}
      </div>
      {open && (
        <ul id="tql-suggestions" className="tql-suggestions" role="listbox" aria-label="Suggestions" onMouseDown={(event) => event.preventDefault()}>
          {suggestions.map((item, index) => (
            <li key={`${item.kind}-${item.label}-${index}`} role="option" aria-selected={index === activeIndex}>
              <button type="button" className={`tql-suggestion is-${item.kind} ${index === activeIndex ? 'is-active' : ''}`} onMouseEnter={() => setActive(index)} onClick={() => accept(item)}>
                <span className="tql-suggestion-label">{item.label}</span>
                {item.detail && <small>{item.detail}</small>}
              </button>
            </li>
          ))}
          <li className="tql-suggestions-hint" aria-hidden="true">↑↓ to move · Tab to insert · Enter to search</li>
        </ul>
      )}
      {error && (
        <p id="tql-error" className="tql-error" role="alert">
          <Icon name="info" size={13} />
          <span>{error.message}</span>
          {Number.isFinite(error.start) && <span className="tql-error-pos">(at character {error.start + 1})</span>}
        </p>
      )}
    </div>
  );
}
