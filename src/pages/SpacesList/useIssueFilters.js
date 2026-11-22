import { useMemo, useState } from 'react';
import { ORDER_PRESETS, assigneeName, matchesIssueFilters, sortIssues } from './issueHelpers';

/**
 * Filter + sort state for a project view (Board, Timeline). Pass the work items of
 * the Space; returns the filtered/sorted list plus everything IssueToolbar needs.
 */
export default function useIssueFilters(issues) {
  const [search, setSearch] = useState('');
  const [types, setTypes] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [orderBy, setOrderBy] = useState('All');
  const [moreFields, setMoreFieldsState] = useState([]);
  const [priorities, setPriorities] = useState([]);
  const [dateRanges, setDateRanges] = useState({});

  const assigneeOptions = useMemo(
    () => [...new Set(issues.map(assigneeName).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [issues]
  );

  const filtered = useMemo(() => {
    const rows = issues.filter((issue) => matchesIssueFilters(issue, {
      keyword: search, types, assignees, statuses, priorities, moreFields, dateRanges
    }));
    const [field, direction] = ORDER_PRESETS[orderBy] || [];
    return sortIssues(rows, field, direction);
  }, [issues, search, types, assignees, statuses, priorities, moreFields, dateRanges, orderBy]);

  /** Updates the "More filters" fields and drops the values of removed ones. */
  function setMoreFields(next) {
    const removed = moreFields.filter((field) => !next.includes(field));
    if (removed.includes('Priority')) setPriorities([]);
    setDateRanges((current) => {
      const updated = { ...current };
      removed.forEach((field) => delete updated[field]);
      return updated;
    });
    setMoreFieldsState(next);
  }

  function toggleAssignee(name) {
    setAssignees((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name]);
  }

  function clearFilters() {
    setSearch('');
    setTypes([]);
    setAssignees([]);
    setStatuses([]);
    setPriorities([]);
    setMoreFieldsState([]);
    setDateRanges({});
    setOrderBy('All');
  }

  const hasFilters = Boolean(search || types.length || assignees.length || statuses.length ||
    priorities.length || moreFields.length || orderBy !== 'All');

  return {
    search, setSearch,
    types, setTypes,
    assignees, setAssignees, toggleAssignee,
    statuses, setStatuses,
    orderBy, setOrderBy,
    moreFields, setMoreFields,
    priorities, setPriorities,
    dateRanges, setDateRanges,
    assigneeOptions,
    filtered,
    hasFilters,
    clearFilters
  };
}
