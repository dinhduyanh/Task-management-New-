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

const FIELD_VALUE_GETTERS = {
  Work: (task) => {
    const code = task.code || task.key || '';
    const title = task.title || task.name || task.workName || '';
    return [code, title].filter(Boolean).join(' — ');
  },
  Assignee: (task) => task.assignee || task.assigneeName || '',
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
