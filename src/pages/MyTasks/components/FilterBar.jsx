import { useEffect, useMemo, useRef, useState } from 'react';
import PriorityIcon from '../../../components/common/PriorityIcon';
import { MORE_FILTER_FIELDS } from '../filterFields';
import './FilterBar.css';

const PRIORITY_OPTIONS = [
  { value: 'High', label: 'High', icon: 'high' },
  { value: 'Highest', label: 'Highest', icon: 'highest' },
  { value: 'Low', label: 'Low', icon: 'low' },
  { value: 'Lowest', label: 'Lowest', icon: 'lowest' },
  { value: 'Medium', label: 'Medium', icon: 'medium' }
];

const STATUS_OPTIONS = [
  { value: 'Backlog', label: 'Backlog' },
  { value: 'To Do', label: 'To Do' },
  { value: 'In Progress', label: 'In Progress' },
  { value: 'In Review', label: 'In Review' },
  { value: 'Blocked', label: 'Blocked' },
  { value: 'Done', label: 'Done' },
  { value: 'Cancel', label: 'Cancel' }
];

const ORDER_OPTIONS = [
  { value: 'Newest created', label: 'Newest created' },
  { value: 'Oldest created', label: 'Oldest created' },
  { value: 'Most recently updated', label: 'Most recently updated' },
  { value: 'Least recently updated', label: 'Least recently updated' },
  { value: 'Highest priority first', label: 'Highest priority first' },
  { value: 'Lowest priority first', label: 'Lowest priority first' },
  { value: 'Highest difficulty first', label: 'Highest difficulty first' },
  { value: 'Lowest difficulty first', label: 'Lowest difficulty first' },
  { value: 'Latest start date', label: 'Latest start date' },
  { value: 'Earliest start date', label: 'Earliest start date' },
  { value: 'Latest due date', label: 'Latest due date' },
  { value: 'Earliest due date', label: 'Earliest due date' }
];

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.8" cy="10.8" r="6.8" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m7 10 5 5 5-5" />
    </svg>
  );
}

function SearchableDropdown({
  label,
  options = [],
  selectedValues = [],
  onChange,
  multiple = true,
  showPriorityIcons = false,
  emptyMessage = 'No results found',
  className = ''
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    function handlePointerDown(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsOpen(false);
        setSearchTerm('');
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (isOpen) searchRef.current?.focus();
  }, [isOpen]);

  const filteredOptions = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    if (!keyword) return options;

    return options.filter((option) =>
      String(option.label).toLowerCase().includes(keyword)
    );
  }, [options, searchTerm]);

  const selectedLabel = selectedValues.length === 0
    ? label
    : multiple
      ? label
      : selectedValues[0];

  function handleSelect(value) {
    if (multiple) {
      const nextValues = selectedValues.includes(value)
        ? selectedValues.filter((item) => item !== value)
        : [...selectedValues, value];
      onChange(nextValues);
      return;
    }

    onChange(value);
    setIsOpen(false);
    setSearchTerm('');
  }

  function clearSelection(event) {
    event.stopPropagation();
    onChange(multiple ? [] : '');
  }

  const hasSelection = selectedValues.length > 0;

  return (
    <div className={`filter-dropdown ${className}`} ref={dropdownRef}>
      <button
        type="button"
        className={`filter-dropdown-trigger ${isOpen ? 'is-open' : ''} ${hasSelection ? 'has-selection' : ''}`}
        onClick={() => setIsOpen((previous) => !previous)}
        aria-expanded={isOpen}
      >
        <span className="filter-dropdown-label">{selectedLabel}</span>
        {hasSelection && multiple && (
          <span className="filter-selected-count">{selectedValues.length}</span>
        )}
        <ChevronIcon />
      </button>

      {isOpen && (
        <div className="filter-dropdown-menu">
          <div className="filter-dropdown-search">
            <SearchIcon />
            <input
              ref={searchRef}
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search"
              aria-label={`Search ${label}`}
            />
            {searchTerm && (
              <button
                type="button"
                className="filter-search-clear"
                onClick={() => setSearchTerm('')}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>

          <div className="filter-dropdown-options">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => {
                const checked = selectedValues.includes(option.value);

                return (
                  <label
                    key={option.value}
                    className={`filter-dropdown-option ${checked ? 'selected' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => handleSelect(option.value)}
                      aria-label={option.label}
                    />
                    <span className="filter-checkbox-visual" aria-hidden="true">
                      {checked ? '✓' : ''}
                    </span>
                    {showPriorityIcons && (
                      <PriorityIcon priority={option.value} size={16} />
                    )}
                    <span className="filter-option-label">{option.label}</span>
                  </label>
                );
              })
            ) : (
              <div className="filter-dropdown-empty">{emptyMessage}</div>
            )}
          </div>

          {multiple && hasSelection && (
            <div className="filter-dropdown-footer">
              <button type="button" onClick={clearSelection}>Clear selection</button>
              <span>{selectedValues.length} selected</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function FilterBar({
  search = '',
  onSearchChange = () => {},
  onSearchSubmit = () => {},
  priorities = [],
  onPrioritiesChange = () => {},
  statuses = [],
  onStatusesChange = () => {},
  orderBy = 'Newest created',
  onOrderByChange = () => {},
  selectedFields = [],
  onSelectedFieldsChange = () => {},
  fieldOptions = {},
  fieldFilters = {},
  onFieldFilterChange = () => {},
  onApplyFilters = () => {},
  hasPendingFilterChanges = false
}) {
  function handleSearchSubmit(event) {
    event.preventDefault();
    onSearchSubmit();
  }

  return (
    <div className="mytasks-filter-toolbar">
      {/* Search runs independently when the user presses Enter. */}
      <form className="mytasks-task-search" onSubmit={handleSearchSubmit}>
        <SearchIcon />
        <input
          type="search"
          placeholder="Search tasks..."
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          aria-label="Search tasks"
        />
        {search && (
          <button
            type="button"
            className="filter-search-clear"
            onClick={() => onSearchChange('')}
            aria-label="Clear task search"
          >
            ×
          </button>
        )}
      </form>

      <SearchableDropdown
        label="Priority"
        options={PRIORITY_OPTIONS}
        selectedValues={priorities}
        onChange={onPrioritiesChange}
        multiple
        showPriorityIcons
      />

      <SearchableDropdown
        label="Status"
        options={STATUS_OPTIONS}
        selectedValues={statuses}
        onChange={onStatusesChange}
        multiple
      />

      <SearchableDropdown
        label="Order By"
        options={ORDER_OPTIONS}
        selectedValues={[orderBy]}
        onChange={onOrderByChange}
        multiple={false}
      />

      {/* Dynamic filters stay to the left of More Filter. */}
      {selectedFields.map((field) => (
        <SearchableDropdown
          key={field}
          className="dynamic-field-dropdown"
          label={field}
          options={fieldOptions[field] || []}
          selectedValues={fieldFilters[field] || []}
          onChange={(values) => onFieldFilterChange(field, values)}
          multiple
          emptyMessage={
            fieldOptions[field]?.length
              ? 'No matching values'
              : 'No available values yet'
          }
        />
      ))}

      <SearchableDropdown
        label="More Filter"
        options={MORE_FILTER_FIELDS}
        selectedValues={selectedFields}
        onChange={onSelectedFieldsChange}
        multiple
        emptyMessage="No matching fields"
      />

      {/* Apply the selected dropdown filters only when this button is clicked. */}
      <button
        type="button"
        className={`apply-filters-button ${hasPendingFilterChanges ? 'has-pending-changes' : ''}`}
        onClick={onApplyFilters}
        title="Apply filters"
        aria-label="Apply filters"
      >
        <SearchIcon />
      </button>
    </div>
  );
}
