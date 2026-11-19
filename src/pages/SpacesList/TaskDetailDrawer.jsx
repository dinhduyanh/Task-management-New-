import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/common/Icon';
import PersonAvatar from '../../components/common/PersonAvatar';
import DatePicker from '../../components/common/DatePicker';
import PriorityIcon from '../../components/common/PriorityIcon';
import {
  getInitialStatus,
  getIssueStatus,
  getTransitionOptions,
  validateIssueTransition
} from './workflows';
import { CHILD_TYPES_BY_PARENT } from './issueHelpers';
import { useAppShell } from '../../context/appShellContext';
import { useProjectPermissions, userAsPerson } from '../../services/projectPermissions';
import { api } from '../../services/api';
import { FILE_ACCEPT, formatBytes, validateUploadFile } from '../../services/fileTypes';
import WorkflowModal from '../../components/workflow/WorkflowModal';
import './TaskDetailDrawer.css';

/** The signed-in user as a person record (assignee options, comment author). */
function currentUserRecord(user) {
  const person = userAsPerson(user) || { id: '', name: 'You', fullName: 'You' };
  return { ...person, initials: initials(person.name), isCurrentUser: true };
}

function userName(user) {
  if (!user) return '';
  if (typeof user === 'string') return user;
  return user.name || user.fullName || user.username || user.email || '';
}

function userId(user) {
  if (!user) return '';
  if (typeof user === 'string') return user;
  return String(user.id ?? user.email ?? user.username ?? userName(user));
}

function initials(value) {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0].slice(0, 2)).toUpperCase();
}

function issueKey(issue) {
  return issue?.key || issue?.code || issue?.taskCode || '—';
}

/** Project teams that can still be assigned (inactive teams are hidden from pickers). */
function activeTeams(space) {
  return (Array.isArray(space?.teams) ? space.teams : []).filter((team) => team?.status !== 'inactive');
}

function issueTitle(issue) {
  return issue?.summary || issue?.title || issue?.name || 'Untitled work item';
}

function issueType(issue) {
  return issue?.issueType || issue?.type || 'Task';
}


const PARENT_TYPES_BY_CHILD = {
  Story: ['Epic', 'Feature'],
  Task: ['Epic', 'Feature'],
  Bug: ['Epic', 'Feature', 'Task'],
  Improvement: ['Epic', 'Feature'],
  'Sub-task': ['Story', 'Task', 'Bug', 'Improvement']
};

function getAllowedChildTypes(parentType) {
  return CHILD_TYPES_BY_PARENT[parentType] || [];
}

function optionId(option) {
  if (option === null || option === undefined) return '';
  if (typeof option !== 'object') return String(option);
  return String(option.id ?? option.code ?? option.key ?? option.name ?? '');
}

function optionLabel(option) {
  if (option === null || option === undefined) return '';
  if (typeof option !== 'object') return String(option);
  return String(option.name ?? option.label ?? option.title ?? option.fullName ?? option.code ?? option.key ?? '');
}

function toDateInputValue(value) {
  const date = parseDate(value);
  if (!date) return '';
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function iconForType(type) {
  return ({
    Epic: 'epic', Feature: 'feature', Task: 'tasks', Bug: 'bug',
    Improvement: 'improvement', Story: 'story', 'Sub-task': 'subTask'
  })[type] || 'tasks';
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  const match = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (match) return new Date(+match[3], +match[2] - 1, +match[1], +(match[4] || 0), +(match[5] || 0), +(match[6] || 0));
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value, includeTime = false) {
  const date = parseDate(value);
  if (!date) return '—';
  const pad = (number) => String(number).padStart(2, '0');
  const result = `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
  return includeTime ? `${result} ${pad(date.getHours())}:${pad(date.getMinutes())}` : result;
}

function statusClass(status) {
  return `td-status-${String(status || '').toLowerCase().replace(/\s+/g, '-')}`;
}

function toUserRecord(value, members = [], currentUser = null) {
  if (!value) return null;
  if (currentUser?.id && String(userId(value)) === currentUser.id) return { ...currentUser };
  const member = typeof value === 'object'
    ? value
    : (Array.isArray(members) ? members : []).find((item) => userId(item) === String(value));
  if (!member) return typeof value === 'string' ? { id: value, name: value, fullName: value, initials: initials(value) } : null;
  const name = userName(member);
  return {
    ...member,
    id: userId(member),
    name,
    fullName: member.fullName || name,
    initials: member.initials || initials(name),
    email: member.email || ''
  };
}

function SearchableOptionSelect({
  options = [],
  value,
  onChange,
  placeholder = 'Select an option',
  emptyLabel = 'No options available.',
  getOptionLabel = optionLabel,
  getOptionId = optionId,
  noneLabel = 'None',
  allowNone = true
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const normalizedOptions = Array.isArray(options) ? options : [];
  const selectedOption = normalizedOptions.find((option) => String(getOptionId(option)) === String(value ?? ''));
  const selectedLabel = selectedOption ? getOptionLabel(selectedOption) : '';
  const visibleOptions = normalizedOptions.filter((option) => {
    const label = String(getOptionLabel(option) || '');
    const id = String(getOptionId(option) || '');
    return `${label} ${id}`.toLowerCase().includes(query.trim().toLowerCase());
  });

  const choose = (nextValue) => {
    onChange(nextValue);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="td-option-select" ref={rootRef}>
      <button
        type="button"
        className={`td-user-select-trigger ${open ? 'open' : ''}`}
        onClick={() => { setOpen((current) => !current); setQuery(''); }}
        aria-expanded={open}
      >
        <span className={selectedLabel ? '' : 'td-placeholder'}>{selectedLabel || placeholder}</span>
        <Icon name="chevron" size={13} />
      </button>
      {open && (
        <div className="td-user-menu td-option-menu" role="listbox">
          <div className="td-user-search">
            <Icon name="search" size={14} />
            <input autoFocus placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          {allowNone && (
            <button type="button" className={`td-user-option ${!value ? 'selected' : ''}`} onClick={() => choose('')}>
              <span className="td-user-option-name">{noneLabel}</span>
              {!value && <Icon name="check" size={14} />}
            </button>
          )}
          {visibleOptions.map((option) => {
            const id = String(getOptionId(option));
            const selected = id === String(value ?? '');
            return (
              <button type="button" key={id} className={`td-user-option ${selected ? 'selected' : ''}`} onClick={() => choose(id)}>
                <span className="td-user-option-name" title={String(getOptionLabel(option))}>{getOptionLabel(option)}</span>
                {selected && <Icon name="check" size={14} />}
              </button>
            );
          })}
          {visibleOptions.length === 0 && <div className="td-user-empty">{emptyLabel}</div>}
        </div>
      )}
    </div>
  );
}

function UserSelect({ members = [], value, onChange, placeholder = 'Select Assignee' }) {
  const { user: signedInUser } = useAppShell();
  const CURRENT_USER = currentUserRecord(signedInUser);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selectedUser = toUserRecord(value, members, CURRENT_USER);
  const seen = new Set([CURRENT_USER.id]);
  const others = (Array.isArray(members) ? members : []).filter((member) => {
    const id = userId(member);
    if (!id || !userName(member) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const filter = (user) => `${userName(user)} ${user?.email || ''} ${user?.username || ''}`.toLowerCase().includes(query.trim().toLowerCase());
  const showCurrentUser = filter(CURRENT_USER);
  const visibleUsers = others.filter(filter);

  const choose = (user) => {
    const record = user ? (user.id === CURRENT_USER.id ? { ...CURRENT_USER } : toUserRecord(userId(user), members, CURRENT_USER)) : null;
    if (record) delete record.isCurrentUser; // a per-viewer flag, never stored
    onChange(record);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="td-user-select" ref={rootRef}>
      <button type="button" className={`td-user-select-trigger ${open ? 'open' : ''}`} onClick={() => { setOpen((current) => !current); setQuery(''); }} aria-expanded={open}>
        {selectedUser ? <><PersonAvatar person={userId(selectedUser) === CURRENT_USER.id ? CURRENT_USER : selectedUser} className={`td-avatar ${userId(selectedUser) === CURRENT_USER.id ? 'current' : ''}`} /><span>{userId(selectedUser) === CURRENT_USER.id ? userName(CURRENT_USER) : userName(selectedUser)}</span></> : <span className="td-placeholder">{placeholder}</span>}
        <Icon name="chevron" size={13} />
      </button>
      {open && (
        <div className="td-user-menu" role="listbox">
          <div className="td-user-search"><Icon name="search" size={14} /><input autoFocus placeholder="Search users" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
          <button type="button" className={`td-user-option td-current-user ${value && String(userId(value)) === CURRENT_USER.id ? 'selected' : ''}`} onClick={() => choose(CURRENT_USER)}>
            <span className="td-user-check">{value && String(userId(value)) === CURRENT_USER.id ? <Icon name="check" size={12} /> : null}</span>
            <PersonAvatar person={CURRENT_USER} className="td-avatar" />
            <span className="td-user-option-name td-current-label" title={`${userName(CURRENT_USER)} (Current user)`}><span className="td-current-name">{userName(CURRENT_USER)}</span><small className="td-current-tag">(Current user)</small></span>
            {value && String(userId(value)) === CURRENT_USER.id && <Icon name="check" size={14} />}
          </button>
          {visibleUsers.map((member) => {
            const id = userId(member);
            const selected = String(userId(value)) === id;
            return <button type="button" key={id} className={`td-user-option ${selected ? 'selected' : ''}`} onClick={() => choose(member)}>
              <span className="td-user-check">{selected ? <Icon name="check" size={12} /> : null}</span>
              <PersonAvatar person={member} className="td-avatar" />
              <span className="td-user-option-name" title={`${userName(member)}${member.email ? ` · ${member.email}` : ''}`}>{userName(member)}</span>
              {selected && <Icon name="check" size={14} />}
            </button>;
          })}
          {visibleUsers.length === 0 && <div className="td-user-empty">{showCurrentUser ? 'Only Current User is available...' : 'No users match your search.'}</div>}
        </div>
      )}
    </div>
  );
}

function StatusMenu({ issue, allIssues, onSelect, disabled = false }) {
  const [open, setOpen] = useState(false);
  const options = getTransitionOptions(issue, allIssues);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => { if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false); };
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const currentStatus = getIssueStatus(issue);
  return <div className="td-status-control" ref={rootRef}>
    <button type="button" className={`td-status-button ${statusClass(currentStatus)}`} onClick={() => setOpen((value) => !value)} aria-expanded={open} disabled={disabled} title={disabled ? 'You do not have permission to move this work item' : undefined}>
      {currentStatus.toUpperCase()} <Icon name="chevron" size={12} />
    </button>
    {open && <div className="td-status-menu">
      {options.length ? options.map((option) => <button type="button" key={option.status} disabled={option.disabled} title={option.reason || option.hint || ''} onClick={() => { if (!option.disabled) onSelect(option.status); setOpen(false); }}>
        <span className={`td-status-dot ${statusClass(option.status)}`} />
        <span>{option.status}</span>
        {option.hint && <small>{option.hint}</small>}
        {option.disabled && <Icon name="info" size={13} />}
      </button>) : <div className="td-no-transition">No further transitions available.</div>}
    </div>}
  </div>;
}

function FieldValue({ value }) {
  if (value === null || value === undefined || value === '') return <>—</>;
  if (Array.isArray(value)) return <>{value.map((item) => typeof item === 'object' ? userName(item) || item.name || '' : item).filter(Boolean).join(', ') || '—'}</>;
  if (typeof value === 'object') return <>{userName(value) || value.name || value.key || '—'}</>;
  return <>{String(value)}</>;
}

/** A file name: a link that previews/downloads stored files; plain text for legacy entries. */
function FileName({ file }) {
  const name = typeof file === 'string' ? file : file?.name || 'Unnamed file';
  if (!file?.id) return <span title={`${name} (not stored, cannot be opened)`}>{name}</span>;
  return (
    <a href={api.attachmentUrl(file.id)} target="_blank" rel="noopener noreferrer" title={`Open ${name}`}>
      {name}
    </a>
  );
}

function EmptyPanel({ children = 'No data' }) {
  return <div className="td-empty"><span className="td-empty-icon"><Icon name="inbox" size={36} /></span><span>{children}</span></div>;
}

function getCommentAuthorName(comment) {
  if (comment?.author && typeof comment.author === 'object') return userName(comment.author) || 'Unknown user';
  return comment?.author || comment?.authorName || 'Unknown user';
}

function getCommentAuthorId(comment) {
  if (comment?.authorId || comment?.userId) return String(comment.authorId || comment.userId);
  if (comment?.author && typeof comment.author === 'object') return userId(comment.author);
  return '';
}

function isCurrentUserComment(comment, currentUserId) {
  const id = getCommentAuthorId(comment);
  return Boolean(id && currentUserId && id === String(currentUserId));
}

function updateCommentTree(items, targetId, updater) {
  return (Array.isArray(items) ? items : []).map((item) => {
    if (String(item.id) === String(targetId)) return updater(item);
    if (Array.isArray(item.replies) && item.replies.length) {
      return { ...item, replies: updateCommentTree(item.replies, targetId, updater) };
    }
    return item;
  });
}

function removeCommentTree(items, targetId) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => String(item.id) !== String(targetId))
    .map((item) => Array.isArray(item.replies)
      ? { ...item, replies: removeCommentTree(item.replies, targetId) }
      : item);
}

function findCommentTree(items, targetId) {
  for (const item of Array.isArray(items) ? items : []) {
    if (String(item.id) === String(targetId)) return item;
    const nested = findCommentTree(item.replies, targetId);
    if (nested) return nested;
  }
  return null;
}

export default function TaskDetailDrawer({
  issue,
  allIssues = [],
  space = {},
  onClose = () => {},
  onUpdateTask = () => {},
  onDeleteTask = () => {},
  onCloneTask = () => {},
  onCreateChild = () => {},
  onOpenIssue = () => {},
  onMoveTask = null, // (issue) => open the "Move to project" picker
  fullPage = false
}) {
  const [expanded, setExpanded] = useState(false);
  const [hideEmpty, setHideEmpty] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(issueTitle(issue));
  const [editingInfoField, setEditingInfoField] = useState(null);
  const [infoDraft, setInfoDraft] = useState('');
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState(issue.description || '');
  const [activeActivityTab, setActiveActivityTab] = useState('Comments');
  const [commentDraft, setCommentDraft] = useState('');
  const [commentFiles, setCommentFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState('');
  const { replaceWorkItem, user: signedInUser, openAssistant } = useAppShell();
  const CURRENT_USER = currentUserRecord(signedInUser);
  const { can } = useProjectPermissions(space);
  // What the signed-in user may do with this work item (the API enforces the same rules).
  const allow = {
    update: can('task.update', issue),
    move: can('task.move', issue),
    assign: can('task.assign', issue),
    clone: can('task.clone', issue),
    remove: can('task.delete', issue),
    link: can('task.link', issue),
    worklog: can('task.worklog', issue),
    createChild: can('task.create'),
    commentAdd: can('comment.add', issue),
    commentView: can('comment.view', issue) && !issue.commentsHidden,
    commentEditOwn: can('comment.edit_own', issue),
    commentEditAll: can('comment.edit_all', issue),
    commentDeleteOwn: can('comment.delete_own', issue),
    commentDeleteAll: can('comment.delete_all', issue),
    attachAdd: can('attachment.add', issue),
    fileDeleteOwn: can('attachment.delete_own', issue),
    fileDeleteAll: can('attachment.delete_all', issue)
  };
  const NO_PERMISSION = 'You do not have permission for this action';
  const mayEditComment = (comment) => (isCurrentUserComment(comment, CURRENT_USER.id) ? allow.commentEditOwn || allow.commentEditAll : allow.commentEditAll);
  const mayDeleteComment = (comment) => (isCurrentUserComment(comment, CURRENT_USER.id) ? allow.commentDeleteOwn || allow.commentDeleteAll : allow.commentDeleteAll);
  const mayDeleteFile = (file) => (file?.id && String(file.uploadedBy?.id || '') === String(CURRENT_USER.id) ? allow.fileDeleteOwn || allow.fileDeleteAll : allow.fileDeleteAll);
  const mayEditField = (key) => (key === 'creator' ? false : key === 'assignee' ? allow.assign : allow.update);
  const [replyToId, setReplyToId] = useState(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editingCommentDraft, setEditingCommentDraft] = useState('');
  const [workLogHours, setWorkLogHours] = useState('');
  const [workLogNote, setWorkLogNote] = useState('');
  const [startModalOpen, setStartModalOpen] = useState(false);
  const [pendingAssignee, setPendingAssignee] = useState(null);
  const [pendingStatus, setPendingStatus] = useState('In Progress');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [linkComposerOpen, setLinkComposerOpen] = useState(false);
  const [linkType, setLinkType] = useState('Relates to');
  const [linkedIssueId, setLinkedIssueId] = useState('');
  const [copied, setCopied] = useState('');

  const members = Array.isArray(space.members) ? space.members : [];
  const title = issueTitle(issue);
  const key = issueKey(issue);
  const type = issueType(issue);
  const status = getIssueStatus(issue);
  const assignee = issue.assignee || null;
  const creator = issue.creator || null;
  const comments = Array.isArray(issue.comments) ? issue.comments : [];
  const history = Array.isArray(issue.history) ? issue.history : [];
  const workLogs = Array.isArray(issue.workLogs) ? issue.workLogs : [];
  const attachments = Array.isArray(issue.attachments) ? issue.attachments : [];
  const children = allIssues.filter((candidate) => {
    if (String(candidate.id) === String(issue.id)) return false;
    const parentRef = candidate.parentId ?? candidate.parent?.id ?? candidate.parent?.key ?? candidate.parent ?? null;
    return parentRef !== null && (String(parentRef) === String(issue.id) || String(parentRef) === String(key));
  });
  const linkedItems = (Array.isArray(issue.links) ? issue.links : []).map((link) => ({ ...link, target: allIssues.find((candidate) => String(candidate.id) === String(link.issueId || link.targetId)) })).filter((link) => link.target);
  const availableLinkTargets = allIssues.filter((candidate) => String(candidate.id) !== String(issue.id) && !linkedItems.some((link) => String(link.target.id) === String(candidate.id)));

  useEffect(() => {
    setTitleDraft(issueTitle(issue));
    setEditingTitle(false);
    setEditingInfoField(null);
    setInfoDraft('');
    setDescriptionDraft(issue.description || '');
    setEditingDescription(false);
    setReplyToId(null);
    setReplyDraft('');
    setEditingCommentId(null);
    setEditingCommentDraft('');
  }, [issue.id, issue.description]);

  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape' && !startModalOpen && !deleteConfirmOpen && !workflowOpen) onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, startModalOpen, deleteConfirmOpen, workflowOpen]);

  function recordHistory(action, detail = '') {
    const entry = {
      id: `history-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      action,
      detail,
      actor: 'You',
      createdAt: new Date().toISOString()
    };
    return [...history, entry];
  }

  function patchIssue(patch, historyAction = '', historyDetail = '') {
    const next = { ...patch, updatedAt: new Date().toISOString() };
    if (historyAction) next.history = recordHistory(historyAction, historyDetail);
    onUpdateTask(issue.id, next);
  }

  async function copyText(text, label) {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else throw new Error('Clipboard unavailable');
      setCopied(label);
      window.setTimeout(() => setCopied(''), 1800);
    } catch {
      setCopied('Copy unavailable');
      window.setTimeout(() => setCopied(''), 1800);
    }
  }

  function handleStatusChange(nextStatus) {
    const validation = validateIssueTransition(issue, nextStatus, allIssues);
    if (!validation.allowed) return;
    if (nextStatus === 'In Progress' && !assignee) {
      setPendingStatus(nextStatus);
      setPendingAssignee(null);
      setStartModalOpen(true);
      return;
    }
    patchIssue({ status: nextStatus }, 'Status changed', `${status} → ${nextStatus}`);
  }

  function confirmStart() {
    if (!pendingAssignee) return;
    patchIssue({ status: pendingStatus, assignee: pendingAssignee }, 'Work started', `Assigned to ${userName(pendingAssignee)} · ${pendingStatus}`);
    setStartModalOpen(false);
    setPendingAssignee(null);
  }

  function saveDescription() {
    patchIssue({ description: descriptionDraft }, 'Description updated');
    setEditingDescription(false);
  }

  function startTitleEdit() {
    setTitleDraft(title);
    setEditingTitle(true);
  }

  function saveTitle() {
    const nextTitle = titleDraft.trim();
    if (!nextTitle) return;
    patchIssue({ title: nextTitle, summary: nextTitle }, 'Title updated', nextTitle);
    setEditingTitle(false);
  }

  function beginInfoEdit(field) {
    const current = field.key === 'parentId'
      ? (issue.parentId ?? issue.parent?.id ?? parentIssue?.id ?? (typeof issue.parent === 'string' ? issue.parent : ''))
      : issue[field.key];
    if (field.key === 'labels') setInfoDraft(Array.isArray(current) ? current.join(', ') : String(current || ''));
    else if (field.key === 'startDate' || field.key === 'dueDate') setInfoDraft(toDateInputValue(current));
    else if (field.key === 'priority') setInfoDraft(current || 'Medium');
    else if (field.key === 'team' || field.key === 'release') {
      const options = field.key === 'team' ? activeTeams(space) : (Array.isArray(space.releases) ? space.releases : []);
      setInfoDraft(current ? optionId(current) : '');
    }
    else setInfoDraft(current ?? '');
    setEditingInfoField(field.key);
  }

  function cancelInfoEdit() {
    setEditingInfoField(null);
    setInfoDraft('');
  }

  function saveInfoField(field) {
    const keyName = field.key;
    let patch = {};
    let detail = '';

    if (keyName === 'parentId') {
      const selectedParent = allIssues.find((candidate) => String(candidate.id) === String(infoDraft));
      patch = { parentId: selectedParent?.id ?? null, parent: selectedParent || null, parentKey: selectedParent ? issueKey(selectedParent) : null };
      detail = selectedParent ? issueKey(selectedParent) : 'Parent cleared';
    } else if (keyName === 'assignee' || keyName === 'creator') {
      patch = { [keyName]: infoDraft || null };
      detail = infoDraft ? userName(infoDraft) : `${field.label} cleared`;
    } else if (keyName === 'team' || keyName === 'release') {
      const options = keyName === 'team' ? activeTeams(space) : (Array.isArray(space.releases) ? space.releases : []);
      const selected = options.find((option) => optionId(option) === String(infoDraft));
      patch = { [keyName]: selected || null };
      detail = optionLabel(patch[keyName]) || `${field.label} cleared`;
    } else if (keyName === 'labels') {
      const labels = String(infoDraft || '').split(',').map((label) => label.trim()).filter(Boolean);
      patch = { labels };
      detail = labels.join(', ') || 'Labels cleared';
    } else if (keyName === 'startDate' || keyName === 'dueDate') {
      patch = { [keyName]: infoDraft || null };
      detail = infoDraft || `${field.label} cleared`;
    } else if (keyName === 'priority') {
      patch = { priority: infoDraft };
      detail = infoDraft;
    }

    patchIssue(patch, `${field.label} updated`, detail);
    cancelInfoEdit();
  }

  function renderInfoEditor(field) {
    const keyName = field.key;

    if (keyName === 'assignee' || keyName === 'creator') {
      return <div className="td-info-user-editor"><UserSelect members={members} value={infoDraft} onChange={setInfoDraft} placeholder={`Select ${field.label}`} /><button type="button" className="td-info-clear" onClick={() => setInfoDraft(null)}>Clear</button></div>;
    }

    if (keyName === 'parentId') {
      const allowedParentTypes = PARENT_TYPES_BY_CHILD[type] || [];
      const candidates = allIssues.filter((candidate) =>
        String(candidate.id) !== String(issue.id) &&
        (!allowedParentTypes.length || allowedParentTypes.includes(issueType(candidate)))
      );
      return (
        <SearchableOptionSelect
          options={candidates}
          value={infoDraft}
          onChange={setInfoDraft}
          placeholder="Select Parent"
          emptyLabel="No eligible work items found in this Space."
          getOptionLabel={(candidate) => `${issueKey(candidate)} - ${issueTitle(candidate)}`}
          getOptionId={(candidate) => candidate.id}
          noneLabel="No parent"
          allowNone={type !== 'Sub-task'}
        />
      );
    }

    if (keyName === 'priority') {
      return <select value={infoDraft || 'Medium'} onChange={(event) => setInfoDraft(event.target.value)}>
        {['Highest', 'High', 'Medium', 'Low', 'Lowest'].map((priority) => <option key={priority} value={priority}>{priority}</option>)}
      </select>;
    }

    if (keyName === 'team' || keyName === 'release') {
      const options = keyName === 'team' ? activeTeams(space) : (Array.isArray(space.releases) ? space.releases : []);
      return (
        <SearchableOptionSelect
          options={options}
          value={infoDraft}
          onChange={setInfoDraft}
          placeholder={`Select ${field.label}`}
          emptyLabel={keyName === 'team' ? 'No teams available in this Space.' : 'No releases available in this Space.'}
          getOptionLabel={optionLabel}
          getOptionId={optionId}
          noneLabel={`No ${field.label.toLowerCase()}`}
        />
      );
    }

    if (keyName === 'labels') return <input type="text" value={infoDraft} onChange={(event) => setInfoDraft(event.target.value)} placeholder="Enter labels separated by commas" />;
    if (keyName === 'startDate' || keyName === 'dueDate') return <DatePicker value={infoDraft || ''} onChange={setInfoDraft} ariaLabel={field.label} min={keyName === 'dueDate' ? issue.startDate || undefined : undefined} max={keyName === 'startDate' ? issue.dueDate || undefined : undefined} />;
    return <input type="text" value={infoDraft ?? ''} onChange={(event) => setInfoDraft(event.target.value)} />;
  }

  async function addComment(event) {
    event.preventDefault();
    const text = commentDraft.trim();
    if (!text && commentFiles.length === 0) return;
    setUploading(true);
    const stored = commentFiles.length ? await storeFiles(commentFiles, 'comment') : [];
    setUploading(false);
    if (!text && !stored.length) return;
    const comment = {
      id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text,
      attachments: stored.map(({ id, name, extension, size }) => ({ id, name, extension, size })),
      author: CURRENT_USER.name,
      authorId: CURRENT_USER.id,
      createdAt: new Date().toISOString(),
      replies: []
    };
    patchIssue({ comments: [...comments, comment] }, 'Comment added');
    setCommentDraft('');
    setCommentFiles([]);
  }

  function addReply(event, parentId) {
    event.preventDefault();
    const text = replyDraft.trim();
    if (!text) return;
    const reply = {
      id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text,
      attachments: [],
      author: CURRENT_USER.name,
      authorId: CURRENT_USER.id,
      createdAt: new Date().toISOString(),
      replies: []
    };
    const nextComments = updateCommentTree(comments, parentId, (parent) => ({
      ...parent,
      replies: [...(Array.isArray(parent.replies) ? parent.replies : []), reply]
    }));
    patchIssue({ comments: nextComments }, 'Comment reply added');
    setReplyDraft('');
    setReplyToId(null);
  }

  function beginEditComment(comment) {
    if (!mayEditComment(comment)) return;
    setReplyToId(null);
    setEditingCommentId(comment.id);
    setEditingCommentDraft(comment.text || '');
  }

  function saveCommentEdit(event, commentId) {
    event.preventDefault();
    const text = editingCommentDraft.trim();
    if (!text) return;
    const target = findCommentTree(comments, commentId);
    if (!target || !mayEditComment(target)) return;
    const nextComments = updateCommentTree(comments, commentId, (comment) => ({
      ...comment,
      text,
      updatedAt: new Date().toISOString()
    }));
    patchIssue({ comments: nextComments }, 'Comment edited');
    setEditingCommentId(null);
    setEditingCommentDraft('');
  }

  function deleteComment(commentId) {
    const target = findCommentTree(comments, commentId);
    if (!target || !mayDeleteComment(target)) return;
    patchIssue({ comments: removeCommentTree(comments, commentId) }, 'Comment deleted');
    if (String(replyToId) === String(commentId)) {
      setReplyToId(null);
      setReplyDraft('');
    }
    if (String(editingCommentId) === String(commentId)) {
      setEditingCommentId(null);
      setEditingCommentDraft('');
    }
  }

  function addWorkLog(event) {
    event.preventDefault();
    const hours = Number(workLogHours);
    if (!Number.isFinite(hours) || hours <= 0) return;
    const entry = { id: `worklog-${Date.now()}`, hours, note: workLogNote.trim(), author: 'You', createdAt: new Date().toISOString() };
    patchIssue({ workLogs: [...workLogs, entry] }, 'Work logged', `${hours} hour(s)`);
    setWorkLogHours('');
    setWorkLogNote('');
  }

  function addLink(event) {
    event.preventDefault();
    if (!linkedIssueId) return;
    const nextLinks = [...(Array.isArray(issue.links) ? issue.links : []), { type: linkType, issueId: linkedIssueId }];
    patchIssue({ links: nextLinks }, 'Work item linked', `${linkType} ${issueKey(allIssues.find((item) => String(item.id) === String(linkedIssueId)) || {})}`);
    setLinkedIssueId('');
    setLinkComposerOpen(false);
  }

  function handleClone() {
    const clone = {
      ...issue,
      id: undefined,
      key: undefined,
      code: undefined,
      taskCode: undefined,
      title: `Copy of ${title}`,
      summary: `Copy of ${title}`,
      status: getInitialStatus(issue),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      comments: [],
      history: [],
      workLogs: [],
      attachments: [],
      links: [],
      cloneOf: issue.id
    };
    onCloneTask(clone);
  }

  /** Uploads files to this work item; returns metadata of the stored files. */
  async function storeFiles(files, source) {
    const problems = files.map(validateUploadFile).filter(Boolean);
    const stored = [];
    for (const file of files.filter((item) => !validateUploadFile(item))) {
      try {
        const result = await api.uploadAttachment(issue.id, file, source);
        replaceWorkItem(result.workItem);
        stored.push(result.attachment);
      } catch (error) {
        problems.push(`${file.name}: ${error.message}`);
      }
    }
    setFileError(problems.join(' '));
    return stored;
  }

  async function uploadAttachments(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    setUploading(true);
    const stored = await storeFiles(files, 'work_item');
    setUploading(false);
    if (stored.length) patchIssue({}, 'Attachments added', stored.map((file) => file.name).join(', '));
  }

  async function removeAttachment(file, index) {
    const name = typeof file === 'string' ? file : file?.name || 'file';
    if (file?.id) {
      if (!window.confirm(`Delete ${name}? It will also be removed from Documents.`)) return;
      try {
        const result = await api.deleteAttachment(file.id);
        replaceWorkItem(result.workItem);
        patchIssue({}, 'Attachment removed', name);
      } catch (error) {
        setFileError(error.message);
      }
      return;
    }
    patchIssue({ attachments: attachments.filter((_, itemIndex) => itemIndex !== index) }, 'Attachment removed', name);
  }

  const isEpicOrFeature = ['Epic', 'Feature'].includes(type);
  const parentIssue = allIssues.find((candidate) =>
    String(candidate.id) === String(issue.parentId ?? issue.parent?.id ?? '') ||
    String(candidate.key || candidate.code || candidate.taskCode) === String(
      issue.parent?.key || issue.parent?.code || issue.parentKey || (typeof issue.parent === 'string' ? issue.parent : '')
    )
  );
  const parentKey = issue.parent?.key
    || issue.parent?.code
    || (typeof issue.parent === 'string' ? issue.parent : null)
    || issue.parentKey
    || parentIssue?.key
    || parentIssue?.code
    || null;
  const parentRecord = parentIssue || (issue.parent && typeof issue.parent === 'object' ? issue.parent : null);
  const parentValue = parentRecord
    ? `${issueKey(parentRecord)} - ${issueTitle(parentRecord)}`
    : parentKey;

  // Task Information mirrors fields from Create Work Item. Each populated
  // field can be edited inline; fields not applicable to the Issue Type remain hidden.
  const infoFields = [
    ...(!isEpicOrFeature ? [{ label: 'Parent', key: 'parentId', value: parentValue }] : []),
    { label: 'Assignee', key: 'assignee', value: assignee },
    { label: 'Creator', key: 'creator', value: creator },
    { label: 'Team', key: 'team', value: issue.team },
    { label: 'Priority', key: 'priority', value: issue.priority || 'Medium' },
    { label: 'Labels', key: 'labels', value: issue.labels },
    { label: 'Release', key: 'release', value: issue.release },
    { label: 'Start Date', key: 'startDate', value: parseDate(issue.startDate) ? formatDate(issue.startDate) : null },
    { label: 'Due Date', key: 'dueDate', value: parseDate(issue.dueDate || issue.endDate) ? formatDate(issue.dueDate || issue.endDate) : null }
  ];
  const displayedInfo = hideEmpty
    ? infoFields.filter(({ value }) => value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0))
    : infoFields;
  const allowedChildTypes = getAllowedChildTypes(type);

  function renderComment(comment, depth = 0) {
    const commentId = comment.id;
    const authorName = getCommentAuthorName(comment);
    const canEdit = mayEditComment(comment);
    const canDelete = mayDeleteComment(comment);
    const replies = Array.isArray(comment.replies) ? comment.replies : [];
    const commentAttachments = Array.isArray(comment.attachments) ? comment.attachments : [];

    return (
      <div className={`td-comment-thread ${depth > 0 ? 'nested' : ''}`} key={commentId}>
        <article className="td-comment">
          <PersonAvatar person={comment.author && typeof comment.author === 'object' ? comment.author : { id: comment.authorId, name: authorName }} className="td-avatar" />
          <div className="td-comment-content">
            <div className="td-comment-meta">
              <strong>{authorName}</strong>
              <time>{formatDate(comment.createdAt, true)}</time>
              {comment.updatedAt && <small className="td-comment-edited">edited</small>}
            </div>

            {editingCommentId === commentId ? (
              <form className="td-comment-inline-form" onSubmit={(event) => saveCommentEdit(event, commentId)}>
                <textarea value={editingCommentDraft} onChange={(event) => setEditingCommentDraft(event.target.value)} rows={3} autoFocus />
                <div className="td-comment-inline-actions">
                  <button type="button" className="td-secondary-button" onClick={() => { setEditingCommentId(null); setEditingCommentDraft(''); }}>Cancel</button>
                  <button type="submit" className="td-primary-button" disabled={!editingCommentDraft.trim()}>Save</button>
                </div>
              </form>
            ) : (
              <p>{comment.text}</p>
            )}

            {commentAttachments.length > 0 && <div className="td-comment-file-list">{commentAttachments.map((file, index) => <span key={`${file?.id || file?.name || file}-${index}`}><FileName file={file} /></span>)}</div>}

            {editingCommentId !== commentId && (
              <div className="td-comment-actions">
                {allow.commentAdd && <button type="button" onClick={() => { setEditingCommentId(null); setReplyToId(commentId); setReplyDraft(''); }}>Reply</button>}
                {canEdit && <button type="button" onClick={() => beginEditComment(comment)}>Edit</button>}
                {canDelete && <button type="button" className="danger" onClick={() => deleteComment(commentId)}>Delete</button>}
              </div>
            )}

            {replyToId === commentId && (
              <form className="td-comment-inline-form td-reply-form" onSubmit={(event) => addReply(event, commentId)}>
                <textarea value={replyDraft} onChange={(event) => setReplyDraft(event.target.value)} placeholder="Write a reply..." rows={2} autoFocus />
                <div className="td-comment-inline-actions">
                  <button type="button" className="td-secondary-button" onClick={() => { setReplyToId(null); setReplyDraft(''); }}>Cancel</button>
                  <button type="submit" className="td-primary-button" disabled={!replyDraft.trim()}>Reply</button>
                </div>
              </form>
            )}
          </div>
        </article>
        {replies.length > 0 && <div className="td-comment-replies">{replies.map((reply) => renderComment(reply, depth + 1))}</div>}
      </div>
    );
  }


  return (
    <div className={`td-overlay ${fullPage ? 'td-overlay-full-page' : ''}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`td-drawer ${expanded ? 'expanded' : ''}`} role="dialog" aria-modal="true" aria-label={`Task detail ${key}`}>
        <header className="td-header">
          <div className="td-header-left">
            <button type="button" className="td-icon-button td-close-button" onClick={onClose} aria-label="Close Task detail"><Icon name="close" size={16} /></button>
            <span>Task detail</span>
          </div>
          <button type="button" className="td-expand-button" onClick={() => setExpanded((value) => !value)}>
            <Icon name={expanded ? 'minimize' : 'maximize'} size={14} /> {expanded ? 'Collapse' : 'Expand'}
          </button>
        </header>

        <div className="td-body">
          <main className="td-main-column">
            <div className="td-issue-heading">
              <div className={`td-issue-type type-${String(type).toLowerCase().replace(/[^a-z]+/g, '-')}`} title={type}><Icon name={iconForType(type)} size={16} /></div>
              <button type="button" className="td-key-button" onClick={() => copyText(key, 'Key copied')} title="Copy issue key">{key} <Icon name="copy" size={13} /></button>
            </div>
            {editingTitle ? <div className="td-title-editor">
              <input value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} autoFocus onKeyDown={(event) => { if (event.key === 'Enter') saveTitle(); if (event.key === 'Escape') { setTitleDraft(title); setEditingTitle(false); } }} />
              <button type="button" className="td-primary-button" onClick={saveTitle} disabled={!titleDraft.trim()}>Save</button>
              <button type="button" className="td-secondary-button" onClick={() => { setTitleDraft(title); setEditingTitle(false); }}>Cancel</button>
            </div> : <div className="td-title-display"><h1 className="td-issue-title">{title}</h1>{allow.update && <button type="button" className="td-edit-button td-title-edit-button" title="Edit title" onClick={startTitleEdit}><Icon name="edit" size={13} /></button>}</div>}
            <div className="td-issue-actions-row">
              <div className="td-heading-status">
                <StatusMenu issue={issue} allIssues={allIssues} onSelect={handleStatusChange} disabled={!allow.move} />
                <button type="button" className="td-workflow-button" onClick={() => setWorkflowOpen(true)} title={`View the ${type} workflow`} aria-label={`View the ${type} workflow`}><Icon name="workflow" size={15} /></button>
              </div>
              <div className="td-action-buttons">
                <button type="button" className="td-action-button" title={!allow.createChild ? NO_PERMISSION : allowedChildTypes.length ? `Create child: ${allowedChildTypes.join(', ')}` : 'This work item type cannot have child work items'} disabled={!allowedChildTypes.length || !allow.createChild} onClick={() => onCreateChild(issue, allowedChildTypes)}><Icon name="plus" size={16} /></button>
 <button type="button" className="td-action-button td-ai-button" title="Ask the AI Project Assistant about this work item" aria-label="AI Project Assistant" onClick={() => openAssistant({ spaceId: issue.spaceId ?? space.id, taskIds: [issue.id] })}><Icon name="sparkles" size={15} /></button>
                <button type="button" className="td-action-button" title="Copy link" onClick={() => copyText(`${window.location.origin}${window.location.pathname}#${key}`, 'Link copied')}><Icon name="link" size={15} /></button>
                {onMoveTask && <button type="button" className="td-action-button" title={allow.move ? 'Move to another project' : NO_PERMISSION} aria-label="Move to another project" disabled={!allow.move} onClick={() => onMoveTask(issue)}><Icon name="spaces" size={15} /></button>}
                <button type="button" className="td-action-button" title={allow.clone ? 'Clone work item' : NO_PERMISSION} disabled={!allow.clone} onClick={handleClone}><Icon name="copy" size={15} /></button>
                <button type="button" className="td-action-button danger" title={allow.remove ? 'Delete work item' : NO_PERMISSION} disabled={!allow.remove} onClick={() => setDeleteConfirmOpen(true)}><Icon name="trash" size={15} /></button>
                {copied && <span className="td-copy-feedback">{copied}</span>}
              </div>
            </div>

            <section className="td-section td-information-section">
              <div className="td-section-heading">
                <h2><Icon name="tasks" size={16} /> Task information</h2>
                <label className="td-switch-label"><span>Hide empty fields</span><input type="checkbox" checked={hideEmpty} onChange={(event) => setHideEmpty(event.target.checked)} /><i /></label>
              </div>
              <div className="td-info-list">
                {displayedInfo.map((field) => (
                  <div className={`td-info-row ${editingInfoField === field.key ? 'is-editing' : ''}`} key={field.key}>
                    <span className="td-info-label">{field.label}</span>
                    {editingInfoField === field.key ? (
                      <div className="td-info-edit-area">
                        {renderInfoEditor(field)}
                        <div className="td-info-edit-actions">
                          <button type="button" className="td-secondary-button" onClick={cancelInfoEdit}>Cancel</button>
                          <button type="button" className="td-primary-button" onClick={() => saveInfoField(field)}>Save</button>
                        </div>
                      </div>
                    ) : !mayEditField(field.key) ? (
                      <span className="td-info-value is-readonly">
                        <span className="td-info-value-content">
                          {field.key === 'priority' ? <span className="td-priority-value"><PriorityIcon priority={field.value || 'Medium'} size={15} /><span>{field.value || 'Medium'}</span></span> : <FieldValue value={field.value} />}
                        </span>
                      </span>
                    ) : (
                      <span className="td-info-value">
                        <button
                          type="button"
                          className="td-info-value-content td-info-value-trigger"
                          title={`Click to edit ${field.label}`}
                          aria-label={`Edit ${field.label}`}
                          onClick={() => beginInfoEdit(field)}
                        >
                          {field.key === 'priority' ? <span className="td-priority-value"><PriorityIcon priority={field.value || 'Medium'} size={15} /><span>{field.value || 'Medium'}</span></span> : <FieldValue value={field.value} />}
                        </button>
                        <button type="button" className="td-info-edit-button" title={`Edit ${field.label}`} aria-label={`Edit ${field.label}`} onClick={() => beginInfoEdit(field)}><Icon name="edit" size={12} /></button>
                      </span>
                    )}
                  </div>
                ))}
                {hideEmpty && displayedInfo.length === 0 && <div className="td-muted-empty">No populated fields to display.</div>}
              </div>
            </section>

            <section className="td-section td-description-section">
              <div className="td-section-heading">
                <h2><Icon name="file" size={16} /> Description</h2>
                 {!editingDescription && allow.update && <button type="button" className="td-edit-button" title="Edit description" onClick={() => setEditingDescription(true)}><Icon name="edit" size={14} /></button>}
              </div>
              {editingDescription ? <div className="td-description-editor">
                <textarea value={descriptionDraft} onChange={(event) => setDescriptionDraft(event.target.value)} placeholder="Add a description..." rows={5} autoFocus />
                <div><button type="button" className="td-secondary-button" onClick={() => { setDescriptionDraft(issue.description || ''); setEditingDescription(false); }}>Cancel</button><button type="button" className="td-primary-button" onClick={saveDescription}>Save</button></div>
              </div> : <div className={`td-description-text ${!issue.description ? 'placeholder' : ''}`}>{issue.description || 'Add a description...'}</div>}
            </section>

            <section className="td-section td-attachments-section">
              <div className="td-section-heading">
                <h2><Icon name="paperclip" size={16} /> Attachments</h2>
                {allow.attachAdd && <label className="td-outline-upload"><Icon name="upload" size={13} /> {uploading ? 'Uploading…' : 'Upload'}<input type="file" multiple accept={FILE_ACCEPT} disabled={uploading} onChange={uploadAttachments} /></label>}
              </div>
              {fileError && <p className="td-file-error" role="alert">{fileError}</p>}
              {attachments.length ? <div className="td-attachment-list">{attachments.map((file, index) => (
                <div className="td-attachment-item" key={`${file?.id || file?.name || file}-${index}`}>
                  <Icon name="file" size={17} />
                  <span><FileName file={file} /></span>
                  {file?.size ? <small className="td-file-size">{formatBytes(file.size)}</small> : null}
                  {file?.id && <a className="td-plain-icon" href={api.attachmentUrl(file.id, 'download')} title={`Download ${file.name}`} aria-label={`Download ${file.name}`}><Icon name="download" size={13} /></a>}
                  {mayDeleteFile(file) && <button type="button" onClick={() => removeAttachment(file, index)} title="Remove attachment" aria-label={`Remove ${file?.name || 'attachment'}`}><Icon name="trash" size={13} /></button>}
                </div>
              ))}</div> : <EmptyPanel />}
            </section>

            <section className="td-section td-child-section">
              <div className="td-section-heading">
                <h2><Icon name="workflow" size={16} /> Child work items</h2>
                <button type="button" className="td-outline-button" onClick={() => onCreateChild(issue, allowedChildTypes)} disabled={!allowedChildTypes.length || !allow.createChild} title={!allow.createChild ? NO_PERMISSION : allowedChildTypes.length ? `Create: ${allowedChildTypes.join(', ')}` : 'This work item type cannot have child work items'}><Icon name="plus" size={13} /> Create new</button>
              </div>
              <div className="td-mini-table-wrap">
                <table className="td-mini-table"><thead><tr><th>Work</th><th>Status</th><th>Assignee</th><th>Due date</th></tr></thead><tbody>
                  {children.length ? children.map((child) => (
                    <tr key={child.id}>
                      <td><button type="button" className="td-table-link" onClick={() => onOpenIssue(child.id)}>{issueKey(child)} · {issueTitle(child)}</button></td>
                      <td><span className={`td-table-status ${statusClass(getIssueStatus(child))}`}>{getIssueStatus(child)}</span></td>
                      <td>{userName(child.assignee) || 'Unassigned'}</td>
                      <td>{formatDate(child.dueDate || child.endDate)}</td>
                    </tr>
                  )) : <tr><td colSpan="4"><EmptyPanel>No child work items</EmptyPanel></td></tr>}
                </tbody></table>
              </div>
            </section>

            <section className="td-section td-linked-section">
              <div className="td-section-heading">
                <h2><Icon name="link" size={16} /> Linked work items</h2>
                {allow.link && <button type="button" className="td-outline-button" onClick={() => setLinkComposerOpen((value) => !value)}><Icon name="plus" size={13} /> Create new</button>}
              </div>
              {linkComposerOpen && <form className="td-link-composer" onSubmit={addLink}>
                <select value={linkType} onChange={(event) => setLinkType(event.target.value)}>
                  {['Blocks', 'Is blocked by', 'Relates to', 'Duplicates', 'Is duplicated by'].map((option) => <option key={option}>{option}</option>)}
                </select>
                <select value={linkedIssueId} onChange={(event) => setLinkedIssueId(event.target.value)}>
                  <option value="">Select a work item</option>
                  {availableLinkTargets.map((target) => <option key={target.id} value={target.id}>{issueKey(target)} — {issueTitle(target)}</option>)}
                </select>
                <button type="submit" className="td-primary-button" disabled={!linkedIssueId}>Link</button>
              </form>}
              {linkedItems.length ? <div className="td-linked-list">{linkedItems.map((link, index) => <div className="td-linked-row" key={`${link.issueId}-${index}`}>
                <span className="td-linked-type">{link.type || 'Relates to'}</span>
                <button type="button" className="td-table-link" onClick={() => onOpenIssue(link.target.id)}>{issueKey(link.target)} — {issueTitle(link.target)}</button>
                {allow.link && <button type="button" className="td-plain-icon danger" title="Remove link" onClick={() => patchIssue({ links: (issue.links || []).filter((_, itemIndex) => itemIndex !== index) }, 'Work item link removed')}><Icon name="close" size={13} /></button>}
              </div>)}</div> : !linkComposerOpen && <EmptyPanel>No linked work items</EmptyPanel>}
            </section>

            <section className="td-section td-activity-section">
              <div className="td-activity-tabs" role="tablist">
                {['Comments', 'History', 'Work log'].map((tab) => <button key={tab} type="button" role="tab" aria-selected={activeActivityTab === tab} className={activeActivityTab === tab ? 'active' : ''} onClick={() => setActiveActivityTab(tab)}>{tab}</button>)}
              </div>

              {activeActivityTab === 'Comments' && !allow.commentView && <div className="td-permission-note"><Icon name="lock" size={15} /> You do not have permission to view comments on this work item.</div>}
              {activeActivityTab === 'Comments' && allow.commentView && <>
                {allow.commentAdd && <form className="td-comment-composer" onSubmit={addComment}>
                  <textarea value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} placeholder="Add a comment... Use @ to mention a member." rows={3} />
                  <div className="td-comment-tools">
                    <div>
                      <button type="button" title="Bold" onClick={() => setCommentDraft((value) => `${value}**bold**`)}><strong>B</strong></button>
                      <button type="button" title="Italic" onClick={() => setCommentDraft((value) => `${value}_italic_`)}><em>I</em></button>
                      <button type="button" title="Mention" onClick={() => setCommentDraft((value) => `${value}@`)}>@</button>
                      {allow.attachAdd && <label title="Attach file"><Icon name="paperclip" size={14} /><input type="file" multiple accept={FILE_ACCEPT} onChange={(event) => {
                        // Copy the files before clearing the input: the state updater may run later.
                        const picked = Array.from(event.target.files || []);
                        event.target.value = '';
                        setCommentFiles((current) => [...current, ...picked]);
                      }} /></label>}
                    </div>
                    <button type="submit" className="td-primary-button" disabled={uploading || (!commentDraft.trim() && commentFiles.length === 0)}>{uploading && commentFiles.length ? 'Uploading…' : 'Add comment'}</button>
                  </div>
                  {commentFiles.length > 0 && <div className="td-comment-files">{commentFiles.map((file, index) => <span key={`${file.name}-${index}`}>{file.name}<button type="button" onClick={() => setCommentFiles((current) => current.filter((_, i) => i !== index))}>×</button></span>)}</div>}
                </form>}
                {comments.length ? <div className="td-comment-list">{[...comments].reverse().map((comment, index) => renderComment(comment, 0))}</div> : <EmptyPanel>No comments yet</EmptyPanel>}
              </>}

              {activeActivityTab === 'History' && (history.length ? <div className="td-history-list">{[...history].reverse().map((entry, index) => <div className="td-history-row" key={entry.id || index}><span className="td-history-dot" /><div><strong>{entry.actor || 'You'}</strong> {entry.action || 'updated this work item'}{entry.detail && <span> · {entry.detail}</span>}<time>{formatDate(entry.createdAt || entry.date, true)}</time></div></div>)}</div> : <EmptyPanel>No history yet</EmptyPanel>)}

              {activeActivityTab === 'Work log' && <>
                {allow.worklog && <form className="td-worklog-form" onSubmit={addWorkLog}>
                  <label>Time spent (hours)<input type="number" min="0.1" step="0.1" value={workLogHours} onChange={(event) => setWorkLogHours(event.target.value)} placeholder="e.g. 1.5" /></label>
                  <label>Work description<input value={workLogNote} onChange={(event) => setWorkLogNote(event.target.value)} placeholder="What did you work on?" /></label>
                  <button type="submit" className="td-primary-button" disabled={!workLogHours || Number(workLogHours) <= 0}>Log work</button>
                </form>}
                {workLogs.length ? <div className="td-worklog-list">{[...workLogs].reverse().map((entry, index) => <div key={entry.id || index}><strong>{entry.hours}h</strong><span>{entry.note || 'Work logged'}</span><small>{entry.author || 'You'} · {formatDate(entry.createdAt, true)}</small></div>)}</div> : <EmptyPanel>No work log entries</EmptyPanel>}
              </>}
            </section>
          </main>

          <aside className="td-right-panel">
            <section className="td-people-card">
              <h2><Icon name="users" size={15} /> People &amp; responsibilities</h2>
              <div className="td-person-row"><span>Assignee</span><div>{assignee ? <><PersonAvatar person={assignee} className="td-avatar" /><strong>{userName(assignee)}</strong></> : <span className="td-unassigned-label">Unassigned</span>}</div></div>
              <div className="td-person-row"><span>Creator</span><div>{creator ? <><PersonAvatar person={creator} className="td-avatar" /><strong>{userName(creator)}</strong></> : <span className="td-unassigned-label">—</span>}</div></div>
              {issue.team && <div className="td-person-row"><span>Team</span><div><strong>{userName(issue.team)}</strong></div></div>}
            </section>
          </aside>
        </div>

        {startModalOpen && <div className="td-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setStartModalOpen(false); }}>
          <div className="td-start-modal" role="dialog" aria-modal="true">
            <div className="td-modal-title"><h2>Start</h2><button type="button" onClick={() => setStartModalOpen(false)}><Icon name="close" size={15} /></button></div>
            <div className="td-modal-content"><label className="td-form-label">Assignee <b>*</b></label><UserSelect members={members} value={pendingAssignee} onChange={setPendingAssignee} /></div>
            <div className="td-modal-footer"><button type="button" className="td-secondary-button" onClick={() => setStartModalOpen(false)}>Cancel</button><button type="button" className="td-primary-button" disabled={!pendingAssignee} onClick={confirmStart}>Update</button></div>
          </div>
        </div>}

        {workflowOpen && <WorkflowModal spaceId={issue.spaceId ?? space.id} issueType={type} status={issue.status} issueKey={key} onClose={() => setWorkflowOpen(false)} />}
        {deleteConfirmOpen && <div className="td-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteConfirmOpen(false); }}>
          <div className="td-start-modal" role="dialog" aria-modal="true">
            <div className="td-modal-title"><h2>Delete work item?</h2><button type="button" onClick={() => setDeleteConfirmOpen(false)}><Icon name="close" size={15} /></button></div>
            <div className="td-modal-content"><p>Are you sure you want to delete <strong>{key} — {title}</strong>?</p></div>
            <div className="td-modal-footer"><button type="button" className="td-secondary-button" onClick={() => setDeleteConfirmOpen(false)}>Cancel</button><button type="button" className="td-danger-button" onClick={() => onDeleteTask(issue)}>Delete</button></div>
          </div>
        </div>}
      </section>
    </div>
  );
}
