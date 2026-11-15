import { useMemo, useState } from 'react';
import Header from '../../components/layout/Header';
import Sidebar from '../../components/layout/Sidebar';
import Toast from '../../components/common/Toast';
import { useAppShell } from '../../context/appShellContext';
import { spaceOfItem } from '../../services/projectPermissions';
import { IssueModal, MoveModal, StartTransitionModal } from '../SpacesList/SpacesList';
import TaskDetailDrawer from '../SpacesList/TaskDetailDrawer';
import { assigneeName, isInSpace, issueKey } from '../SpacesList/issueHelpers';
import { validateIssueTransition } from '../SpacesList/workflows';
import { ConfirmModal } from '../SpaceBacklog/SprintModals';
import FilterBar from './components/FilterBar';
import TaskTable from './components/TaskTable';
import {
  getAssigneeName,
  getTaskCode,
  getTaskFieldOptions,
  getTaskFieldValue,
  getTaskTitle
} from './filterFields';
import './MyTasks.css';

function parseDate(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;

  const parts = String(value).match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (parts) {
    const [, day, month, year] = parts;
    return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
  }

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function getTaskDate(task, keys) {
  for (const key of keys) {
    if (task[key]) return parseDate(task[key]);
  }
  return 0;
}

function getPriorityRank(value) {
  const rank = { Highest: 1, High: 2, Medium: 3, Low: 4, Lowest: 5 };
  return rank[value] ?? 99;
}

function getDifficultyRank(value) {
  const rank = {
    Highest: 1,
    High: 2,
    Hard: 2,
    Medium: 3,
    Moderate: 3,
    Low: 4,
    Easy: 4,
    Lowest: 5
  };
  if (typeof value === 'number') return value;
  return rank[value] ?? 99;
}

function areEqual(first, second) {
  return JSON.stringify(first) === JSON.stringify(second);
}

const SCOPES = [
  { id: 'all', label: 'All my projects' },
  { id: 'assigned', label: 'Assigned to me' },
  { id: 'created', label: 'Created by me' }
];

function personId(value) {
  if (!value) return '';
  return typeof value === 'object' ? String(value.id || value.userId || '') : String(value);
}

export default function MyTasks({
  onCreateSpace, onNavigate, onOpenSpaceSettings, onDeleteSpace, onGlobalCreate, onOpenTask,
  spaces = [], allTasks = [],
  onUpdateTask = async () => null,
  onCreateTask = async () => null,
  onDeleteTasks = async () => {},
  onMoveTasks = async () => null
}) {
  const { user } = useAppShell();
  const [scope, setScope] = useState('all');
  const [detailTaskId, setDetailTaskId] = useState(null);
  const [createRequest, setCreateRequest] = useState(null); // { space, parentId, allowedIssueTypes }
  const [moveRequest, setMoveRequest] = useState(null); // { tasks, space, done }
  const [deleteRequest, setDeleteRequest] = useState(null); // { tasks, done }
  const [startRequest, setStartRequest] = useState(null); // { task, status }
  const [startAssigneeId, setStartAssigneeId] = useState('');
  const [toast, setToast] = useState(null);

  const scopeCounts = useMemo(() => ({
    all: allTasks.length,
    assigned: allTasks.filter((task) => personId(task.assignee || task.assigneeId) === String(user?.id)).length,
    created: allTasks.filter((task) => personId(task.creator || task.creatorId) === String(user?.id)).length
  }), [allTasks, user]);
  const tasks = useMemo(() => {
    if (scope === 'assigned') return allTasks.filter((task) => personId(task.assignee || task.assigneeId) === String(user?.id));
    if (scope === 'created') return allTasks.filter((task) => personId(task.creator || task.creatorId) === String(user?.id));
    return allTasks;
  }, [allTasks, scope, user]);

  // Search has its own apply rule: press Enter to run the search.
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');

  // Draft filter values: users can change these without filtering immediately.
  const [priorities, setPriorities] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [orderBy, setOrderBy] = useState('Newest created');
  const [selectedFields, setSelectedFields] = useState([]);
  const [fieldFilters, setFieldFilters] = useState({});

  // Applied filter values: updated only by clicking the search icon
  // displayed to the right of More Filter.
  const [appliedPriorities, setAppliedPriorities] = useState([]);
  const [appliedStatuses, setAppliedStatuses] = useState([]);
  const [appliedOrderBy, setAppliedOrderBy] = useState('Newest created');
  const [appliedSelectedFields, setAppliedSelectedFields] = useState([]);
  const [appliedFieldFilters, setAppliedFieldFilters] = useState({});

  // Build the available values for dynamic fields from actual task records.
  const fieldOptions = useMemo(() => getTaskFieldOptions(tasks), [tasks]);

  function handleSelectedFieldsChange(nextFields) {
    setSelectedFields(nextFields);

    // Remove unsaved values for fields that the user removes from the toolbar.
    setFieldFilters((current) => {
      const next = {};
      for (const field of nextFields) {
        if (current[field]) next[field] = current[field];
      }
      return next;
    });
  }

  function handleFieldFilterChange(field, values) {
    setFieldFilters((current) => ({
      ...current,
      [field]: values
    }));
  }

  function handleApplyFilters() {
    setAppliedPriorities([...priorities]);
    setAppliedStatuses([...statuses]);
    setAppliedOrderBy(orderBy);
    setAppliedSelectedFields([...selectedFields]);
    setAppliedFieldFilters({ ...fieldFilters });
  }

  function handleSearchSubmit() {
    // Search is intentionally independent from the filter Apply button.
    setAppliedSearch(searchInput.trim());
  }

  const hasPendingFilterChanges =
    !areEqual(priorities, appliedPriorities) ||
    !areEqual(statuses, appliedStatuses) ||
    orderBy !== appliedOrderBy ||
    !areEqual(selectedFields, appliedSelectedFields) ||
    !areEqual(fieldFilters, appliedFieldFilters);

  const filteredTasks = useMemo(() => {
    const keyword = appliedSearch.toLowerCase();

    const result = tasks.filter((task) => {
      const searchableText = [
        getTaskTitle(task),
        getTaskCode(task),
        getAssigneeName(task)
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      const matchesSearch = !keyword || searchableText.includes(keyword);
      const matchesPriority =
        appliedPriorities.length === 0 || appliedPriorities.includes(task.priority);
      const matchesStatus =
        appliedStatuses.length === 0 || appliedStatuses.includes(task.status);

      const matchesDynamicFields = appliedSelectedFields.every((field) => {
        const selectedValues = appliedFieldFilters[field] || [];
        if (selectedValues.length === 0) return true;
        return selectedValues.includes(getTaskFieldValue(task, field));
      });

      return (
        matchesSearch &&
        matchesPriority &&
        matchesStatus &&
        matchesDynamicFields
      );
    });

    const sorters = {
      'Newest created': (a, b) =>
        getTaskDate(b, ['createdAt', 'created', 'createDate']) -
        getTaskDate(a, ['createdAt', 'created', 'createDate']),
      'Oldest created': (a, b) =>
        getTaskDate(a, ['createdAt', 'created', 'createDate']) -
        getTaskDate(b, ['createdAt', 'created', 'createDate']),
      'Most recently updated': (a, b) =>
        getTaskDate(b, ['updatedAt', 'updated', 'updatedDate', 'lastUpdated']) -
        getTaskDate(a, ['updatedAt', 'updated', 'updatedDate', 'lastUpdated']),
      'Least recently updated': (a, b) =>
        getTaskDate(a, ['updatedAt', 'updated', 'updatedDate', 'lastUpdated']) -
        getTaskDate(b, ['updatedAt', 'updated', 'updatedDate', 'lastUpdated']),
      'Highest priority first': (a, b) =>
        getPriorityRank(a.priority) - getPriorityRank(b.priority),
      'Lowest priority first': (a, b) =>
        getPriorityRank(b.priority) - getPriorityRank(a.priority),
      'Highest difficulty first': (a, b) =>
        getDifficultyRank(a.difficulty) - getDifficultyRank(b.difficulty),
      'Lowest difficulty first': (a, b) =>
        getDifficultyRank(b.difficulty) - getDifficultyRank(a.difficulty),
      'Latest start date': (a, b) =>
        getTaskDate(b, ['startDate', 'start']) -
        getTaskDate(a, ['startDate', 'start']),
      'Earliest start date': (a, b) =>
        getTaskDate(a, ['startDate', 'start']) -
        getTaskDate(b, ['startDate', 'start']),
      'Latest due date': (a, b) =>
        getTaskDate(b, ['dueDate', 'due', 'endDate']) -
        getTaskDate(a, ['dueDate', 'due', 'endDate']),
      'Earliest due date': (a, b) =>
        getTaskDate(a, ['dueDate', 'due', 'endDate']) -
        getTaskDate(b, ['dueDate', 'due', 'endDate'])
    };

    return [...result].sort(
      sorters[appliedOrderBy] ?? sorters['Newest created']
    );
  }, [
    tasks,
    appliedSearch,
    appliedPriorities,
    appliedStatuses,
    appliedOrderBy,
    appliedSelectedFields,
    appliedFieldFilters
  ]);

  const detailTask = detailTaskId === null ? null : allTasks.find((task) => String(task.id) === String(detailTaskId)) || null;
  const detailSpace = detailTask ? spaceOfItem(spaces, detailTask) : null;
  const tasksOf = (space) => (space ? allTasks.filter((task) => isInSpace(task, space)) : []);

  function changeStatus(task, status) {
    const space = spaceOfItem(spaces, task);
    const result = validateIssueTransition(task, status, tasksOf(space));
    if (!result.allowed) {
      setToast({ type: 'error', message: result.reason || 'This transition is not allowed.' });
      return;
    }
    if (status === 'In Progress' && !assigneeName(task)) {
      setStartRequest({ task, status });
      setStartAssigneeId('');
      return;
    }
    onUpdateTask(task.id, { status });
  }

  async function moveTasks(targetId) {
    const target = spaces.find((space) => String(space.id) === String(targetId));
    if (!target || !moveRequest) return;
    const moved = await onMoveTasks(moveRequest.tasks, target);
    if (moved) {
      setToast({ type: 'success', message: `${moved.length} work item${moved.length === 1 ? '' : 's'} moved to ${target.name}.` });
      moveRequest.done?.();
    }
    setMoveRequest(null);
  }

  return (
    <div className="app-shell">
      <Header spaces={spaces} tasks={allTasks} onGlobalCreate={onGlobalCreate} onOpenTask={onOpenTask} />
      <Sidebar
        activeSection="My Tasks"
        spaces={spaces}
        onCreateSpace={onCreateSpace}
        onNavigate={onNavigate}
        onOpenSpaceSettings={onOpenSpaceSettings}
        onDeleteSpace={onDeleteSpace}
      />

      <main className="main-content">
        <div className="page-heading">
          <div>
            <div className="breadcrumb">
              My Workspace <span>/</span> My Tasks
            </div>
            <h1>My Tasks</h1>
          </div>
        </div>

        <FilterBar
          search={searchInput}
          onSearchChange={setSearchInput}
          onSearchSubmit={handleSearchSubmit}
          priorities={priorities}
          onPrioritiesChange={setPriorities}
          statuses={statuses}
          onStatusesChange={setStatuses}
          orderBy={orderBy}
          onOrderByChange={setOrderBy}
          selectedFields={selectedFields}
          onSelectedFieldsChange={handleSelectedFieldsChange}
          fieldOptions={fieldOptions}
          fieldFilters={fieldFilters}
          onFieldFilterChange={handleFieldFilterChange}
          onApplyFilters={handleApplyFilters}
          hasPendingFilterChanges={hasPendingFilterChanges}
        />

        <div className="mt-scope" role="group" aria-label="Which tasks">
          {SCOPES.map((item) => (
            <button key={item.id} type="button" aria-pressed={scope === item.id} onClick={() => setScope(item.id)}>
              {item.label}<span>{scopeCounts[item.id]}</span>
            </button>
          ))}
        </div>

        <TaskTable
          tasks={filteredTasks}
          allTasks={allTasks}
          spaces={spaces}
          title={SCOPES.find((item) => item.id === scope).label}
          subtitle="Click a task to open it. Fields you may change can be edited in place."
          onOpenTask={(task) => setDetailTaskId(task.id)}
          onUpdateTask={onUpdateTask}
          onChangeStatus={changeStatus}
          onMoveSelected={(selected, done) => setMoveRequest({ tasks: selected, space: spaceOfItem(spaces, selected[0]), done })}
          onDeleteSelected={(selected, done) => setDeleteRequest({ tasks: selected, done })}
        />
      </main>

      {detailTask && detailSpace && (
        <TaskDetailDrawer
          key={detailTask.id}
          issue={detailTask}
          allIssues={tasksOf(detailSpace)}
          space={detailSpace}
          onClose={() => setDetailTaskId(null)}
          onUpdateTask={onUpdateTask}
          onDeleteTask={(issue) => { onDeleteTasks([issue.id]); setDetailTaskId(null); }}
          onCloneTask={async (payload) => {
            const created = await onCreateTask(payload);
            if (created) setToast({ type: 'success', message: `${issueKey(created)} created.` });
            return created;
          }}
          onCreateChild={(parent, allowedIssueTypes) => setCreateRequest({ space: detailSpace, parentId: String(parent.id), allowedIssueTypes })}
          onOpenIssue={(issueId) => setDetailTaskId(issueId)}
          onMoveTask={(issue) => setMoveRequest({ tasks: [issue], space: detailSpace })}
        />
      )}

      {createRequest && (
        <IssueModal
          space={createRequest.space}
          existingIssues={tasksOf(createRequest.space)}
          initialParentId={createRequest.parentId}
          allowedIssueTypes={createRequest.allowedIssueTypes}
          onClose={() => setCreateRequest(null)}
          onCreate={onCreateTask}
        />
      )}

      {moveRequest && (
        <MoveModal
          spaces={spaces}
          currentSpace={moveRequest.space}
          count={moveRequest.tasks.length}
          onClose={() => setMoveRequest(null)}
          onMove={moveTasks}
        />
      )}

      {deleteRequest && (
        <ConfirmModal
          title={`Delete ${deleteRequest.tasks.length === 1 ? issueKey(deleteRequest.tasks[0]) : `${deleteRequest.tasks.length} work items`}?`}
          message="Deleted work items cannot be restored."
          onClose={() => setDeleteRequest(null)}
          onConfirm={() => {
            onDeleteTasks(deleteRequest.tasks.map((task) => task.id));
            deleteRequest.done?.();
            setDeleteRequest(null);
          }}
        />
      )}

      {startRequest && (
        <StartTransitionModal
          issues={[startRequest.task]}
          members={spaceOfItem(spaces, startRequest.task)?.members || []}
          assigneeId={startAssigneeId}
          onAssigneeChange={setStartAssigneeId}
          onClose={() => setStartRequest(null)}
          onConfirm={(assignee) => {
            onUpdateTask(startRequest.task.id, { status: startRequest.status, assignee });
            setStartRequest(null);
          }}
        />
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
