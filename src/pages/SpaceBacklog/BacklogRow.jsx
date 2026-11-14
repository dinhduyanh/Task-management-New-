import { useState } from 'react';
import Icon from '../../components/common/Icon';
import {
  assigneeName,
  getInitials,
  iconForType,
  isCompletedStatus,
  issueKey,
  issueSummary,
  issueType,
  statusTone
} from '../SpacesList/issueHelpers';
import { getIssueStatus, getTransitionOptions } from '../SpacesList/workflows';
import { getEstimate } from './backlogModel';
import MenuButton from './MenuButton';

function EstimateField({ issue, onChange, disabled = false }) {
  const value = getEstimate(issue);
  const [draft, setDraft] = useState(null); // null = not editing
  if (disabled) return <span className={`bl-estimate is-readonly ${value === null ? 'is-empty' : ''}`} title="Estimate (story points)">{value ?? '-'}</span>;

  function commit() {
    if (draft === null) return;
    const text = draft.trim();
    const next = text === '' ? null : Number(text);
    setDraft(null);
    if (next !== null && (!Number.isFinite(next) || next < 0 || next > 999)) return;
    if (next !== value) onChange(next);
  }

  if (draft !== null) {
    return (
      <input
        className="bl-estimate-input"
        type="number"
        min="0"
        max="999"
        step="0.5"
        value={draft}
        autoFocus
        aria-label={`Estimate for ${issueKey(issue)}`}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') setDraft(null);
        }}
        onClick={(event) => event.stopPropagation()}
      />
    );
  }
  return (
    <button
      type="button"
      className={`bl-estimate ${value === null ? 'is-empty' : ''}`}
      title="Estimate (story points). Click to edit."
      aria-label={`Estimate for ${issueKey(issue)}: ${value ?? 'none'}. Edit.`}
      onClick={() => setDraft(value === null ? '' : String(value))}
    >
      {value ?? '-'}
    </button>
  );
}

/** Status dropdown limited to the transitions the issue's workflow allows. */
function StatusSelect({ issue, allIssues, onChange, disabled = false }) {
  const status = getIssueStatus(issue);
  const options = getTransitionOptions(issue, allIssues);
  return (
    <select
      className={`bl-status tone-${statusTone(status)}`}
      value={status}
      aria-label={`Status of ${issueKey(issue)}`}
      disabled={disabled}
      title={disabled ? 'You do not have the Move task permission' : undefined}
      onChange={(event) => onChange(event.target.value)}
      onClick={(event) => event.stopPropagation()}
    >
      <option value={status}>{status}</option>
      {options.map((option) => (
        <option key={option.status} value={option.status} disabled={option.disabled} title={option.reason}>
          {option.hint ? `${option.status} (${option.hint})` : option.status}
        </option>
      ))}
    </select>
  );
}

export default function BacklogRow({
  issue,
  allIssues,
  childCount = 0,
  selected = false,
  showEstimate = true,
  dragging = false,
  dropPosition = null, // 'before' | 'after' | null
  moveTargets = [],
  onToggleSelect,
  onOpen,
  onStatusChange,
  onEstimateChange,
  onMove,
  onMoveToEdge,
  onDelete,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  canMove = true,
  canUpdate = true,
  canDelete = true
}) {
  const type = issueType(issue);
  const status = getIssueStatus(issue);
  const completed = isCompletedStatus(status);
  const assignee = assigneeName(issue);
  const parent = issue.parent;
  const hierarchy = [
    parent ? `Parent: ${parent.key || ''} ${parent.title || parent.name || ''}`.trim() : '',
    childCount ? `${childCount} child item${childCount === 1 ? '' : 's'}` : ''
  ].filter(Boolean).join(' · ');

  return (
    <div
      className={`bl-row ${selected ? 'is-selected' : ''} ${dragging ? 'is-dragging' : ''} ${dropPosition ? `drop-${dropPosition}` : ''}`}
      draggable={canMove}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <input
        type="checkbox"
        className="bl-check"
        checked={selected}
        onChange={onToggleSelect}
        aria-label={`Select ${issueKey(issue)}`}
      />
      <span className={`slv-type-icon type-${type.toLowerCase().replace(/[^a-z]+/g, '-')}`} title={type}>
        <Icon name={iconForType(type)} size={15} />
      </span>
      <button type="button" className={`bl-key ${completed ? 'is-completed' : ''}`} onClick={onOpen}>{issueKey(issue)}</button>
      <button type="button" className="bl-title" onClick={onOpen} title={issueSummary(issue)}>{issueSummary(issue)}</button>
      <span className="bl-hierarchy" title={hierarchy || undefined} aria-label={hierarchy || undefined}>
        {hierarchy && <Icon name="subTask" size={15} />}
      </span>
      <StatusSelect issue={issue} allIssues={allIssues} onChange={(next) => onStatusChange(next)} disabled={!canMove} />
      {showEstimate && <EstimateField issue={issue} onChange={onEstimateChange} disabled={!canUpdate} />}
      <span className={`bl-avatar ${assignee ? '' : 'is-unassigned'}`} title={assignee ? `Assignee: ${assignee}` : 'Unassigned'}>
        {assignee ? getInitials(assignee) : <Icon name="user" size={13} />}
      </span>
      <MenuButton
        label={`Actions for ${issueKey(issue)}`}
        items={[
          { label: 'View details', onSelect: onOpen },
          ...(canMove ? [
            { heading: 'Move to' },
            ...moveTargets.map((target) => ({ label: target.name, onSelect: () => onMove(target.id) })),
            { label: 'Top of list', onSelect: () => onMoveToEdge('top') },
            { label: 'Bottom of list', onSelect: () => onMoveToEdge('bottom') }
          ] : []),
          ...(canDelete ? [{ label: 'Delete', danger: true, onSelect: onDelete }] : [])
        ]}
      />
    </div>
  );
}
