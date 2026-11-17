import { useEffect, useMemo, useRef, useState } from 'react';
import Header from '../../components/layout/Header';
import Sidebar from '../../components/layout/Sidebar';
import Icon from '../../components/common/Icon';
import PersonAvatar from '../../components/common/PersonAvatar';
import DatePicker from '../../components/common/DatePicker';
import PriorityIcon from '../../components/common/PriorityIcon';
import { getInitialStatus, getIssueStatus, getTransitionOptions, validateIssueTransition } from './workflows';
import TaskDetailDrawer from './TaskDetailDrawer';
import {
  ISSUE_TYPES, STATUSES, PRIORITIES, ORDER_PRESETS,
  issueKey, issueSummary, issueType, issueTypeOf, assigneeName, dateValue,
  formatDateTime, toDateInputValue, formatDateOnly, getInitials, iconForType,
  matchesIssueFilters, sortIssues
} from './issueHelpers';
import { ExtraFilterControls, MoreFilters, MultiFilter, OrderFilter } from './IssueFilters';
import ProjectHeader from './ProjectHeader';
import { useAppShell } from '../../context/appShellContext';
import { canInSpace, useProjectPermissions, userAsPerson } from '../../services/projectPermissions';
import { api } from '../../services/api';
import { FILE_ACCEPT, formatBytes, validateUploadFile } from '../../services/fileTypes';
import './SpacesList.css';
import './GlobalCreateSearch.css';

const PARENT_TYPES_BY_CHILD = {
  Story: ['Epic', 'Feature'],
  Task: ['Epic', 'Feature'],
  Bug: ['Epic', 'Feature', 'Task'],
  Improvement: ['Epic', 'Feature'],
  'Sub-task': ['Story', 'Task', 'Bug', 'Improvement']
};


function SortHeading({ label, field, sort, onSort }) {
  const active = sort.field === field;
  return <button type="button" className={`slv-sort-heading ${active ? 'active' : ''}`} onClick={() => onSort(field)}><span>{label}</span><svg viewBox="0 0 12 14" width="12" height="14" aria-hidden="true"><path d="M6 1 3 4h6L6 1Z" fill={active && sort.direction === 'asc' ? '#0052CC' : '#A5ADBA'} /><path d="m6 13 3-3H3l3 3Z" fill={active && sort.direction === 'desc' ? '#0052CC' : '#A5ADBA'} /></svg></button>;
}

export function PriorityCell({ value, onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 176 });
  const rootRef = useRef(null);
  const priority = PRIORITIES.includes(value) ? value : 'Medium';

  function toggleMenu(event) {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 176;
    const estimatedHeight = PRIORITIES.length * 35 + 14;
    const top = window.innerHeight - rect.bottom < estimatedHeight + 8
      ? Math.max(8, rect.top - estimatedHeight - 4)
      : rect.bottom + 4;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    setMenuPosition({ top, left, width });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className="slv-priority-picker" ref={rootRef}>
      <button
        type="button"
        className={`slv-priority-trigger ${open ? 'is-open' : ''}`}
        onClick={toggleMenu}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Change priority, current priority ${priority}`}
      >
        <span className="slv-priority">
          <PriorityIcon priority={priority} size={16} />
          <span>{priority}</span>
        </span>
        <Icon name="chevron" size={12} />
      </button>
      {open && (
        <div
          className="slv-priority-menu"
          style={{ position: 'fixed', top: menuPosition.top, left: menuPosition.left, width: menuPosition.width }}
          role="listbox"
          aria-label="Choose priority"
        >
          {PRIORITIES.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={priority === option}
              key={option}
              className={`slv-priority-option ${priority === option ? 'selected' : ''}`}
              onClick={() => { onChange(option); setOpen(false); }}
            >
              <PriorityIcon priority={option} size={16} />
              <span>{option}</span>
              {priority === option && <Icon name="check" size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function StatusCell({ issue, allIssues = [], onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 220 });
  const rootRef = useRef(null);
  const status = getIssueStatus(issue);
  const options = getTransitionOptions(issue, allIssues);

  function toggleMenu(event) {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 224;
    const estimatedHeight = Math.min(Math.max(options.length * 38 + 16, 72), 258);
    const top = window.innerHeight - rect.bottom < estimatedHeight + 8
      ? Math.max(8, rect.top - estimatedHeight - 4)
      : rect.bottom + 4;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    setMenuPosition({ top, left, width });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const statusClass = `slv-status-${String(status).toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div className="slv-status-picker" ref={rootRef}>
      <button
        type="button"
        className={`slv-status ${statusClass}`}
        onClick={toggleMenu}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Change status, current status ${status}`}
      >
        <span>{String(status).toUpperCase()}</span>
        <Icon name="chevron" size={11} />
      </button>
      {open && (
        <div
          className="slv-status-menu"
          style={{ position: 'fixed', top: menuPosition.top, left: menuPosition.left, width: menuPosition.width }}
          role="listbox"
          aria-label={`Available workflow transitions for ${issueType(issue)}`}
        >
          {options.length ? options.map((option) => {
            const optionClass = `slv-status-${option.status.toLowerCase().replace(/\s+/g, '-')}`;
            return (
              <button
                type="button"
                role="option"
                aria-selected={false}
                aria-disabled={option.disabled || undefined}
                title={option.reason || option.hint || ''}
                key={option.status}
                disabled={option.disabled}
                className={`slv-status-option ${option.disabled ? 'is-disabled' : ''}`}
                onClick={() => {
                  if (option.disabled) return;
                  onChange(option.status);
                  setOpen(false);
                }}
              >
                <span className={`slv-status-dot ${optionClass}`} />
                <span>{option.status}</span>
                {option.hint && <small className="slv-transition-hint">{option.hint}</small>}
                {option.disabled && option.reason && <span className="slv-transition-help" title={option.reason}>i</span>}
              </button>
            );
          }) : (
            <div className="slv-no-transitions">No further transitions available.</div>
          )}
        </div>
      )}
    </div>
  );
}

const MEMBER_NONE = '';

function optionLabel(item) {
  if (typeof item === 'string') return item;
  return item?.name || item?.fullName || item?.title || item?.label || item?.email || '';
}

/** The signed-in user as a person record (the "Current User" option in user pickers). */
function useCurrentUserRecord() {
  const { user } = useAppShell();
  const person = userAsPerson(user) || { id: '', name: 'You', fullName: 'You', email: '' };
  return { ...person, initials: getInitials(person.name), isCurrentUser: true };
}

function getUserId(user) {
  return String(user?.id ?? user?.email ?? user?.username ?? optionLabel(user));
}

// Inline assignee selector. It remains available after assignment so the
// user can reopen it and change or clear the assignee at any time.
export function AssigneeCell({ value, members, onAssign, disabled = false }) {
  const CURRENT_USER = useCurrentUserRecord();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 232 });
  const rootRef = useRef(null);

  function toggleMenu(event) {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 232;
    const estimatedHeight = Math.min(330, 105 + (Array.isArray(members) ? members.length : 0) * 43);
    const top = window.innerHeight - rect.bottom < estimatedHeight + 8
      ? Math.max(8, rect.top - estimatedHeight - 4)
      : rect.bottom + 4;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    setMenuPosition({ top, left, width });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const memberList = Array.isArray(members) ? members : [];
  const currentFromMembers = memberList.find((member) => getUserId(member) === CURRENT_USER.id);
  const currentUser = currentFromMembers
    ? { ...currentFromMembers, ...CURRENT_USER, id: CURRENT_USER.id }
    : CURRENT_USER;
  const seen = new Set([CURRENT_USER.id]);
  const otherUsers = memberList.filter((member) => {
    if (!member || !optionLabel(member)) return false;
    const id = getUserId(member);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const matches = (user) => `${optionLabel(user)} ${user?.email || ''} ${user?.username || ''}`
    .toLowerCase().includes(query.trim().toLowerCase());
  const visibleUsers = otherUsers.filter(matches);
  const showCurrentUser = matches(currentUser);
  const selectedId = value ? getUserId(value) : '';
  const selectedUser = selectedId === CURRENT_USER.id
    ? currentUser
    : otherUsers.find((member) => getUserId(member) === selectedId) || value || null;
  const selectedName = selectedUser
    ? (selectedId === CURRENT_USER.id ? 'You' : optionLabel(selectedUser) || String(selectedUser))
    : 'Unassigned';

  function choose(user) {
    onAssign(user ? {
      id: getUserId(user),
      // Store the real name: "You" is only how the signed-in user sees themself.
      name: optionLabel(user),
      fullName: user.fullName || optionLabel(user),
      email: user?.email || '',
      initials: getInitials(optionLabel(user))
    } : null);
    setOpen(false);
    setQuery('');
  }

  return (
    <div className="slv-assignee-picker" ref={rootRef}>
      <button
        type="button"
        className={`slv-assignee-trigger ${open ? 'is-open' : ''} ${selectedUser ? 'has-assignee' : 'is-unassigned'}`}
        onClick={(event) => { setQuery(''); toggleMenu(event); }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={selectedUser ? `Change assignee, currently ${selectedName}` : 'Assign work item'}
      >
        {selectedUser
          ? <PersonAvatar person={selectedId === CURRENT_USER.id ? CURRENT_USER : selectedUser} className="slv-assignee-avatar" />
          : <span className="slv-assignee-avatar is-empty" aria-hidden="true"><Icon name="user" size={12} /></span>}
        <span className="slv-assignee-name">{selectedName}</span>
        <span className="slv-assignee-action"><Icon name={selectedUser ? 'chevron' : 'plus'} size={13} /></span>
      </button>

      {open && (
        <div className="slv-assignee-menu" style={{ position: 'fixed', top: menuPosition.top, left: menuPosition.left, width: menuPosition.width }} role="listbox" aria-label="Choose assignee">
          <div className="slv-assignee-search">
            <Icon name="search" size={14} />
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" aria-label="Search users" />
          </div>

          <button
            type="button"
            role="option"
            aria-selected={!selectedUser}
            className={`slv-assignee-option slv-assignee-unassigned-option ${!selectedUser ? 'selected' : ''}`}
            onClick={() => choose(null)}
          >
            <span className="slv-assignee-check">{!selectedUser && <Icon name="check" size={11} />}</span>
            <span>Unassigned</span>
          </button>

          {showCurrentUser && (
            <button
              type="button"
              role="option"
              aria-selected={selectedId === CURRENT_USER.id}
              className={`slv-assignee-option current-user ${selectedId === CURRENT_USER.id ? 'selected' : ''}`}
              onClick={() => choose(currentUser)}
            >
              <span className="slv-assignee-check">{selectedId === CURRENT_USER.id && <Icon name="check" size={11} />}</span>
              <span className="slv-assignee-current-icon"><Icon name="user" size={13} /></span>
              <span className="slv-assignee-option-label">Current User</span>
              {selectedId === CURRENT_USER.id && <Icon name="check" size={14} />}
            </button>
          )}

          {visibleUsers.map((member) => {
            const id = getUserId(member);
            const selected = selectedId === id;
            const name = optionLabel(member);
            return (
              <button
                type="button"
                role="option"
                aria-selected={selected}
                className={`slv-assignee-option ${selected ? 'selected' : ''}`}
                key={id}
                onClick={() => choose(member)}
              >
                <span className="slv-assignee-check">{selected && <Icon name="check" size={11} />}</span>
                <PersonAvatar person={member} className="slv-assignee-avatar" />
                <span className="slv-assignee-option-label" title={`${name}${member.email ? ` – ${member.email}` : ''}`}>{name}</span>
                {selected && <Icon name="check" size={14} />}
              </button>
            );
          })}

          {!showCurrentUser && visibleUsers.length === 0 && (
            <div className="slv-assignee-empty">No users match your search.</div>
          )}
          {showCurrentUser && visibleUsers.length === 0 && (
            <div className="slv-assignee-hint" title="Only Current User is available until the system user directory is connected.">Only Current User is available...</div>
          )}
        </div>
      )}
    </div>
  );
}


export function EditableDateCell({ value, onChange, label, disabled = false }) {
  const inputValue = toDateInputValue(value);
  if (disabled) return <span className="slv-inline-date is-readonly">{formatDateOnly(value)}</span>;
  return (
    <DatePicker
      value={inputValue}
      onChange={(next) => onChange(next || null)}
      ariaLabel={label}
      renderTrigger={({ ref, open, toggle }) => (
        <span ref={ref} className="slv-inline-date-wrap">
          <button type="button" className={`slv-inline-date ${open ? 'is-open' : ''}`} onClick={toggle} title={`Choose ${label}`} aria-label={`Choose ${label}`} aria-haspopup="dialog" aria-expanded={open}>
            <span>{formatDateOnly(value)}</span>
            <Icon name="calendar" size={13} />
          </button>
        </span>
      )}
    />
  );
}

function SearchableUserField({ label, value, onChange, members, placeholder, required = false }) {
  const CURRENT_USER = useCurrentUserRecord();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const availableMembers = Array.isArray(members) ? members : [];
  const currentUserFromMembers = availableMembers.find((member) => getUserId(member) === CURRENT_USER.id);
  const currentUser = currentUserFromMembers
    ? { ...CURRENT_USER, ...currentUserFromMembers, id: CURRENT_USER.id, isCurrentUser: true }
    : CURRENT_USER;
  const seen = new Set([CURRENT_USER.id]);
  const otherUsers = availableMembers.filter((member) => {
    const id = getUserId(member);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const matches = (user) => {
    const text = `${optionLabel(user)} ${user?.email || ''} ${user?.username || ''}`.toLowerCase();
    return text.includes(query.trim().toLowerCase());
  };
  const showCurrentUser = matches(currentUser);
  const filteredUsers = otherUsers.filter(matches);
  const selectedUser = value === CURRENT_USER.id
    ? currentUser
    : otherUsers.find((member) => getUserId(member) === String(value));

  function choose(user) {
    onChange(getUserId(user));
    setOpen(false);
    setQuery('');
  }

  return (
    <div className="slv-field">
      <span>{label}{required && <b> *</b>}</span>
      <div className="slv-user-picker" ref={rootRef}>
        <button
          type="button"
          className={`slv-user-picker-trigger ${open ? 'is-open' : ''}`}
          onClick={() => { setOpen((current) => !current); setQuery(''); }}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className={selectedUser ? '' : 'placeholder'}>
            {selectedUser
              ? (value === CURRENT_USER.id ? 'Current User' : optionLabel(selectedUser))
              : placeholder}
          </span>
          <Icon name="chevron" size={14} />
        </button>

        {open && (
          <div className="slv-user-picker-menu" role="listbox">
            <div className="slv-user-picker-search">
              <Icon name="search" size={14} />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search users"
                aria-label={`Search ${label}`}
              />
            </div>

            {showCurrentUser && (
              <button
                type="button"
                role="option"
                aria-selected={value === CURRENT_USER.id}
                className={`slv-user-option current-user ${value === CURRENT_USER.id ? 'selected' : ''}`}
                onClick={() => choose(currentUser)}
              >
                <span className="slv-user-avatar">YO</span>
                <span className="slv-user-option-text">
                  <strong>Current User</strong>
                  <small>{optionLabel(currentUser)}</small>
                </span>
                {value === CURRENT_USER.id && <Icon name="check" size={15} />}
              </button>
            )}

            {filteredUsers.map((user) => {
              const id = getUserId(user);
              const selected = String(value) === id;
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`slv-user-option ${selected ? 'selected' : ''}`}
                  key={id}
                  onClick={() => choose(user)}
                >
                  <PersonAvatar person={user} className="slv-user-avatar" />
                  <span className="slv-user-option-text">
                    <strong>{optionLabel(user)}</strong>
                    {user.email && <small>{user.email}</small>}
                  </span>
                  {selected && <Icon name="check" size={15} />}
                </button>
              );
            })}

            {!showCurrentUser && filteredUsers.length === 0 && (
              <div className="slv-user-picker-empty">
                {otherUsers.length
                  ? 'No users match your search.'
                  : 'No other users are available in this Space yet.'}
              </div>
            )}
            {showCurrentUser && filteredUsers.length === 0 && otherUsers.length === 0 && (
              <div className="slv-user-picker-hint">
                The system user directory will be connected through Backend later.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


function resolveAssigneeRecord(userId, members = [], currentUser = null) {
  if (!userId) return null;
  if (currentUser?.id && String(userId) === currentUser.id) {
    const record = { ...currentUser };
    delete record.isCurrentUser; // a per-viewer flag, never stored
    return record;
  }
  const member = (Array.isArray(members) ? members : []).find((item) => getUserId(item) === String(userId));
  if (!member) return null;
  const name = optionLabel(member);
  return {
    ...member,
    id: getUserId(member),
    name,
    fullName: member.fullName || name,
    email: member.email || '',
    initials: member.initials || getInitials(name),
    isCurrentUser: false
  };
}

/** Asks for an assignee before unassigned work items move to In Progress. Calls onConfirm(assigneeRecord). */
export function StartTransitionModal({ issues, members, assigneeId, onAssigneeChange, onClose, onConfirm }) {
  const CURRENT_USER = useCurrentUserRecord();
  const isBulk = issues.length > 1;
  return (
    <div className="slv-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="slv-modal slv-confirm-modal slv-start-modal" role="dialog" aria-modal="true" aria-labelledby="slv-start-title">
        <div className="slv-modal-head">
          <div>
            <h2 id="slv-start-title">{isBulk ? 'Start work items' : 'Start'}</h2>
            {isBulk && <p>Select one assignee for the unassigned work items.</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="slv-modal-content">
          <SearchableUserField
            label="Assignee"
            value={assigneeId}
            onChange={onAssigneeChange}
            members={members}
            placeholder="Select Assignee"
            required
          />
        </div>
        <div className="slv-modal-foot">
          <button type="button" className="slv-btn secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="slv-btn primary" disabled={!assigneeId} onClick={() => { const assignee = resolveAssigneeRecord(assigneeId, members, CURRENT_USER); if (assignee) onConfirm(assignee); }}>Update</button>
        </div>
      </div>
    </div>
  );
}

function ParentIssueField({ issues = [], value, onChange, required, issueType: childIssueType }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);
  // Normalize the source collection so an empty or malformed issue list cannot crash the modal.
  const safeIssues = Array.isArray(issues)
    ? issues.filter((issue) => issue && typeof issue === 'object')
    : [];

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const selectedIssue = safeIssues.find((issue) => String(issue.id) === String(value));
  const allowedParentTypes = PARENT_TYPES_BY_CHILD[childIssueType] || [];
  const compatibleIssues = safeIssues.filter((issue) => allowedParentTypes.length === 0 || allowedParentTypes.includes(issueTypeOf(issue)));
  const visibleIssues = compatibleIssues.filter((issue) => {
    const label = `${issueKey(issue)} ${issueSummary(issue)} ${issueTypeOf(issue)}`.toLowerCase();
    return label.includes(query.trim().toLowerCase());
  });

  return (
    <div className="slv-field">
      <span>Parent {required && <b>*</b>}</span>
      <div className="slv-parent-picker" ref={rootRef}>
        <button
          type="button"
          className={`slv-parent-picker-trigger ${open ? 'is-open' : ''} ${!selectedIssue ? 'placeholder' : ''}`}
          onClick={() => { setOpen((current) => !current); setQuery(''); }}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span>{selectedIssue ? `${issueKey(selectedIssue)} - ${issueSummary(selectedIssue)}` : 'Select Parent'}</span>
          <Icon name="chevron" size={14} />
        </button>
        {open && (
          <div className="slv-parent-picker-menu" role="listbox">
            <div className="slv-user-picker-search">
              <Icon name="search" size={14} />
              <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search parent work items" />
            </div>
            {visibleIssues.length ? visibleIssues.map((issue) => {
              const selected = String(value) === String(issue.id);
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`slv-parent-option ${selected ? 'selected' : ''}`}
                  key={issue.id}
                  onClick={() => { onChange(String(issue.id)); setOpen(false); }}
                >
                  <strong>{issueKey(issue)}</strong>
                  <span> - {issueSummary(issue)}</span>
                  <small>{issueTypeOf(issue)}</small>
                </button>
              );
            }) : <div className="slv-user-picker-empty">{compatibleIssues.length ? 'No parent work items match your search.' : safeIssues.length ? `No compatible Parent work items are available for ${childIssueType}.` : 'No work items are available to select as Parent.'}</div>}
            {value && <button type="button" className="slv-parent-clear" onClick={() => { onChange(''); setOpen(false); }}>Clear parent</button>}
          </div>
        )}
      </div>
      {required && <small className="slv-field-hint">A Parent must be selected before creating a Sub-task.</small>}
    </div>
  );
}


function ProjectSearchSelect({ spaces = [], value = '', onChange = () => {} }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);
  const selectedSpace = spaces.find((item) => String(item.id) === String(value));
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSpaces = spaces.filter((item) => {
    const name = String(item.name || '').toLowerCase();
    const code = String(item.code || '').toLowerCase();
    const prefix = String(item.taskKeyPrefix || '').toLowerCase();
    return !normalizedQuery || name.includes(normalizedQuery) || code.includes(normalizedQuery) || prefix.includes(normalizedQuery);
  });

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className={`slv-project-picker ${open ? 'is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className={`slv-project-picker-trigger ${selectedSpace ? 'has-value' : ''}`}
        onClick={() => { setOpen((current) => !current); setQuery(''); }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{selectedSpace ? (selectedSpace.name || selectedSpace.code || 'Untitled Space') : 'Select Project'}</span>
        <Icon name="chevron" size={14} />
      </button>
      {open && (
        <div className="slv-project-picker-popover" role="listbox" aria-label="Select Project">
          <div className="slv-project-picker-search">
            <Icon name="search" size={14} />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search Projects"
              aria-label="Search Projects"
            />
          </div>
          <div className="slv-project-picker-options">
            {filteredSpaces.length ? filteredSpaces.map((item) => {
              const active = String(item.id) === String(value);
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  key={item.id}
                  className={`slv-project-picker-option ${active ? 'selected' : ''}`}
                  onClick={() => { onChange(String(item.id)); setOpen(false); setQuery(''); }}
                >
                  <span className="slv-project-picker-option-main">
                    <strong>{item.name || item.code || 'Untitled Space'}</strong>
                    <small>{item.code || item.taskKeyPrefix || 'Project'}</small>
                  </span>
                  {active && <Icon name="check" size={15} />}
                </button>
              );
            }) : <div className="slv-project-picker-empty">No Projects found.</div>}
          </div>
          <div className="slv-project-picker-count">{filteredSpaces.length} of {spaces.length} Projects</div>
        </div>
      )}
    </div>
  );
}

export function IssueModal({ space = {}, spaces = [], allowProjectSelection = false, initialSpaceId = '', existingIssues = [], onClose, onCreate, initialIssueType = '', initialParentId = '', allowedIssueTypes = null }) {
  const availableIssueTypes = Array.isArray(allowedIssueTypes) ? allowedIssueTypes : ISSUE_TYPES;
  const [selectedSpaceId, setSelectedSpaceId] = useState(String(initialSpaceId || space?.id || ''));
  const activeSpace = allowProjectSelection
    ? (spaces || []).find((item) => String(item.id) === String(selectedSpaceId)) || null
    : space;
  const scopedIssues = allowProjectSelection
    ? (Array.isArray(existingIssues) ? existingIssues.filter((issue) => {
        if (!activeSpace) return false;
        const issueSpaceId = issue.spaceId ?? issue.projectId ?? issue.space?.id;
        if (issueSpaceId !== undefined && issueSpaceId !== null && String(issueSpaceId) !== '') {
          return String(issueSpaceId) === String(activeSpace.id);
        }
        const issueSpaceCode = String(issue.spaceCode ?? issue.projectCode ?? '').toLowerCase();
        return Boolean(activeSpace.code && issueSpaceCode === String(activeSpace.code).toLowerCase());
      }) : [])
    : (Array.isArray(existingIssues) ? existingIssues : []);
  const [issueType, setIssueType] = useState(initialIssueType);
  const [form, setForm] = useState({
    title: '',
    description: '',
    priority: 'Medium',
    assigneeId: '',
    teamId: '',
    releaseId: '',
    labels: [],
    labelDraft: '',
    startDate: '',
    dueDate: '',
    linkType: 'Blocks',
    linkedIssueId: '',
    parentId: initialParentId || '',
    attachments: []
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Set when the work item was created but some files failed to upload; the form then only closes.
  const [createdWithErrors, setCreatedWithErrors] = useState(false);
  const { replaceWorkItem } = useAppShell();
  const CURRENT_USER = useCurrentUserRecord();
  // The new work item will have the signed-in user as its Creator ("User in Field" rules).
  const { can: canInActiveSpace } = useProjectPermissions(activeSpace);
  const prospectiveItem = { creatorId: CURRENT_USER.id };
  const mayAssign = canInActiveSpace('task.assign', prospectiveItem);
  const mayLink = canInActiveSpace('task.link', prospectiveItem);
  const mayAttach = canInActiveSpace('attachment.add', prospectiveItem);
  const creatableSpaces = (Array.isArray(spaces) ? spaces : []).filter((item) => canInSpace(item, 'task.create', null, CURRENT_USER));

  const members = Array.isArray(activeSpace?.members) ? activeSpace.members : [];
  // Inactive project teams cannot be chosen for new work items.
  const teams = (Array.isArray(activeSpace?.teams) ? activeSpace.teams : []).filter((team) => team?.status !== 'inactive');
  const releases = Array.isArray(activeSpace?.releases) ? activeSpace.releases : [];
  const memberById = new Map(members.map((member) => [getUserId(member), member]));
  const selectedAssignee = form.assigneeId === CURRENT_USER.id
    ? CURRENT_USER
    : memberById.get(String(form.assigneeId)) || null;
  const selectedTeam = teams.find((item) => String(item.id ?? item) === String(form.teamId));
  const selectedRelease = releases.find((item) => String(item.id ?? item) === String(form.releaseId));
  const parentIssue = scopedIssues.find((issue) => String(issue.id) === String(form.parentId));

  const isEpicOrFeature = issueType === 'Epic' || issueType === 'Feature';
  const showParent = Boolean(issueType) && !isEpicOrFeature;
  const isSubTask = issueType === 'Sub-task';
  const hasConfiguredType = Boolean(issueType && activeSpace);

  function setField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
    setError('');
  }

  function addLabel(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const nextLabel = form.labelDraft.trim();
    if (!nextLabel || form.labels.includes(nextLabel)) return;
    setField('labels', [...form.labels, nextLabel]);
    setField('labelDraft', '');
  }

  async function submit(event) {
    event.preventDefault();

    if (allowProjectSelection && !activeSpace) {
      setError('Please select a Project.');
      return;
    }
    if (!issueType) {
      setError('Please select a Work Type.');
      return;
    }
    if (!availableIssueTypes.includes(issueType)) {
      setError('This work type is not allowed under the selected Parent.');
      return;
    }
    if (!form.title.trim()) {
      setError('Title is required.');
      return;
    }
    if (isSubTask && !form.parentId) {
      setError('Parent is required for a Sub-task.');
      return;
    }
    if (form.startDate && form.dueDate && form.dueDate < form.startDate) {
      setError('Due Date must be on or after Start Date.');
      return;
    }

    const payload = {
      issueType,
      title: form.title.trim(),
      summary: form.title.trim(),
      description: form.description,
      priority: form.priority,
      status: getInitialStatus(issueType),
      assignee: selectedAssignee || null,
      // The server records the signed-in user as Creator.
      creator: CURRENT_USER,
      team: selectedTeam || null,
      labels: form.labels,
      release: selectedRelease || null,
      startDate: form.startDate || null,
      dueDate: form.dueDate || null,
      parent: showParent ? (parentIssue || null) : null,
      parentId: showParent ? (form.parentId || null) : null,
      links: form.linkedIssueId
        ? [{ type: form.linkType, issueId: form.linkedIssueId }]
        : [],
      // Files are uploaded to the created work item below, not sent as JSON.
      attachments: [],
      spaceId: activeSpace.id,
      spaceCode: activeSpace.code
    };

    setSubmitting(true);
    try {
      const created = await onCreate(payload);
      if (created === false || created === null) return;
      const failed = [];
      for (const file of form.attachments) {
        try {
          const result = await api.uploadAttachment(created.id, file);
          replaceWorkItem(result.workItem);
        } catch (uploadError) {
          failed.push(`${file.name} (${uploadError.message})`);
        }
      }
      if (failed.length) {
        setCreatedWithErrors(true);
        setError(`${created.key || 'The work item'} was created, but ${failed.length} file${failed.length === 1 ? '' : 's'} could not be uploaded: ${failed.join(', ')}. You can add them from the work item details.`);
        return;
      }
      onClose();
    } catch (createError) {
      setError(createError?.message || 'Unable to create Work Item. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const relationOptions = ['Blocks', 'Is blocked by', 'Relates to', 'Duplicates', 'Is duplicated by'];
  const linkedIssueOptions = scopedIssues.filter((issue) => issue?.id);
  const compatibleParentIssues = linkedIssueOptions.filter((issue) => {
    const allowedParentTypes = PARENT_TYPES_BY_CHILD[issueType] || [];
    return !allowedParentTypes.length || allowedParentTypes.includes(issueTypeOf(issue));
  });
  const allowedFileTypes = FILE_ACCEPT;

  return (
    <div className="slv-create-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <form className="slv-create-window" onSubmit={submit}>
        <header className="slv-create-header">
          <button type="button" className="slv-create-close" onClick={onClose} aria-label="Close create work item">
            <Icon name="close" size={16} />
          </button>
          <h2>Create work item</h2>
        </header>

        <div className="slv-create-scroll">
          <div className="slv-create-form-column">
            <section className="slv-create-section">
              <h3>General information</h3>
              <div className="slv-create-two-cols">
                <label className="slv-field">
                  <span><b>*</b> Project</span>
                  {allowProjectSelection ? (
                    <ProjectSearchSelect
                      spaces={creatableSpaces}
                      value={selectedSpaceId}
                      onChange={(nextId) => {
                        setSelectedSpaceId(nextId);
                        setIssueType('');
                        setForm({ title: '', description: '', priority: 'Medium', assigneeId: '', teamId: '', releaseId: '', labels: [], labelDraft: '', startDate: '', dueDate: '', linkType: 'Blocks', linkedIssueId: '', parentId: '', attachments: [] });
                        setError('');
                      }}
                    />
                  ) : (
                    <input value={activeSpace?.name || activeSpace?.code || ''} readOnly aria-label="Project" />
                  )}
                </label>
                <label className="slv-field">
                  <span><b>*</b> Work type</span>
                  <select value={issueType} disabled={!activeSpace} onChange={(event) => {
                    const nextType = event.target.value;
                    setIssueType(nextType);
                    if (nextType === 'Epic' || nextType === 'Feature') setField('parentId', '');
                    else setError('');
                  }}>
                    <option value="">Select Work Type</option>
                    {availableIssueTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </label>
              </div>
              {allowProjectSelection && !spaces?.length && (
                <p className="slv-field-hint">No Projects are available. Create a Space before creating a work item.</p>
              )}
            </section>

            {hasConfiguredType && (
              <>
                <section className="slv-create-section">
                  <h3>Priority &amp; description</h3>
                  <div className="slv-field">
                    <span>Priority</span>
                    <div className="slv-priority-choice" role="group" aria-label="Priority">
                      {PRIORITIES.map((priority) => (
                        <button
                          type="button"
                          key={priority}
                          className={form.priority === priority ? 'selected' : ''}
                          onClick={() => setField('priority', priority)}
                        >
                          <PriorityIcon priority={priority} size={15} />
                          <span>{priority}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="slv-field">
                    <span>Title <b>*</b></span>
                    <input
                      autoFocus
                      value={form.title}
                      onChange={(event) => setField('title', event.target.value)}
                      placeholder="Enter title"
                      required
                    />
                  </label>

                  <label className="slv-field slv-description-field">
                    <span>Description</span>
                    <textarea
                      rows="5"
                      value={form.description}
                      onChange={(event) => setField('description', event.target.value)}
                      placeholder="Write a description"
                    />
                  </label>
                </section>

                {showParent && (
                  <section className="slv-create-section">
                    <h3>Parent relationship</h3>
                    <ParentIssueField
                      issues={compatibleParentIssues}
                      value={form.parentId}
                      onChange={(value) => setField('parentId', value)}
                      required={isSubTask}
                      issueType={issueType}
                    />
                  </section>
                )}

                <>
                    <section className="slv-create-section">
                      <h3>Assignment &amp; details</h3>
                      {mayAssign ? (
                        <SearchableUserField
                          label="Assignee"
                          value={form.assigneeId}
                          onChange={(value) => setField('assigneeId', value)}
                          members={members}
                          placeholder="Unassigned"
                        />
                      ) : (
                        <label className="slv-field">
                          <span>Assignee</span>
                          <input value="Unassigned" readOnly aria-label="Assignee" />
                          <small className="slv-field-hint">You do not have the Assign issue permission in this project.</small>
                        </label>
                      )}
                      <label className="slv-field">
                        <span>Creator</span>
                        <input value={CURRENT_USER.name} readOnly aria-label="Creator" />
                        <small className="slv-field-hint">Set automatically to the person who creates the work item.</small>
                      </label>
                      <label className="slv-field">
                        <span>Team</span>
                        <select value={form.teamId} onChange={(event) => setField('teamId', event.target.value)}>
                          <option value="">{teams.length ? 'Select Team' : 'No teams available'}</option>
                          {teams.map((team) => (
                            <option key={team.id || optionLabel(team)} value={team.id ?? team}>
                              {optionLabel(team)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="slv-field slv-label-field">
                        <span>Labels</span>
                        <div className="slv-label-input">
                          {form.labels.map((label) => (
                            <span className="slv-label-chip" key={label}>
                              {label}
                              <button type="button" onClick={() => setField('labels', form.labels.filter((item) => item !== label))} aria-label={`Remove ${label}`}>×</button>
                            </span>
                          ))}
                          <input
                            value={form.labelDraft}
                            onChange={(event) => setField('labelDraft', event.target.value)}
                            onKeyDown={addLabel}
                            placeholder="Enter label and press Enter"
                          />
                        </div>
                      </div>
                      <label className="slv-field">
                        <span>Release</span>
                        <select value={form.releaseId} onChange={(event) => setField('releaseId', event.target.value)}>
                          <option value="">{releases.length ? 'Select Release' : 'No releases available'}</option>
                          {releases.map((release) => (
                            <option key={release.id || optionLabel(release)} value={release.id ?? release}>
                              {optionLabel(release)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="slv-field">
                        <span>Start Date</span>
                        <DatePicker value={form.startDate} max={form.dueDate || undefined} onChange={(value) => setField('startDate', value)} ariaLabel="Start Date" />
                      </div>
                      <div className="slv-field">
                        <span>Due Date</span>
                        <DatePicker value={form.dueDate} min={form.startDate || undefined} onChange={(value) => setField('dueDate', value)} ariaLabel="Due Date" />
                      </div>
                    </section>

                    {mayLink && <section className="slv-create-section">
                      <h3>Link work items</h3>
                      <div className="slv-link-row">
                        <select value={form.linkType} onChange={(event) => setField('linkType', event.target.value)} aria-label="Link type">
                          {relationOptions.map((type) => <option key={type}>{type}</option>)}
                        </select>
                        <select value={form.linkedIssueId} onChange={(event) => setField('linkedIssueId', event.target.value)} aria-label="Work item to link">
                          <option value="">Search work items</option>
                          {linkedIssueOptions.map((issue) => (
                            <option key={issue.id} value={issue.id}>
                              {issue.key || issue.code || issue.id} — {issueSummary(issue)}
                            </option>
                          ))}
                        </select>
                      </div>
                      {!linkedIssueOptions.length && <p className="slv-field-hint">No other work items are available in this Space yet.</p>}
                    </section>}

                    {mayAttach && <section className="slv-create-section">
                      <h3>Attachments</h3>
                      <label className="slv-upload-zone">
                        <input
                          type="file"
                          multiple
                          accept={allowedFileTypes}
                          onChange={(event) => {
                            const files = Array.from(event.target.files || []);
                            const problems = files.map(validateUploadFile).filter(Boolean);
                            const valid = files.filter((file) => !validateUploadFile(file));
                            if (valid.length) setField('attachments', [...form.attachments, ...valid]);
                            setError(problems.join(' '));
                            event.target.value = '';
                          }}
                        />
                        <Icon name="upload" size={25} />
                        <span>Click or drag files to this area to upload</span>
                        <small>PDF, Word, Excel, PowerPoint, TXT, CSV, ZIP and images (JPG, PNG, GIF, WEBP), up to 10 MB each</small>
                      </label>
                      {form.attachments.length > 0 && (
                        <div className="slv-attachment-list">
                          {form.attachments.map((file, index) => (
                            <div key={`${file.name}-${file.size}-${index}`}>
                              <span>{file.name} <small>({formatBytes(file.size)})</small></span>
                              <button type="button" onClick={() => setField('attachments', form.attachments.filter((_, fileIndex) => fileIndex !== index))} aria-label={`Remove ${file.name}`}>×</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>}
                </>
              </>
            )}

            {error && <p className="slv-error" role="alert">{error}</p>}
          </div>
        </div>

        <footer className="slv-create-footer">
          <span className="slv-create-footer-hint">{isSubTask ? 'Parent is required for Sub-task.' : 'Fields marked with * are required.'}</span>
          {createdWithErrors ? (
            <button type="button" className="slv-btn primary" onClick={onClose}>Close</button>
          ) : (
            <button type="submit" className="slv-btn primary" disabled={!activeSpace || !issueType || submitting}>
              {submitting ? (form.attachments.length ? 'Creating and uploading…' : 'Creating…') : 'Create work item'}
            </button>
          )}
        </footer>
      </form>
    </div>
  );
}
/** Choose the project to move work items to (only projects where the user may create work items). */
export function MoveModal({ spaces, currentSpace, count = 1, onClose, onMove }) {
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const CURRENT_USER = useCurrentUserRecord();
  const options = spaces.filter((space) => String(space.id) !== String(currentSpace?.id) && canInSpace(space, 'task.create', null, CURRENT_USER));
  async function submit() {
    setBusy(true);
    await onMove(target);
    setBusy(false);
  }
  return <div className="slv-modal-backdrop is-top" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="slv-modal slv-confirm-modal" role="dialog" aria-modal="true" aria-label="Move work items">
      <div className="slv-modal-head"><h2>Move {count === 1 ? 'work item' : `${count} work items`}</h2><button type="button" onClick={onClose} aria-label="Close">×</button></div>
      <div className="slv-modal-content">
        {options.length ? <>
          <label className="slv-field"><span>Destination project</span><select value={target} onChange={(event) => setTarget(event.target.value)}><option value="">Select a project</option>{options.map((item) => <option key={item.id} value={item.id}>{item.name || item.code}</option>)}</select></label>
          <p className="slv-field-hint">Moved work items get a key of the destination project and go to its backlog. Sprint, team and release are cleared; sub-tasks move with their parent.</p>
        </> : <p className="slv-confirm-text">There is no other project where you can create work items.</p>}
      </div>
      <div className="slv-modal-foot"><button type="button" className="slv-btn secondary" onClick={onClose}>Cancel</button><button type="button" className="slv-btn primary" disabled={!target || busy} onClick={submit}>{busy ? 'Moving…' : 'Move'}</button></div>
    </div>
  </div>;
}

export default function SpacesList({ space = {}, tasks = [], spaces = [], onNavigate = () => {}, onCreateSpace = () => {}, onOpenSpaceSettings = () => {}, onDeleteSpace = () => {}, onCreateTask = () => {}, onUpdateTask = () => {}, onDeleteTasks = () => {}, onMoveTasks = () => {}, onRefresh = () => {}, onGlobalCreate = () => {}, onOpenTask = () => {}, initialTaskId = null, initialTaskOpenRequestId = null, fullPageTaskDetail = false }) {
  const [searchText, setSearchText] = useState('');
  const [searchApplied, setSearchApplied] = useState('');
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [selectedAssignees, setSelectedAssignees] = useState([]);
  const [selectedStatuses, setSelectedStatuses] = useState([]);
  const [orderBy, setOrderBy] = useState('All');
  const [moreFields, setMoreFields] = useState([]);
  const [priorityFilter, setPriorityFilter] = useState([]);
  const [dateRanges, setDateRanges] = useState({});
  const [sort, setSort] = useState({ field: '', direction: 'asc' });
  const [selected, setSelected] = useState([]);
  const [page, setPage] = useState(1);
  const [bulkStatus, setBulkStatus] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createDefaults, setCreateDefaults] = useState({ issueType: '', parentId: '', allowedIssueTypes: null });
  const [detailIssueId, setDetailIssueId] = useState(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [startRequest, setStartRequest] = useState(null);
  const [startAssigneeId, setStartAssigneeId] = useState('');
  const pageSize = 20;

  const autoOpenedTaskRequestRef = useRef(null);
  const { can } = useProjectPermissions(space);
  const mayCreate = can('task.create');

  const inSpace = useMemo(() => {
    const id = String(space.id ?? '');
    const code = String(space.code ?? '').toLowerCase();
    return (Array.isArray(tasks) ? tasks : []).filter((task) => {
      const taskId = task.spaceId ?? task.projectId ?? task.space?.id;
      const taskCode = String(task.spaceCode ?? task.projectCode ?? '').toLowerCase();
      return (id && String(taskId ?? '') === id) || (code && taskCode === code);
    });
  }, [tasks, space.id, space.code]);

  useEffect(() => {
    if (initialTaskId === null || initialTaskId === undefined || initialTaskId === '') {
      autoOpenedTaskRequestRef.current = null;
      return;
    }

    const requestKey = `${initialTaskOpenRequestId || 'route'}:${initialTaskId}`;
    if (autoOpenedTaskRequestRef.current === requestKey) return;

    const targetIssue = inSpace.find((issue) =>
      String(issue.id ?? issue._id ?? '') === String(initialTaskId)
    );

    if (targetIssue) {
      setDetailIssueId(targetIssue.id ?? targetIssue._id);
      autoOpenedTaskRequestRef.current = requestKey;
    }
  }, [initialTaskId, initialTaskOpenRequestId, inSpace]);

  const assigneeOptions = useMemo(() => [...new Set(inSpace.map(assigneeName).filter(Boolean))].sort(), [inSpace]);

  const filtered = useMemo(() => {
    const rows = inSpace.filter((issue) => matchesIssueFilters(issue, {
      keyword: searchApplied,
      types: selectedTypes,
      assignees: selectedAssignees,
      statuses: selectedStatuses,
      priorities: priorityFilter,
      moreFields,
      dateRanges
    }));
    const [field, direction] = sort.field ? [sort.field, sort.direction] : (ORDER_PRESETS[orderBy] || []);
    return sortIssues(rows, field, direction);
  }, [inSpace, searchApplied, selectedTypes, selectedAssignees, selectedStatuses, priorityFilter, moreFields, dateRanges, orderBy, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const visibleIds = pageRows.map((issue) => issue.id);
  const allPageSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));
  const selectedInSpace = selected.filter((id) => inSpace.some((issue) => issue.id === id));
  const bulkStatusOptions = STATUSES.filter((targetStatus) => selectedInSpace.length > 0 && selectedInSpace.every((issue) => validateIssueTransition(issue, targetStatus, inSpace).allowed));

  function changeSort(field) {
    setSort((current) => current.field === field ? { field, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { field, direction: 'asc' });
    setOrderBy('All');
  }
  function togglePage() {
    setSelected((current) => allPageSelected ? current.filter((id) => !visibleIds.includes(id)) : [...new Set([...current, ...visibleIds])]);
  }
  function applySearch(event) { event.preventDefault(); setSearchApplied(searchText); setPage(1); setSelected([]); }
  function updateExtraFields(next) {
    const removed = moreFields.filter((field) => !next.includes(field));
    if (removed.includes('Priority')) setPriorityFilter([]);
    setDateRanges((current) => { const updated = { ...current }; removed.forEach((field) => delete updated[field]); return updated; });
    setMoreFields(next);
  }
  function applyBulkStatus(value) {
    setBulkStatus(value);
    if (!value) return;
    const eligible = selectedInSpace.filter((issue) => validateIssueTransition(issue, value, inSpace).allowed);
    if (value === 'In Progress' && eligible.some((issue) => !assigneeName(issue))) {
      setStartRequest({ issues: eligible, targetStatus: value });
      setStartAssigneeId('');
      setBulkStatus('');
      return;
    }
    eligible.forEach((issue) => onUpdateTask(issue.id, { status: value }));
    setSelected([]);
    setBulkStatus('');
  }
  async function moveSelected(targetId) {
    const target = spaces.find((item) => String(item.id) === String(targetId));
    const moved = target ? await onMoveTasks(selectedInSpace, target) : null;
    if (moved && detailIssueId !== null && moved.some((item) => String(item.id) === String(detailIssueId))) setDetailIssueId(null);
    setSelected([]); setMoveOpen(false);
  }
  async function createIssue(payload) {
    const created = await onCreateTask(payload);
    if (!created) return false;
    setSearchText(''); setSearchApplied(''); setSelectedTypes([]); setSelectedAssignees([]); setSelectedStatuses([]); setOrderBy('Newest created'); setSort({ field: '', direction: 'asc' }); setPage(1);
    return created;
  }
  function changeStatus(issue, status) {
    const result = validateIssueTransition(issue, status, inSpace);
    if (!result.allowed) return;
    if (status === 'In Progress' && !assigneeName(issue)) {
      setStartRequest({ issues: [issue], targetStatus: status });
      setStartAssigneeId('');
      return;
    }
    onUpdateTask(issue.id, { status });
  }
  function closeStartRequest() {
    setStartRequest(null);
    setStartAssigneeId('');
  }
  function confirmStartRequest(assignee) {
    if (!startRequest || !assignee) return;
    const needsAssignment = new Set(startRequest.issues.filter((issue) => !assigneeName(issue)).map((issue) => issue.id));
    startRequest.issues.forEach((issue) => {
      const changes = { status: startRequest.targetStatus };
      if (needsAssignment.has(issue.id)) changes.assignee = assignee;
      onUpdateTask(issue.id, changes);
    });
    if (startRequest.issues.length > 1) setSelected([]);
    closeStartRequest();
  }
  return <div className="app-shell spaces-list-shell">
    <Header spaces={spaces} tasks={tasks} onGlobalCreate={onGlobalCreate} onOpenTask={onOpenTask} />
    <Sidebar activeSection="Spaces" activeSpaceId={space.id} spaces={spaces} onCreateSpace={onCreateSpace} onNavigate={onNavigate} onOpenSpaceSettings={onOpenSpaceSettings} onDeleteSpace={onDeleteSpace} />
    <main className="spaces-list-main">
      <ProjectHeader space={space} activeTab="List" onNavigate={onNavigate} />
      <section className="slv-toolbar">
        <form className="slv-search" onSubmit={applySearch}><Icon name="search" size={15} /><input placeholder="Search" value={searchText} onChange={(event) => setSearchText(event.target.value)} aria-label="Search work items" />{searchText && <button type="button" onClick={() => { setSearchText(''); setSearchApplied(''); }} aria-label="Clear search">×</button>}</form>
        <MultiFilter label="Issue Type" options={ISSUE_TYPES} selected={selectedTypes} onChange={setSelectedTypes} />
        <MultiFilter label="Assignee" options={['Unassigned', ...assigneeOptions]} selected={selectedAssignees} onChange={setSelectedAssignees} width={210} />
        <MultiFilter label="Status" options={STATUSES} selected={selectedStatuses} onChange={setSelectedStatuses} />
        <OrderFilter value={orderBy} onChange={(value) => { setOrderBy(value); setSort({ field: '', direction: 'asc' }); }} />
        <ExtraFilterControls
          moreFields={moreFields}
          dateRanges={dateRanges}
          onDateRangesChange={setDateRanges}
          priorities={priorityFilter}
          onPrioritiesChange={setPriorityFilter}
          onRemoveField={(field) => updateExtraFields(moreFields.filter((item) => item !== field))}
        />
        <MoreFilters selected={moreFields} onChange={updateExtraFields} />
      </section>

      {selectedInSpace.length > 0 && <section className="slv-bulk-bar"><strong>{selectedInSpace.length} selected</strong><label><input type="checkbox" checked={selectedInSpace.length === filtered.length && filtered.length > 0} onChange={(event) => setSelected(event.target.checked ? filtered.map((issue) => issue.id) : [])} /> Select all</label>{selectedInSpace.every((issue) => can('task.move', issue)) && <button type="button" onClick={() => setMoveOpen(true)}><Icon name="spaces" size={14} /> Move issue</button>}<label className="slv-bulk-status">Change status <select value={bulkStatus} onChange={(event) => applyBulkStatus(event.target.value)} disabled={!bulkStatusOptions.length || !selectedInSpace.every((issue) => can('task.move', issue))}><option value="">{bulkStatusOptions.length ? 'Select status' : 'No common transition'}</option>{bulkStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>{selectedInSpace.every((issue) => can('task.delete', issue)) && <button type="button" className="delete-action" onClick={() => setDeleteOpen(true)}><Icon name="trash" size={14} /> Delete</button>}</section>}

      <section className="slv-table-card">
        <div className="slv-table-scroll"><table className="slv-table"><colgroup>
          <col className="slv-col-checkbox" />
          <col className="slv-col-work" />
          <col className="slv-col-assignee" />
          <col className="slv-col-priority" />
          <col className="slv-col-status" />
          <col className="slv-col-created" />
          <col className="slv-col-start" />
          <col className="slv-col-end" />
        </colgroup><thead><tr>
          <th className="slv-check-col"><input type="checkbox" checked={allPageSelected} onChange={togglePage} disabled={!pageRows.length} aria-label="Select all visible rows" /></th>
          <th className="slv-work-col"><SortHeading label="Work" field="summary" sort={sort} onSort={changeSort} /></th>
          <th className="is-center"><SortHeading label="Assignee" field="assignee" sort={sort} onSort={changeSort} /></th>
          <th className="is-center"><SortHeading label="Priority" field="priority" sort={sort} onSort={changeSort} /></th>
          <th className="is-center"><SortHeading label="Status" field="status" sort={sort} onSort={changeSort} /></th>
          <th className="is-center"><SortHeading label="Create Date" field="createdAt" sort={sort} onSort={changeSort} /></th>
          <th className="is-center"><SortHeading label="Start Date" field="startDate" sort={sort} onSort={changeSort} /></th>
          <th className="is-center"><SortHeading label="End Date" field="dueDate" sort={sort} onSort={changeSort} /></th>
        </tr></thead><tbody>
          {pageRows.length ? pageRows.map((issue) => {
            const type = issueType(issue); const assignee = assigneeName(issue);
            return <tr key={issue.id} className={selected.includes(issue.id) ? 'row-selected' : ''}>
              <td className="slv-check-col"><input type="checkbox" checked={selected.includes(issue.id)} onChange={() => setSelected((current) => current.includes(issue.id) ? current.filter((id) => id !== issue.id) : [...current, issue.id])} aria-label={`Select ${issueKey(issue)}`} /></td>
              <td><div className="slv-work-cell"><span className={`slv-type-icon type-${type.toLowerCase().replace(/[^a-z]+/g, '-')}`}><Icon name={iconForType(type)} size={15} /></span><button type="button" onClick={() => setDetailIssueId(issue.id)} className="slv-key" title={`Open ${issueKey(issue)} details`}>{issueKey(issue)}</button><span className="slv-summary" title={issueSummary(issue)}>{issueSummary(issue)}</span></div></td>
              <td className="is-center"><AssigneeCell value={issue.assignee} members={space.members} disabled={!can('task.assign', issue)} onAssign={(member) => onUpdateTask(issue.id, { assignee: member })} /></td>
              <td className="is-center"><PriorityCell value={issue.priority} disabled={!can('task.update', issue)} onChange={(value) => onUpdateTask(issue.id, { priority: value })} /></td>
              <td className="is-center"><StatusCell issue={issue} allIssues={inSpace} disabled={!can('task.move', issue)} onChange={(value) => changeStatus(issue, value)} /></td>
              <td className="slv-date-cell is-center">{formatDateTime(dateValue(issue, 'createdAt'))}</td>
              <td className="slv-date-cell is-center"><EditableDateCell value={dateValue(issue, 'startDate')} label="Start Date" disabled={!can('task.update', issue)} onChange={(value) => onUpdateTask(issue.id, { startDate: value })} /></td>
              <td className="slv-date-cell is-center"><EditableDateCell value={dateValue(issue, 'dueDate')} label="Due Date" disabled={!can('task.update', issue)} onChange={(value) => onUpdateTask(issue.id, { dueDate: value })} /></td>
            </tr>;
          }) : <tr><td colSpan="8" className="slv-empty"><div><Icon name="file" size={28} /><strong>{inSpace.length ? 'No work items match your filters' : 'No work items yet'}</strong><span>{inSpace.length ? 'Try changing your search or filters.' : 'Work items created in this Space will appear here.'}</span>{!inSpace.length && mayCreate && <button type="button" onClick={() => { setCreateDefaults({ issueType: '', parentId: '', allowedIssueTypes: null }); setCreateOpen(true); }}><Icon name="plus" size={14} /> Create</button>}</div></td></tr>}
        </tbody></table></div>
        <footer className="slv-footer">{mayCreate ? <button type="button" className="slv-create-button" onClick={() => { setCreateDefaults({ issueType: '', parentId: '', allowedIssueTypes: null }); setCreateOpen(true); }}><Icon name="plus" size={15} /> Create</button> : <span />}<div className="slv-pagination"><button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} aria-label="Previous page">‹</button><strong>{pageRows.length} of {filtered.length}</strong><button type="button" className="slv-refresh" onClick={() => { setSelected([]); onRefresh(); }} title="Refresh" aria-label="Refresh"><Icon name="refresh" size={14} /></button><button type="button" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} aria-label="Next page">›</button></div><span className="slv-total-count">{filtered.length} work items</span></footer>
      </section>
    </main>
    {detailIssueId !== null && inSpace.some((issue) => String(issue.id) === String(detailIssueId)) && (
      <TaskDetailDrawer
        fullPage={fullPageTaskDetail}
        issue={inSpace.find((issue) => String(issue.id) === String(detailIssueId))}
        allIssues={inSpace}
        space={space}
        onClose={() => setDetailIssueId(null)}
        onUpdateTask={onUpdateTask}
        onDeleteTask={(issue) => { onDeleteTasks([issue.id]); setDetailIssueId(null); }}
        onCloneTask={(payload) => createIssue(payload)}
        onCreateChild={(parentIssue, allowedIssueTypes) => {
          setCreateDefaults({ issueType: '', parentId: String(parentIssue.id), allowedIssueTypes });
          setCreateOpen(true);
        }}
        onOpenIssue={(issueId) => setDetailIssueId(issueId)}
        onMoveTask={(issue) => { setSelected([issue.id]); setMoveOpen(true); }}
      />
    )}
    {createOpen && <IssueModal space={space} existingIssues={inSpace} initialIssueType={createDefaults.issueType} initialParentId={createDefaults.parentId} allowedIssueTypes={createDefaults.allowedIssueTypes} onClose={() => { setCreateOpen(false); setCreateDefaults({ issueType: '', parentId: '', allowedIssueTypes: null }); }} onCreate={createIssue} />}
    {startRequest && <StartTransitionModal issues={startRequest.issues} members={space.members} assigneeId={startAssigneeId} onAssigneeChange={setStartAssigneeId} onClose={closeStartRequest} onConfirm={confirmStartRequest} />}
    {moveOpen && <MoveModal spaces={spaces} currentSpace={space} count={selectedInSpace.length} onClose={() => setMoveOpen(false)} onMove={moveSelected} />}
    {deleteOpen && <div className="slv-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteOpen(false); }}><div className="slv-modal slv-confirm-modal"><div className="slv-modal-head"><h2>Delete work items?</h2><button type="button" onClick={() => setDeleteOpen(false)} aria-label="Close">×</button></div><div className="slv-modal-content"><p className="slv-confirm-text">Are you sure you want to delete {selectedInSpace.length} selected work item(s)?</p></div><div className="slv-modal-foot"><button type="button" className="slv-btn secondary" onClick={() => setDeleteOpen(false)}>Cancel</button><button type="button" className="slv-btn danger" onClick={() => { onDeleteTasks(selectedInSpace); setSelected([]); setDeleteOpen(false); }}>Delete</button></div></div></div>}
  </div>;
}
