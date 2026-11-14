import { useState } from 'react';
import Icon from '../../components/common/Icon';
import { ExtraFilterControls, MoreFilters, MultiFilter, OrderFilter } from './IssueFilters';
import { ISSUE_TYPES, STATUSES, getInitials } from './issueHelpers';
import './IssueToolbar.css';

const MAX_AVATAR_FILTERS = 6;

/**
 * Search, assignee avatars and filters for a project view.
 * `filters` comes from useIssueFilters; `children` are extra actions shown on the right.
 * With `collapsible`, the filter pills sit behind a "Filter" button (used by Backlog).
 */
export default function IssueToolbar({ filters, statusOptions = STATUSES, searchLabel = 'Search work items', searchPlaceholder = 'Search', collapsible = false, children }) {
  const f = filters;
  const [expanded, setExpanded] = useState(false);
  const activeCount = f.types.length + f.statuses.length + f.priorities.length + f.moreFields.length + (f.orderBy !== 'All' ? 1 : 0);
  const showPills = !collapsible || expanded;
  return (
    <section className={`slv-toolbar it-toolbar ${collapsible ? 'is-collapsible' : ''}`} aria-label="Filters">
      <div className="slv-search">
        <Icon name="search" size={15} />
        <input placeholder={searchPlaceholder} value={f.search} onChange={(event) => f.setSearch(event.target.value)} aria-label={searchLabel} />
        {f.search && <button type="button" onClick={() => f.setSearch('')} aria-label="Clear search">×</button>}
      </div>

      {f.assigneeOptions.length > 0 && (
        <div className="it-avatar-filters" role="group" aria-label="Filter by assignee">
          {f.assigneeOptions.slice(0, MAX_AVATAR_FILTERS).map((name) => (
            <button
              key={name}
              type="button"
              className={`it-avatar-filter ${f.assignees.includes(name) ? 'is-active' : ''}`}
              aria-pressed={f.assignees.includes(name)}
              title={name}
              onClick={() => f.toggleAssignee(name)}
            >
              {getInitials(name)}
            </button>
          ))}
          <button
            type="button"
            className={`it-avatar-filter is-unassigned ${f.assignees.includes('Unassigned') ? 'is-active' : ''}`}
            aria-pressed={f.assignees.includes('Unassigned')}
            title="Unassigned"
            onClick={() => f.toggleAssignee('Unassigned')}
          >
            <Icon name="user" size={13} />
          </button>
        </div>
      )}

      {collapsible && (
        <button
          type="button"
          className={`it-filter-toggle ${expanded ? 'is-open' : ''}`}
          aria-expanded={expanded}
          aria-controls="it-filter-pills"
          onClick={() => setExpanded((value) => !value)}
        >
          <Icon name="filter" size={14} /> Filter{activeCount > 0 && <b>{activeCount}</b>}
        </button>
      )}

      {showPills && (
        <div className="it-filter-pills" id="it-filter-pills">
          <MultiFilter label="Issue Type" options={ISSUE_TYPES} selected={f.types} onChange={f.setTypes} />
          <MultiFilter label="Assignee" options={['Unassigned', ...f.assigneeOptions]} selected={f.assignees} onChange={f.setAssignees} width={210} />
          <MultiFilter label="Status" options={statusOptions} selected={f.statuses} onChange={f.setStatuses} />
          <OrderFilter value={f.orderBy} onChange={f.setOrderBy} />
          <ExtraFilterControls
            moreFields={f.moreFields}
            dateRanges={f.dateRanges}
            onDateRangesChange={f.setDateRanges}
            priorities={f.priorities}
            onPrioritiesChange={f.setPriorities}
            onRemoveField={(field) => f.setMoreFields(f.moreFields.filter((item) => item !== field))}
          />
          <MoreFilters selected={f.moreFields} onChange={f.setMoreFields} />
        </div>
      )}
      {f.hasFilters && (
        <button type="button" className="it-clear-filters" onClick={f.clearFilters}>
          <Icon name="close" size={13} /> Clear filters
        </button>
      )}
      {children}
    </section>
  );
}
