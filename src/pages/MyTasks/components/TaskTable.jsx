import { useMemo, useState } from 'react';
import Icon from '../../../components/common/Icon';
import PriorityIcon from '../../../components/common/PriorityIcon';
import {
  getAssigneeName,
  getTaskCode,
  getTaskTitle,
  getTaskType
} from '../filterFields';
import './TaskTable.css';

function initialsOf(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2);
  return letters.toUpperCase();
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function PriorityBadge({ priority }) {
  return (
    <span className="priority-value">
      <PriorityIcon priority={priority} size={16} />
      <span>{priority || 'Medium'}</span>
    </span>
  );
}

function StatusBadge({ status }) {
  if (!status) return <span className="status-badge">—</span>;
  const statusClass = String(status).toLowerCase().replaceAll(' ', '-');
  return <span className={`status-badge status-${statusClass}`}>{status}</span>;
}

export default function TaskTable({ tasks }) {
  const [selectedTaskIds, setSelectedTaskIds] = useState([]);

  const visibleTaskIds = useMemo(() => tasks.map((task) => task.id), [tasks]);
  const selectedVisibleCount = visibleTaskIds.filter((id) => selectedTaskIds.includes(id)).length;
  const allVisibleSelected = visibleTaskIds.length > 0 && selectedVisibleCount === visibleTaskIds.length;

  const handleSelectOne = (taskId) => {
    setSelectedTaskIds((current) => (
      current.includes(taskId)
        ? current.filter((id) => id !== taskId)
        : [...current, taskId]
    ));
  };

  const handleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedTaskIds((current) => current.filter((id) => !visibleTaskIds.includes(id)));
      return;
    }

    setSelectedTaskIds((current) => [...new Set([...current, ...visibleTaskIds])]);
  };

  return (
    <section className="table-card" aria-label="Task list">
      <div className="table-card-header">
        <div>
          <h2>All Tasks</h2>
          <p>View and manage your assigned tasks.</p>
        </div>
        <span className="task-count">{tasks.length} tasks</span>
      </div>

      <div className="table-scroll">
        <table className="task-table">
          <thead>
            <tr>
              <th className="checkbox-column">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={handleSelectAll}
                  aria-label="Select all visible tasks"
                />
              </th>
              <th className="work-column">Work</th>
              <th>Assignee</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Create Date</th>
              <th>Due Date</th>
            </tr>
          </thead>

          <tbody>
            {tasks.length > 0 ? tasks.map((task) => {
              const code = getTaskCode(task);
              const title = getTaskTitle(task) || 'Untitled work item';
              const type = getTaskType(task).toLowerCase();
              const assignee = getAssigneeName(task);
              return (
                <tr key={task.id} className={selectedTaskIds.includes(task.id) ? 'selected-row' : ''}>
                  <td className="checkbox-column">
                    <input
                      type="checkbox"
                      checked={selectedTaskIds.includes(task.id)}
                      onChange={() => handleSelectOne(task.id)}
                      aria-label={`Select ${title}`}
                    />
                  </td>
                  <td>
                    <div className="work-cell">
                      <span className={`work-type-icon ${type === 'bug' ? 'bug' : 'task'}`}>
                        <Icon name={type === 'bug' ? 'bug' : 'tasks'} size={15} />
                      </span>
                      {code && <span className="task-code">{code}</span>}
                      <span className="task-name">{title}</span>
                    </div>
                  </td>
                  <td>
                    <div className="assignee-cell">
                      {assignee ? (
                        <>
                          <span className="assignee-avatar">{initialsOf(assignee)}</span>
                          <span>{assignee}</span>
                        </>
                      ) : (
                        <span>Unassigned</span>
                      )}
                    </div>
                  </td>
                  <td><PriorityBadge priority={task.priority} /></td>
                  <td><StatusBadge status={task.status} /></td>
                  <td className="date-cell">{formatDate(task.createdAt || task.created)}</td>
                  <td className="date-cell">{formatDate(task.dueDate || task.due)}</td>
                </tr>
              );
            }) : (
              <tr>
                <td colSpan="7" className="empty-state">
                  <Icon name="file" size={30} />
                  <strong>No tasks found</strong>
                  <span>Try changing your search or filters.</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="table-footer">
        <span>{selectedVisibleCount} selected</span>
        <span>Showing {tasks.length} tasks</span>
      </div>
    </section>
  );
}
