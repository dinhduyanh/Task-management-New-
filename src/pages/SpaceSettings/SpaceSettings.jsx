import { useMemo, useRef, useState } from 'react';
import Header from '../../components/layout/Header';
import Icon from '../../components/common/Icon';
import { PeopleSettings } from './SpacePeople';
import PermissionsSettings from './SpacePermissions';
import './SpaceSettings.css';

const SETTINGS_ITEMS = [
  { label: 'Summary', icon: 'file' },
  { label: 'People', icon: 'users' },
  { label: 'Permissions', icon: 'shield' },
  { label: 'Features', icon: 'dashboard' },
  { label: 'Workflow', icon: 'workflow' },
  { label: 'Work Items', icon: 'tasks' }
];

const ISSUE_TYPES = ['Epic', 'Task', 'Bug', 'Improvement', 'Story', 'Sub-task', 'Feature'];
const WORKFLOW_STATUSES = [
  { label: 'Backlog', tone: 'backlog' },
  { label: 'To Do', tone: 'todo' },
  { label: 'In Progress', tone: 'progress' },
  { label: 'In Review', tone: 'review' },
  { label: 'Done', tone: 'done' }
];

function parseDate(value) {
  if (!value) return null;
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(value).trim());
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return date.getFullYear() === Number(yyyy) && date.getMonth() === Number(mm) - 1 && date.getDate() === Number(dd)
    ? date
    : null;
}

function toIsoDate(value) {
  const date = parseDate(value);
  if (!date) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function fromIsoDate(value) {
  if (!value) return '';
  const [year, month, day] = value.split('-');
  return `${day}-${month}-${year}`;
}

function formatDate(value) {
  const date = parseDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

function SettingsDateField({ id, label, value, onChange, required = false, error }) {
  const dateRef = useRef(null);
  function openPicker() {
    const input = dateRef.current;
    if (!input) return;
    if (typeof input.showPicker === 'function') input.showPicker();
    else { input.focus(); input.click(); }
  }

  return (
    <div className="settings-form-field">
      <label className="settings-field-label" htmlFor={`${id}-text`}>
        {label}{required && <span className="settings-required"> *</span>}
      </label>
      <div className={`settings-date-control ${error ? 'has-error' : ''}`}>
        <input
          id={`${id}-text`}
          type="text"
          inputMode="numeric"
          maxLength={10}
          placeholder="dd-mm-yyyy"
          value={value}
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, '').slice(0, 8);
            let next = digits;
            if (digits.length > 2 && digits.length <= 4) next = `${digits.slice(0, 2)}-${digits.slice(2)}`;
            if (digits.length > 4) next = `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
            onChange(next);
          }}
          aria-invalid={Boolean(error)}
          autoComplete="off"
        />
        {value && (
          <button type="button" className="settings-date-clear" onClick={() => onChange('')} aria-label={`Clear ${label}`}>×</button>
        )}
        <button type="button" className="settings-date-picker-button" onClick={openPicker} aria-label={`Choose ${label}`}>
          <Icon name="calendar" size={16} />
        </button>
        <input
          ref={dateRef}
          className="settings-native-date"
          type="date"
          value={toIsoDate(value)}
          onChange={(event) => onChange(fromIsoDate(event.target.value))}
          tabIndex={-1}
          aria-hidden="true"
        />
      </div>
      {error && <span className="settings-field-error">{error}</span>}
    </div>
  );
}

function SettingsSidebar({ space, activeTab, onTabChange, onBack }) {
  return (
    <aside className="space-settings-sidebar">
      <button type="button" className="settings-back-link" onClick={onBack}>
        <Icon name="arrowLeft" size={17} />
        <span>Space settings</span>
      </button>

      <div className="settings-space-identity">
        {space.icon ? <img src={space.icon} alt="" /> : <span>{(space.name || space.code || 'S').charAt(0).toUpperCase()}</span>}
        <div>
          <strong>{space.name || 'Untitled Space'}</strong>
          <small>{space.code || 'No code'}</small>
        </div>
      </div>

      <nav className="settings-nav" aria-label="Space settings sections">
        {SETTINGS_ITEMS.map((item) => (
          <button
            type="button"
            key={item.label}
            className={`settings-nav-item ${activeTab === item.label ? 'active' : ''}`}
            onClick={() => onTabChange(item.label)}
            aria-current={activeTab === item.label ? 'page' : undefined}
          >
            <Icon name={item.icon} size={16} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}

function SummarySettings({ space, onSave }) {
  const fileInputRef = useRef(null);
  const [taskKeyPrefix, setTaskKeyPrefix] = useState(space.taskKeyPrefix || space.code || '');
  const [name, setName] = useState(space.name || '');
  const [projectManager, setProjectManager] = useState(space.projectManager || '');
  const [description, setDescription] = useState(space.description || '');
  const [startDate, setStartDate] = useState(space.startDate || '');
  const [dueDate, setDueDate] = useState(space.dueDate || space.endDate || '');
  const [spaceIcon, setSpaceIcon] = useState(space.icon || '');
  const [errors, setErrors] = useState({});
  const [saveMessage, setSaveMessage] = useState('');

  const projectInitial = (name || space.name || space.code || 'S').charAt(0).toUpperCase();

  function handleIconFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrors((current) => ({ ...current, icon: 'Please select an image file.' }));
      event.target.value = '';
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setErrors((current) => ({ ...current, icon: 'Image size must not exceed 2 MB.' }));
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setSpaceIcon(String(reader.result || ''));
      setErrors((current) => ({ ...current, icon: '' }));
    };
    reader.onerror = () => setErrors((current) => ({ ...current, icon: 'Could not read this image.' }));
    reader.readAsDataURL(file);
  }

  function handleSubmit(event) {
    event.preventDefault();
    const nextErrors = {};
    const normalizedPrefix = taskKeyPrefix.trim().toUpperCase();

    if (!name.trim()) nextErrors.name = 'Name is required.';
    if (!startDate.trim()) nextErrors.startDate = 'Start Date is required.';
    else if (!parseDate(startDate)) nextErrors.startDate = 'Enter a valid date in dd-mm-yyyy format.';
    if (dueDate.trim() && !parseDate(dueDate)) nextErrors.dueDate = 'Enter a valid date in dd-mm-yyyy format.';
    if (normalizedPrefix && !/^[A-Z][A-Z0-9]{1,9}$/.test(normalizedPrefix)) {
      nextErrors.taskKeyPrefix = 'Use 2–10 uppercase letters or digits, starting with a letter.';
    }
    if (parseDate(startDate) && parseDate(dueDate) && parseDate(dueDate) < parseDate(startDate)) {
      nextErrors.dueDate = 'Due Date cannot be earlier than Start Date.';
    }

    setErrors(nextErrors);
    setSaveMessage('');
    if (Object.keys(nextErrors).length) return;

    onSave({
      taskKeyPrefix: normalizedPrefix,
      name: name.trim(),
      projectManager: projectManager.trim(),
      description: description.trim(),
      startDate,
      dueDate: dueDate || null,
      endDate: dueDate || null,
      icon: spaceIcon || null
    });
    setSaveMessage('Space settings saved in this session.');
  }

  return (
    <form className="settings-summary-form" onSubmit={handleSubmit} noValidate>
      <div className="settings-content-heading">
        <h1>Summary</h1>
        <p>Required fields are marked with an asterisk <span className="settings-required">*</span></p>
      </div>

      <div className="settings-form-card">
        <div className="settings-space-avatar-area">
          <div className="settings-space-avatar-preview">
            {spaceIcon ? <img src={spaceIcon} alt="Space icon" /> : <span>{projectInitial}</span>}
          </div>
          <button type="button" className="settings-change-icon" onClick={() => fileInputRef.current?.click()}>
            Change icon
          </button>
          <input ref={fileInputRef} className="settings-hidden-file" type="file" accept="image/*" onChange={handleIconFile} />
          {errors.icon && <span className="settings-field-error">{errors.icon}</span>}
        </div>

        <div className="settings-form-grid">
          <div className="settings-form-field">
            <label className="settings-field-label" htmlFor="settings-code">Code <span className="settings-required">*</span></label>
            <input id="settings-code" className="settings-text-input is-readonly" value={space.code || ''} readOnly disabled />
          </div>

          <div className="settings-form-field">
            <label className="settings-field-label" htmlFor="settings-prefix">Task key prefix</label>
            <input
              id="settings-prefix"
              className={`settings-text-input ${errors.taskKeyPrefix ? 'has-error' : ''}`}
              value={taskKeyPrefix}
              maxLength={10}
              onChange={(event) => {
                setTaskKeyPrefix(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10));
                setErrors((current) => ({ ...current, taskKeyPrefix: '' }));
              }}
            />
            <span className="settings-field-hint">2–10 uppercase letters or digits, starting with a letter. Changing it does not rename keys already issued.</span>
            {errors.taskKeyPrefix && <span className="settings-field-error">{errors.taskKeyPrefix}</span>}
          </div>

          <div className="settings-form-field settings-full-width">
            <label className="settings-field-label" htmlFor="settings-name">Name <span className="settings-required">*</span></label>
            <input
              id="settings-name"
              className={`settings-text-input ${errors.name ? 'has-error' : ''}`}
              value={name}
              maxLength={120}
              onChange={(event) => { setName(event.target.value); setErrors((current) => ({ ...current, name: '' })); }}
            />
            {errors.name && <span className="settings-field-error">{errors.name}</span>}
          </div>

          <div className="settings-form-field settings-full-width">
            <label className="settings-field-label" htmlFor="settings-manager">Project Manager</label>
            <select id="settings-manager" className="settings-select-input" value={projectManager} onChange={(event) => setProjectManager(event.target.value)}>
              <option value="">Select Project Manager</option>
              {projectManager && <option value={projectManager}>{projectManager}</option>}
              <option value="__none__" disabled>No users available yet</option>
            </select>
            <span className="settings-field-hint">User options will be available when user management is connected.</span>
          </div>

          <div className="settings-form-field settings-full-width">
            <label className="settings-field-label" htmlFor="settings-description">Description</label>
            <textarea
              id="settings-description"
              className="settings-textarea"
              rows={4}
              placeholder="Enter value for Description"
              value={description}
              maxLength={1000}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <SettingsDateField id="settings-start-date" label="Start Date" value={startDate} onChange={(value) => { setStartDate(value); setErrors((current) => ({ ...current, startDate: '', dueDate: '' })); }} required error={errors.startDate} />
          <SettingsDateField id="settings-due-date" label="Due Date" value={dueDate} onChange={(value) => { setDueDate(value); setErrors((current) => ({ ...current, dueDate: '' })); }} error={errors.dueDate} />
        </div>

        <div className="settings-form-footer">
          {saveMessage && <span className="settings-save-message" role="status">{saveMessage}</span>}
          <button type="submit" className="settings-save-button">Save</button>
        </div>
      </div>
    </form>
  );
}

function FeaturesSettings() {
  const features = [
    ['Summary', 'Project overview and key metrics.'],
    ['Timeline', 'View project work across a timeline.'],
    ['Board', 'Manage work items on a visual board.'],
    ['List', 'View and manage work items in a list.'],
    ['Backlog', 'Prioritize and organize upcoming work.'],
    ['Active Sprints', 'Plan and track active sprints.'],
    ['Teams', 'View project teams and members.']
  ];
  return (
    <section className="settings-secondary-content">
      <div className="settings-content-heading"><h1>Features</h1><p>Features available in this project.</p></div>
      <div className="settings-section-card">
        {features.map(([name, description], index) => <div className="settings-feature-row" key={name}><span className="settings-feature-number">{String(index + 1).padStart(2, '0')}</span><div><strong>{name}</strong><p>{description}</p></div><span className="settings-feature-state">Available</span></div>)}
      </div>
    </section>
  );
}

function WorkflowSettings() {
  return (
    <section className="settings-secondary-content">
      <div className="settings-content-heading"><h1>Workflow</h1><p>Overview of the work item lifecycle for this space.</p></div>
      <div className="settings-section-card">
        <div className="settings-section-card-header"><strong>Default workflow</strong><span>Workflow overview</span></div>
        <div className="settings-workflow-list">
          {WORKFLOW_STATUSES.map((status, index) => <div className="settings-workflow-step" key={status.label}><span className={`settings-workflow-dot ${status.tone}`}>{index + 1}</span><strong>{status.label}</strong>{index < WORKFLOW_STATUSES.length - 1 && <span className="settings-workflow-connector" />}</div>)}
        </div>
        <div className="settings-workflow-extras"><span className="settings-workflow-chip blocked">Blocked</span><span className="settings-workflow-chip cancelled">Cancel</span><small>Additional workflow states</small></div>
        <p className="settings-note">Workflow editing and transition rules will be added in a later implementation step.</p>
      </div>
    </section>
  );
}

function WorkItemsSettings() {
  return (
    <section className="settings-secondary-content">
      <div className="settings-content-heading"><h1>Work Items</h1><p>Issue types that can be used in this space.</p></div>
      <div className="settings-section-card">
        <div className="settings-section-card-header"><strong>Issue types</strong><span>{ISSUE_TYPES.length} types</span></div>
        <div className="settings-issue-types">{ISSUE_TYPES.map((type) => <div className="settings-issue-type" key={type}><span className="settings-issue-type-icon"><Icon name={type === 'Bug' ? 'bug' : 'tasks'} size={16} /></span><strong>{type}</strong></div>)}</div>
        <p className="settings-note">Issue type creation and configuration will be connected to the work item module.</p>
      </div>
    </section>
  );
}

export default function SpaceSettings({ space = {}, spaces = [], tasks = [], onGlobalCreate = () => {}, onOpenTask = () => {}, onBack = () => {}, onSave = () => {}, onAddMember = async () => '', onAddMembers = async () => '', onRemoveMember = async () => '' }) {
  const [activeTab, setActiveTab] = useState('Summary');
  const pageContent = useMemo(() => {
    switch (activeTab) {
      case 'People': return <PeopleSettings space={space} onAddMember={onAddMember} onAddMembers={onAddMembers} onRemoveMember={onRemoveMember} />;
      case 'Permissions': return <PermissionsSettings space={space} />;
      case 'Features': return <FeaturesSettings />;
      case 'Workflow': return <WorkflowSettings />;
      case 'Work Items': return <WorkItemsSettings />;
      default: return <SummarySettings key={space.id} space={space} onSave={onSave} />;
    }
  }, [activeTab, onSave, onAddMember, onAddMembers, onRemoveMember, space]);

  return (
    <div className="space-settings-shell">
      <Header spaces={spaces} tasks={tasks} onGlobalCreate={onGlobalCreate} onOpenTask={onOpenTask} />
      <div className="space-settings-layout">
        <SettingsSidebar space={space} activeTab={activeTab} onTabChange={setActiveTab} onBack={onBack} />
        <main className="space-settings-main">
          {pageContent}
        </main>
      </div>
    </div>
  );
}
