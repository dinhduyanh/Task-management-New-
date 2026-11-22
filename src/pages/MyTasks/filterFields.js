// Additional fields that can be added to the My Tasks filter toolbar.
// Keep the field labels and task-value mapping in one place so the filter UI
// and filtering logic stay consistent.

export const MORE_FILTER_FIELDS = [
  { value: 'Work', label: 'Work' },
  { value: 'Assignee', label: 'Assignee' },
  { value: 'Create Date', label: 'Create Date' },
  { value: 'Updated Date', label: 'Updated Date' },
  { value: 'Start Date', label: 'Start Date' },
  { value: 'Due Date', label: 'Due Date' },
  { value: 'Difficulty', label: 'Difficulty' }
];

// Work items from the backend may store people as objects
// ({ id, name, fullName, ... }) or as plain strings, depending on where they
// were created. Always read them through these helpers before rendering.
export function getPersonName(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return String(value.fullName || value.name || value.username || value.email || '');
}

export function getAssigneeName(task) {
  return getPersonName(task?.assignee) || getPersonName(task?.assigneeName);
}

export function getTaskCode(task) {
  return String(task?.code || task?.key || task?.taskCode || '');
}

export function getTaskTitle(task) {
  return String(task?.title || task?.summary || task?.name || task?.workName || '');
}

export function getTaskType(task) {
  return String(task?.issueType || task?.type || 'Task');
}

const FIELD_VALUE_GETTERS = {
  Work: (task) => [getTaskCode(task), getTaskTitle(task)].filter(Boolean).join(' — '),
  Assignee: getAssigneeName,
  'Create Date': (task) => task.createdAt || task.created || task.createDate || '',
  'Updated Date': (task) => task.updatedAt || task.updated || task.updatedDate || task.lastUpdated || '',
  'Start Date': (task) => task.startDate || task.start || '',
  'Due Date': (task) => task.dueDate || task.due || task.endDate || '',
  Difficulty: (task) => task.difficulty || ''
};

export function getTaskFieldValue(task, field) {
  const getter = FIELD_VALUE_GETTERS[field];
  const value = getter ? getter(task) : '';
  return value === null || value === undefined ? '' : String(value).trim();
}

export function getTaskFieldOptions(tasks) {
  const optionsByField = {};

  for (const field of MORE_FILTER_FIELDS) {
    const uniqueValues = new Set();

    for (const task of tasks) {
      const value = getTaskFieldValue(task, field.value);
      if (value) uniqueValues.add(value);
    }

    optionsByField[field.value] = [...uniqueValues]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
      .map((value) => ({ value, label: value }));
  }

  return optionsByField;
}
