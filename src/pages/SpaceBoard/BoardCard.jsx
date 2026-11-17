import Icon from '../../components/common/Icon';
import PersonAvatar from '../../components/common/PersonAvatar';
import PriorityIcon from '../../components/common/PriorityIcon';
import {
  assigneeName,
  dateValue,
  formatDateOnly,
  iconForType,
  issueKey,
  issueSummary,
  issueType,
  isCompletedStatus,
  toDate
} from '../SpacesList/issueHelpers';
import { getIssueStatus } from '../SpacesList/workflows';
import StatusBadge from '../SpacesList/StatusBadge';

// Custom MIME type so board columns can recognise a dragged card during dragover.
export const ISSUE_DRAG_TYPE = 'application/x-taskflow-issue';

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** A work item on the board. Click (or Enter) opens it; drag to move it to another column. */
export default function BoardCard({ issue, childCount = 0, dragging = false, draggable = true, onOpen, onDragStart, onDragEnd }) {
  const type = issueType(issue);
  const status = getIssueStatus(issue);
  const completed = isCompletedStatus(status);
  const assignee = assigneeName(issue);
  const labels = Array.isArray(issue.labels) ? issue.labels.filter(Boolean) : [];
  const attachments = Array.isArray(issue.attachments) ? issue.attachments.length : 0;
  const due = toDate(dateValue(issue, 'dueDate'));
  const overdue = Boolean(due) && !completed && due < startOfToday();
  const key = issueKey(issue);
  const title = issueSummary(issue);

  const meta = [
    ...labels.slice(0, 2).map((label) => ({ id: `label-${label}`, text: `#${label}` })),
    ...(labels.length > 2 ? [{ id: 'labels-more', text: `+${labels.length - 2}` }] : []),
    ...(attachments ? [{ id: 'attachments', icon: 'paperclip', text: `${attachments} attachment${attachments === 1 ? '' : 's'}` }] : []),
    ...(childCount ? [{ id: 'children', icon: 'subTask', text: `${childCount} child item${childCount === 1 ? '' : 's'}` }] : [])
  ];

  return (
    <article
      className={`sb-card ${dragging ? 'is-dragging' : ''} ${draggable ? '' : 'is-locked'}`}
      draggable={draggable}
      tabIndex={0}
      aria-label={`${key} ${title}. Status ${status}. Press Enter to open.`}
      onClick={onOpen}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onOpen(); } }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(ISSUE_DRAG_TYPE, String(issue.id));
        event.dataTransfer.setData('text/plain', `${issueKey(issue)} ${title}`);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      <div className="sb-card-top">
        <span className={`slv-type-icon type-${type.toLowerCase().replace(/[^a-z]+/g, '-')}`} title={type}>
          <Icon name={iconForType(type)} size={15} />
        </span>
        <span className={`sb-card-key ${completed ? 'is-completed' : ''}`}>{key}</span>
        <StatusBadge status={status} className="sb-card-status" />
      </div>

      <h3 className="sb-card-title" title={title}>{title}</h3>

      {meta.length > 0 && (
        <div className="sb-card-meta">
          {meta.map((item) => (
            <span key={item.id}>
              {item.icon && <Icon name={item.icon} size={12} />}
              {item.text}
            </span>
          ))}
        </div>
      )}

      <div className="sb-card-foot">
        <span
          className={`sb-due ${overdue ? 'is-overdue' : ''} ${due ? '' : 'is-empty'}`}
          title={due ? `${overdue ? 'Overdue · ' : ''}Due ${formatDateOnly(due)}` : 'No due date'}
        >
          <Icon name="flag" size={13} />
          {due ? formatDateOnly(due) : 'No due date'}
        </span>
        <span className="sb-card-people">
          <span title={`Priority: ${issue.priority || 'Medium'}`}><PriorityIcon priority={issue.priority || 'Medium'} size={16} /></span>
          <span className={`sb-avatar ${assignee ? '' : 'is-unassigned'}`} title={assignee ? `Assignee: ${assignee}` : 'Unassigned'}>
            {assignee ? <PersonAvatar person={issue.assignee && typeof issue.assignee === 'object' ? issue.assignee : assignee} className="sb-avatar-inner" /> : <Icon name="user" size={13} />}
          </span>
        </span>
      </div>
    </article>
  );
}
