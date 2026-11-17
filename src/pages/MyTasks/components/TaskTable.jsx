import { useMemo, useState } from 'react';
import Icon from '../../../components/common/Icon';
import Pagination from '../../../components/common/Pagination';
import { useAppShell } from '../../../context/appShellContext';
import { canInSpace, spaceOfItem } from '../../../services/projectPermissions';
import { AssigneeCell, EditableDateCell, PriorityCell, StatusCell } from '../../SpacesList/SpacesList';
import { dateValue, formatDateTime, iconForType, isInSpace, issueKey, issueSummary, issueType } from '../../SpacesList/issueHelpers';
import './TaskTable.css';

/**
 * My Tasks table: every cell edits the work item in place, like the List view of a
 * project. Each row follows the permissions of the project it belongs to.
 */
export default function TaskTable({
  tasks,
  allTasks = [],
  spaces = [],
  title = 'All Tasks',
  subtitle = '',
  onOpenTask = () => {},
  onUpdateTask = () => {},
  onChangeStatus = () => {},
  onMoveSelected = null,
  onDeleteSelected = null
}) {
  const { user } = useAppShell();
  const [selectedTaskIds, setSelectedTaskIds] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const pageCount = Math.max(1, Math.ceil(tasks.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = tasks.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const visibleTaskIds = useMemo(() => pageRows.map((task) => task.id), [pageRows]);
  const selectedVisibleCount = visibleTaskIds.filter((id) => selectedTaskIds.includes(id)).length;
  const allVisibleSelected = visibleTaskIds.length > 0 && selectedVisibleCount === visibleTaskIds.length;
  const selectedTasks = tasks.filter((task) => selectedTaskIds.includes(task.id));
  const can = (key, task) => canInSpace(spaceOfItem(spaces, task), key, task, user);
  const sameProject = selectedTasks.length > 0 && selectedTasks.every((task) => String(task.spaceId) === String(selectedTasks[0].spaceId));

  const handleSelectOne = (taskId) => {
    setSelectedTaskIds((current) => (current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId]));
  };
  const handleSelectAll = () => {
    if (allVisibleSelected) setSelectedTaskIds((current) => current.filter((id) => !visibleTaskIds.includes(id)));
    else setSelectedTaskIds((current) => [...new Set([...current, ...visibleTaskIds])]);
  };

  return (
    <section className="table-card" aria-label="Task list">
      <div className="table-card-header">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <span className="task-count">{tasks.length} task{tasks.length === 1 ? '' : 's'}</span>
      </div>

      {selectedTasks.length > 0 && (
        <div className="mt-bulk" role="region" aria-label="Selected tasks">
          <strong>{selectedTasks.length} selected</strong>
          {onMoveSelected && sameProject && selectedTasks.every((task) => can('task.move', task)) && (
            <button type="button" onClick={() => onMoveSelected(selectedTasks, () => setSelectedTaskIds([]))}><Icon name="spaces" size={14} /> Move to project</button>
          )}
          {onDeleteSelected && selectedTasks.every((task) => can('task.delete', task)) && (
            <button type="button" className="danger" onClick={() => onDeleteSelected(selectedTasks, () => setSelectedTaskIds([]))}><Icon name="trash" size={14} /> Delete</button>
          )}
          {!sameProject && <span className="mt-bulk-hint">Select tasks of one project to move them.</span>}
          <button type="button" onClick={() => setSelectedTaskIds([])}>Clear selection</button>
        </div>
      )}

      <div className="table-scroll">
        <table className="task-table">
          <thead>
            <tr>
              <th className="checkbox-column">
                <input type="checkbox" checked={allVisibleSelected} onChange={handleSelectAll} aria-label="Select all visible tasks" disabled={!pageRows.length} />
              </th>
              <th className="work-column">Work</th>
              <th className="is-center">Project</th>
              <th className="is-center">Assignee</th>
              <th className="is-center">Priority</th>
              <th className="is-center">Status</th>
              <th className="is-center">Create Date</th>
              <th className="is-center">Start Date</th>
              <th className="is-center">Due Date</th>
            </tr>
          </thead>

          <tbody>
            {pageRows.length > 0 ? pageRows.map((task) => {
              const space = spaceOfItem(spaces, task);
              const type = issueType(task);
              const spaceTasks = space ? allTasks.filter((item) => isInSpace(item, space)) : [];
              return (
                <tr key={task.id} className={selectedTaskIds.includes(task.id) ? 'selected-row' : ''}>
                  <td className="checkbox-column">
                    <input type="checkbox" checked={selectedTaskIds.includes(task.id)} onChange={() => handleSelectOne(task.id)} aria-label={`Select ${issueKey(task)}`} />
                  </td>
                  <td>
                    <div className="work-cell slv-work-cell">
                      <span className={`slv-type-icon type-${type.toLowerCase().replace(/[^a-z]+/g, '-')}`} title={type}><Icon name={iconForType(type)} size={15} /></span>
                      <button type="button" className="slv-key" onClick={() => onOpenTask(task)} title={`Open ${issueKey(task)} details`}>{issueKey(task)}</button>
                      <button type="button" className="task-name mt-title" onClick={() => onOpenTask(task)} title={issueSummary(task)}>{issueSummary(task)}</button>
                    </div>
                  </td>
                  <td className="is-center"><span className="mt-project" title={space?.name || ''}>{space?.name || task.spaceCode || '—'}</span></td>
                  <td className="is-center">
                    <AssigneeCell value={task.assignee} members={space?.members || []} disabled={!can('task.assign', task)} onAssign={(member) => onUpdateTask(task.id, { assignee: member })} />
                  </td>
                  <td className="is-center"><PriorityCell value={task.priority} disabled={!can('task.update', task)} onChange={(value) => onUpdateTask(task.id, { priority: value })} /></td>
                  <td className="is-center"><StatusCell issue={task} allIssues={spaceTasks} disabled={!can('task.move', task)} onChange={(value) => onChangeStatus(task, value)} /></td>
                  <td className="date-cell is-center">{formatDateTime(dateValue(task, 'createdAt'))}</td>
                  <td className="date-cell slv-date-cell is-center"><EditableDateCell value={dateValue(task, 'startDate')} label="Start Date" disabled={!can('task.update', task)} onChange={(value) => onUpdateTask(task.id, { startDate: value })} /></td>
                  <td className="date-cell slv-date-cell is-center"><EditableDateCell value={dateValue(task, 'dueDate')} label="Due Date" disabled={!can('task.update', task)} onChange={(value) => onUpdateTask(task.id, { dueDate: value })} /></td>
                </tr>
              );
            }) : (
              <tr>
                <td colSpan="9" className="empty-state">
                  <Icon name="file" size={30} />
                  <strong>No tasks found</strong>
                  <span>Try changing your search or filters.</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination
        page={currentPage}
        pageSize={pageSize}
        total={tasks.length}
        pageSizes={[10, 20, 50]}
        label="tasks"
        onPageChange={setPage}
        onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
      />
    </section>
  );
}
