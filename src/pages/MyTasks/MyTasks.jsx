import { useMemo, useState } from 'react';
import Header from '../../components/layout/Header';
import Sidebar from '../../components/layout/Sidebar';
import FilterBar from './components/FilterBar';
import TaskTable from './components/TaskTable';
import { getTaskFieldOptions, getTaskFieldValue } from './filterFields';
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

export default function MyTasks({ onCreateSpace, onNavigate, onOpenSpaceSettings, onDeleteSpace, onGlobalCreate, onOpenTask, spaces = [], allTasks = [] }) {
  // My Tasks remains empty until its own backend query is connected.
  const tasks = allTasks;

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
        task.title,
        task.name,
        task.code,
        task.assignee
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

        <TaskTable tasks={filteredTasks} />
      </main>
    </div>
  );
}
