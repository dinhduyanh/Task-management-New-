import { useState } from 'react';
import Header from '../../components/layout/Header';
import Sidebar from '../../components/layout/Sidebar';
import Icon from '../../components/common/Icon';
import { CalendarPopover } from '../../components/common/DatePicker';
import './CreateSpace.css';

function formatDateInput(value) {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
}

function parseDate(value) {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function toIsoDate(value) {
  const date = parseDate(value);
  if (!date) return '';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fromIsoDate(value) {
  if (!value) return '';
  const [year, month, day] = value.split('-');
  return `${day}-${month}-${year}`;
}

function DateField({ id, label, value, onChange, required = false, error, min }) {
  const [controlEl, setControlEl] = useState(null);
  const [calendarOpen, setCalendarOpen] = useState(false);

  return (
    <div className="space-form-field">
      <label className="space-field-label" htmlFor={`${id}-text`}>
        {label}{required && <span className="required-star"> *</span>}
      </label>

      <div ref={setControlEl} className={`space-date-control ${error ? 'has-error' : ''}`}>
        <input
          id={`${id}-text`}
          type="text"
          value={value}
          onChange={(event) => onChange(formatDateInput(event.target.value))}
          placeholder="dd-mm-yyyy"
          inputMode="numeric"
          maxLength={10}
          autoComplete="off"
          aria-label={label}
          aria-invalid={Boolean(error)}
        />

        {value && (
          <button
            type="button"
            className="space-date-clear"
            onClick={() => onChange('')}
            aria-label={`Clear ${label}`}
            title="Clear date"
          >
            ×
          </button>
        )}

        <button
          type="button"
          className="space-date-calendar-button"
          onClick={() => setCalendarOpen((open) => !open)}
          aria-haspopup="dialog"
          aria-expanded={calendarOpen}
          aria-label={`Choose ${label}`}
          title="Choose date"
        >
          <Icon name="calendar" size={17} />
        </button>

        {calendarOpen && (
          <CalendarPopover
            anchorEl={controlEl}
            value={toIsoDate(value)}
            min={min ? toIsoDate(min) || undefined : undefined}
            onSelect={(iso) => onChange(fromIsoDate(iso))}
            onClose={() => setCalendarOpen(false)}
          />
        )}
      </div>

      {error && <span className="space-field-error">{error}</span>}
    </div>
  );
}

export default function CreateSpace({
  spaces = [],
  onBack = () => {},
  onCancel = onBack,
  onSave = () => {},
  onNavigate = () => {},
  onCreateSpace = () => {},
  tasks = [],
  onGlobalCreate = () => {},
  onOpenTask = () => {}
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [projectManager, setProjectManager] = useState('');
  const [description, setDescription] = useState('');
  const [endDate, setEndDate] = useState('');
  const [implementationType, setImplementationType] = useState('');
  const [otherInfoExpanded, setOtherInfoExpanded] = useState(false);
  const [errors, setErrors] = useState({});

  function validateForm() {
    const nextErrors = {};
    const normalizedCode = code.trim().toUpperCase();

    if (!normalizedCode) {
      nextErrors.code = 'Code is required.';
    } else if (spaces.some((space) => space.code?.toUpperCase() === normalizedCode)) {
      nextErrors.code = 'This Code already exists. Please enter another Code.';
    }

    if (!name.trim()) {
      nextErrors.name = 'Name is required.';
    }

    if (!startDate.trim()) {
      nextErrors.startDate = 'Start Date is required.';
    } else if (!parseDate(startDate)) {
      nextErrors.startDate = 'Enter a valid date in dd-mm-yyyy format.';
    }

    if (endDate.trim() && !parseDate(endDate)) {
      nextErrors.endDate = 'Enter a valid date in dd-mm-yyyy format.';
    }

    const parsedStart = parseDate(startDate);
    const parsedEnd = parseDate(endDate);
    if (parsedStart && parsedEnd && parsedEnd < parsedStart) {
      nextErrors.endDate = 'End Date cannot be earlier than Start Date.';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (!validateForm()) return;

    onSave({
      code: code.trim().toUpperCase(),
      name: name.trim(),
      startDate,
      projectManager: projectManager && projectManager !== '__no_users__' ? projectManager : null,
      description: description.trim(),
      endDate: endDate || null,
      implementationType: implementationType || null
    });
  }

  function clearError(field) {
    if (!errors[field]) return;
    setErrors((current) => ({ ...current, [field]: '' }));
  }

  return (
    <div className="app-shell create-space-shell">
      <Header spaces={spaces} tasks={tasks} onGlobalCreate={onGlobalCreate} onOpenTask={onOpenTask} />
      <Sidebar
        activeSection="Spaces"
        spaces={spaces}
        onCreateSpace={onCreateSpace}
        onNavigate={onNavigate}
      />

      <main className="create-space-main">
        <div className="create-space-topline">
          <button
            type="button"
            className="create-space-back-button"
            onClick={onBack}
            aria-label="Go back to previous screen"
          >
            <Icon name="arrowLeft" size={19} />
          </button>
          <span>Spaces</span>
          <span className="create-space-breadcrumb-separator">/</span>
          <span className="create-space-current-crumb">New Space</span>
        </div>

        <form className="create-space-card" onSubmit={handleSubmit} noValidate>
          <div className="create-space-card-heading">
            <div>
              <h1>Name your space</h1>
              <p>Required fields are marked with an asterisk <span className="required-star">*</span></p>
            </div>
          </div>

          <div className="create-space-form-body">
            <div className="create-space-fields-grid">
              <div className="space-form-field">
                <label className="space-field-label" htmlFor="space-code">
                  Code<span className="required-star"> *</span>
                </label>
                <input
                  id="space-code"
                  className={`space-text-input ${errors.code ? 'has-error' : ''}`}
                  type="text"
                  placeholder="Code"
                  value={code}
                  maxLength={30}
                  onChange={(event) => {
                    setCode(event.target.value);
                    clearError('code');
                  }}
                  autoComplete="off"
                  aria-invalid={Boolean(errors.code)}
                />
                {errors.code && <span className="space-field-error">{errors.code}</span>}
              </div>

              <div className="space-form-field">
                <label className="space-field-label" htmlFor="space-name">
                  Name<span className="required-star"> *</span>
                </label>
                <input
                  id="space-name"
                  className={`space-text-input ${errors.name ? 'has-error' : ''}`}
                  type="text"
                  placeholder="Enter value for Name"
                  value={name}
                  maxLength={120}
                  onChange={(event) => {
                    setName(event.target.value);
                    clearError('name');
                  }}
                  autoComplete="off"
                  aria-invalid={Boolean(errors.name)}
                />
                {errors.name && <span className="space-field-error">{errors.name}</span>}
              </div>

              <DateField
                id="space-start-date"
                label="Start Date"
                value={startDate}
                onChange={(value) => {
                  setStartDate(value);
                  clearError('startDate');
                  clearError('endDate');
                }}
                required
                error={errors.startDate}
              />
            </div>

            <div className="space-other-info-section">
              <button
                type="button"
                className="space-accordion-trigger"
                onClick={() => setOtherInfoExpanded((expanded) => !expanded)}
                aria-expanded={otherInfoExpanded}
              >
                <Icon
                  name="chevron"
                  size={16}
                  className={otherInfoExpanded ? 'space-accordion-chevron expanded' : 'space-accordion-chevron'}
                />
                <span>Other information</span>
                <span className="space-optional-label">Optional</span>
              </button>

              {otherInfoExpanded && (
                <div className="space-other-info-content">
                  <div className="create-space-fields-grid">
                    <div className="space-form-field">
                      <label className="space-field-label" htmlFor="space-project-manager">
                        Project Manager
                      </label>
                      <select
                        id="space-project-manager"
                        className="space-select-input"
                        value={projectManager}
                        onChange={(event) => setProjectManager(event.target.value)}
                      >
                        <option value="">Select Project Manager</option>
                        <option value="__no_users__" disabled>No users available yet</option>
                      </select>
                      <span className="space-field-hint">
                        User options will be loaded when user management is connected.
                      </span>
                    </div>

                    <div className="space-form-field">
                      <DateField
                        id="space-end-date"
                        label="End Date"
                        value={endDate}
                        min={startDate}
                        onChange={(value) => {
                          setEndDate(value);
                          clearError('endDate');
                        }}
                        error={errors.endDate}
                      />
                    </div>

                    <div className="space-form-field space-description-field">
                      <label className="space-field-label" htmlFor="space-description">
                        Description
                      </label>
                      <textarea
                        id="space-description"
                        className="space-textarea"
                        placeholder="Enter value for Description"
                        rows={4}
                        value={description}
                        maxLength={1000}
                        onChange={(event) => setDescription(event.target.value)}
                      />
                    </div>

                    <fieldset className="space-form-field space-implementation-field">
                      <legend className="space-field-label">Đối tượng thực hiện</legend>
                      <div className="space-radio-group">
                        <label className="space-radio-option">
                          <input
                            type="radio"
                            name="implementationType"
                            value="Cá nhân"
                            checked={implementationType === 'Cá nhân'}
                            onChange={(event) => setImplementationType(event.target.value)}
                          />
                          <span className="space-radio-visual" />
                          <span>Cá nhân</span>
                        </label>
                        <label className="space-radio-option">
                          <input
                            type="radio"
                            name="implementationType"
                            value="Đơn vị"
                            checked={implementationType === 'Đơn vị'}
                            onChange={(event) => setImplementationType(event.target.value)}
                          />
                          <span className="space-radio-visual" />
                          <span>Đơn vị</span>
                        </label>
                      </div>
                    </fieldset>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="create-space-card-footer">
            <button type="button" className="space-cancel-button" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="space-save-button">
              Save
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
