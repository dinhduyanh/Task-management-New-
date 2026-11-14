import { useMemo } from 'react';
import Header from '../../components/layout/Header';
import Sidebar from '../../components/layout/Sidebar';
import Icon from '../../components/common/Icon';
import './SpacesSummary.css';

const STATUS_DEFINITIONS = [
  { label: 'Backlog', color: '#97A4B7' },
  { label: 'To Do', color: '#4C9AFF' },
  { label: 'In Progress', color: '#00A3BF' },
  { label: 'In Review', color: '#8777D9' },
  { label: 'Blocked', color: '#FFAB00' },
  { label: 'Done', color: '#36B37E' },
  { label: 'Cancel', color: '#DE350B' }
];

function normalizeStatus(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  const aliases = {
    backlog: 'Backlog',
    'to do': 'To Do',
    todo: 'To Do',
    'in progress': 'In Progress',
    'in review': 'In Review',
    review: 'In Review',
    blocked: 'Blocked',
    done: 'Done',
    completed: 'Done',
    cancel: 'Cancel',
    cancelled: 'Cancel',
    canceled: 'Cancel'
  };
  return aliases[normalized] || null;
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const result = new Date(value);
    return Number.isNaN(result.getTime()) ? null : result;
  }

  const text = String(value).trim();
  const dmy = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmy) {
    const date = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    return date.getFullYear() === Number(dmy[3]) &&
      date.getMonth() === Number(dmy[2]) - 1 &&
      date.getDate() === Number(dmy[1]) ? date : null;
  }

  const result = new Date(text);
  return Number.isNaN(result.getTime()) ? null : result;
}

function formatDate(value) {
  const date = parseDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(date);
}

function formatActivityTime(value) {
  const date = parseDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function getInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  return parts.length === 1
    ? parts[0].slice(0, 2).toUpperCase()
    : `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function getAssigneeName(task) {
  if (!task?.assignee) return 'Unassigned';
  if (typeof task.assignee === 'string') return task.assignee;
  return task.assignee.name || task.assignee.fullName || 'Unassigned';
}

function getTaskCreatedDate(task) {
  return task.createdAt || task.createdDate || task.created || task.createDate;
}

function getTaskKey(task) {
  return task.key || task.code || task.taskCode || (task.id ? `TASK-${task.id}` : '—');
}

function StatusBadge({ status }) {
  const normalized = normalizeStatus(status);
  const className = normalized
    ? normalized.toLowerCase().replace(/\s+/g, '-')
    : 'unclassified';

  return (
    <span className={`summary-status-badge summary-status-${className}`}>
      {status || 'Unclassified'}
    </span>
  );
}

function DonutChart({ counts, total }) {
  const radius = 66;
  const circumference = 2 * Math.PI * radius;
  let accumulated = 0;

  return (
    <div className="summary-donut-wrap" role="img" aria-label={`${total} tasks across project statuses`}>
      <svg className="summary-donut" viewBox="0 0 180 180" aria-hidden="true">
        <circle cx="90" cy="90" r={radius} fill="none" stroke="#EEF1F5" strokeWidth="22" />
        {total > 0 && STATUS_DEFINITIONS.map((status) => {
          const count = counts[status.label] || 0;
          if (!count) return null;
          const length = (count / total) * circumference;
          const offset = accumulated;
          accumulated += length;
          return (
            <circle
              key={status.label}
              cx="90"
              cy="90"
              r={radius}
              fill="none"
              stroke={status.color}
              strokeWidth="22"
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 90 90)"
            />
          );
        })}
      </svg>
      <div className="summary-donut-center">
        <strong>{total}</strong>
        <span>Tasks in this space</span>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, tone }) {
  return (
    <article className={`summary-stat-card summary-stat-${tone}`}>
      <div className="summary-stat-icon"><Icon name={icon} size={20} /></div>
      <div className="summary-stat-copy">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function SpaceTabs({ space, activeTab, onNavigate }) {
  const tabs = [
    { label: 'Summary', icon: 'dashboard' },
    { label: 'Timeline', icon: 'calendar' },
    { label: 'Board', icon: 'tasks' },
    { label: 'List', icon: 'file' },
    { label: 'Backlog', icon: 'spaces' },
    { label: 'Active Sprints', icon: 'check' },
    { label: 'Teams', icon: 'user' }
  ];

  function handleTabClick(tab) {
    if (tab === 'Summary') {
      onNavigate('space', { id: space.id, name: space.name });
      return;
    }
    if (tab === 'List') {
      onNavigate('spaceList', { id: space.id, name: space.name });
      return;
    }
    onNavigate('spaceTab', {
      id: space.id,
      name: space.name,
      tab
    });
  }

  return (
    <nav className="space-summary-tabs" aria-label="Space navigation">
      {tabs.map((tab) => (
        <button
          type="button"
          key={tab.label}
          className={`space-summary-tab ${activeTab === tab.label ? 'is-active' : ''}`}
          onClick={() => handleTabClick(tab.label)}
          aria-current={activeTab === tab.label ? 'page' : undefined}
        >
          <Icon name={tab.icon} size={15} />
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}

export default function SpacesSummary({
  space = {},
  tasks = [],
  spaces = [],
  onNavigate = () => {},
  onCreateSpace = () => {},
  onGlobalCreate = () => {},
  onOpenTask = () => {}
}) {
  const spaceName = space.name || space.code || 'Untitled Space';
  const spaceTasks = useMemo(() => {
    const targetId = String(space.id ?? '');
    const targetCode = String(space.code ?? '').toLowerCase();
    return (Array.isArray(tasks) ? tasks : []).filter((task) => {
      const taskSpaceId = task.spaceId ?? task.projectId ?? task.space?.id;
      const taskSpaceCode = String(task.spaceCode ?? task.projectCode ?? '').toLowerCase();
      return (targetId && String(taskSpaceId ?? '') === targetId) ||
        (targetCode && taskSpaceCode === targetCode);
    });
  }, [tasks, space.id, space.code]);

  const statusCounts = useMemo(() => {
    const counts = Object.fromEntries(STATUS_DEFINITIONS.map((item) => [item.label, 0]));
    let unclassified = 0;
    for (const task of spaceTasks) {
      const status = normalizeStatus(task.status);
      if (status) counts[status] += 1;
      else unclassified += 1;
    }
    return { counts, unclassified };
  }, [spaceTasks]);

  const totalTasks = spaceTasks.length;
  const inProgressCount = statusCounts.counts['In Progress'];
  const completedCount = statusCounts.counts.Done;
  const openCount = totalTasks - completedCount - statusCounts.counts.Cancel;
  const members = Array.isArray(space.members) ? space.members : [];
  const ownerName = space.owner?.name || space.createdBy || 'Not assigned';
  const ownerInitials = space.owner?.initials || getInitials(ownerName);
  const description = space.description?.trim() || '';
  const activities = [...(Array.isArray(space.activities) ? space.activities : [])]
    .sort((a, b) => (parseDate(b.createdAt || b.timestamp)?.getTime() || 0) - (parseDate(a.createdAt || a.timestamp)?.getTime() || 0))
    .slice(0, 5);
  const recentTasks = [...spaceTasks]
    .sort((a, b) => (parseDate(getTaskCreatedDate(b))?.getTime() || 0) - (parseDate(getTaskCreatedDate(a))?.getTime() || 0))
    .slice(0, 5);

  function navigateToTab(tab) {
    if (tab === 'List') {
      onNavigate('spaceList', { id: space.id, name: spaceName });
      return;
    }
    onNavigate('spaceTab', { id: space.id, name: spaceName, tab });
  }

  return (
    <div className="app-shell spaces-summary-shell">
      <Header spaces={spaces} tasks={tasks} onGlobalCreate={onGlobalCreate} onOpenTask={onOpenTask} />
      <Sidebar
        activeSection="Spaces"
        activeSpaceId={space.id}
        spaces={spaces}
        onCreateSpace={onCreateSpace}
        onNavigate={onNavigate}
      />

      <main className="spaces-summary-main">
        <div className="spaces-summary-heading">
          <div className="spaces-summary-breadcrumb">
            <span>Projects</span>
            <span className="summary-breadcrumb-separator">/</span>
            <strong>{spaceName}</strong>
          </div>
          <h1>{spaceName}</h1>
          {space.code && space.code !== spaceName && (
            <span className="spaces-summary-code">{space.code}</span>
          )}
        </div>

        <SpaceTabs space={{ ...space, name: spaceName }} activeTab="Summary" onNavigate={onNavigate} />

        <section className="summary-stats-grid" aria-label="Space statistics">
          <StatCard icon="tasks" label="Open Task" value={openCount} tone="blue" />
          <StatCard icon="calendar" label="In Progress" value={inProgressCount} tone="orange" />
          <StatCard icon="check" label="Completed" value={completedCount} tone="green" />
          <StatCard icon="user" label="Members" value={members.length} tone="purple" />
        </section>

        <div className="spaces-summary-grid">
          <div className="spaces-summary-left-column">
            <section className="summary-panel summary-status-panel">
              <div className="summary-panel-heading">
                <div>
                  <h2>Status Overview</h2>
                  <p>Get a snapshot of the status of work items in this space.</p>
                </div>
                <button type="button" className="summary-text-link" onClick={() => navigateToTab('List')}>
                  View All Work Items
                </button>
              </div>

              <div className="summary-status-content">
                <DonutChart counts={statusCounts.counts} total={totalTasks} />
                <div className="summary-status-legend">
                  {STATUS_DEFINITIONS.map((status) => (
                    <div className="summary-legend-item" key={status.label}>
                      <span className="summary-legend-dot" style={{ backgroundColor: status.color }} />
                      <span className="summary-legend-label">{status.label}</span>
                      <strong>{statusCounts.counts[status.label]}</strong>
                    </div>
                  ))}
                  {statusCounts.unclassified > 0 && (
                    <div className="summary-legend-item">
                      <span className="summary-legend-dot" style={{ backgroundColor: '#B3BAC5' }} />
                      <span className="summary-legend-label">Unclassified</span>
                      <strong>{statusCounts.unclassified}</strong>
                    </div>
                  )}
                </div>
              </div>
              {totalTasks === 0 && (
                <p className="summary-chart-empty-note">Tasks created in this space will appear in this overview.</p>
              )}
            </section>

            <section className="summary-panel summary-work-panel">
              <div className="summary-panel-heading">
                <div>
                  <h2>Recent Work Items</h2>
                  <p>Recently created or updated tasks in this space.</p>
                </div>
                <button type="button" className="summary-text-link" onClick={() => navigateToTab('List')}>
                  View All
                </button>
              </div>

              <div className="summary-table-scroll">
                <table className="summary-work-table">
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th>Summary</th>
                      <th>Status</th>
                      <th>Assignee</th>
                      <th>Create Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentTasks.length > 0 ? recentTasks.map((task) => {
                      const assignee = getAssigneeName(task);
                      return (
                        <tr key={task.id || getTaskKey(task)}>
                          <td className="summary-task-key">{getTaskKey(task)}</td>
                          <td className="summary-task-title">{task.summary || task.title || task.name || 'Untitled task'}</td>
                          <td><StatusBadge status={task.status} /></td>
                          <td>
                            <div className="summary-assignee">
                              <span className="summary-person-avatar">{assignee === 'Unassigned' ? '—' : getInitials(assignee)}</span>
                              <span>{assignee}</span>
                            </div>
                          </td>
                          <td>{formatDate(getTaskCreatedDate(task))}</td>
                        </tr>
                      );
                    }) : (
                      <tr>
                        <td colSpan="5" className="summary-table-empty">
                          <Icon name="file" size={25} />
                          <strong>No work items yet</strong>
                          <span>Tasks created in this space will be listed here.</span>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="summary-panel summary-activity-panel">
              <div className="summary-panel-heading">
                <div>
                  <h2>Recent Activity</h2>
                  <p>Latest changes and actions in this space.</p>
                </div>
                <button type="button" className="summary-text-link" onClick={() => navigateToTab('Timeline')}>
                  See all <span aria-hidden="true">＋</span>
                </button>
              </div>

              {activities.length > 0 ? (
                <div className="summary-activity-list">
                  {activities.map((activity, index) => {
                    const actor = activity.actor || activity.userName || 'You';
                    const detail = activity.description || activity.action || 'updated this space';
                    return (
                      <div className="summary-activity-item" key={activity.id || `${index}-${activity.createdAt}`}>
                        <span className="summary-activity-avatar">{getInitials(actor)}</span>
                        <div className="summary-activity-copy">
                          <p><strong>{actor}</strong> {detail}</p>
                          <span>{formatActivityTime(activity.createdAt || activity.timestamp)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="summary-activity-empty">
                  <Icon name="calendar" size={21} />
                  <span>No recent activity yet.</span>
                </div>
              )}
            </section>
          </div>

          <aside className="spaces-summary-right-column">
            <section className="summary-panel summary-detail-panel">
              <div className="summary-panel-heading summary-panel-heading-compact">
                <h2>Space Detail</h2>
              </div>
              <dl className="summary-detail-list">
                <div>
                  <dt>Owner</dt>
                  <dd>
                    <span className="summary-person-avatar summary-owner-avatar">{ownerInitials}</span>
                    <strong>{ownerName}</strong>
                  </dd>
                </div>
                <div>
                  <dt>Created Date</dt>
                  <dd>{formatDate(space.createdAt)}</dd>
                </div>
                <div>
                  <dt>Visibility</dt>
                  <dd>
                    <Icon name="lock" size={14} />
                    {space.visibility || 'Not specified'}
                  </dd>
                </div>
                <div className="summary-description-row">
                  <dt>Description</dt>
                  <dd>{description || 'No description provided.'}</dd>
                </div>
                {space.projectManager && (
                  <div>
                    <dt>Project Manager</dt>
                    <dd>{space.projectManager}</dd>
                  </div>
                )}
              </dl>
            </section>

            <section className="summary-panel summary-members-panel">
              <div className="summary-panel-heading summary-panel-heading-compact">
                <h2>Members</h2>
                <button type="button" className="summary-text-link" onClick={() => navigateToTab('Teams')}>
                  View All
                </button>
              </div>

              {members.length > 0 ? (
                <div className="summary-members-list">
                  {members.slice(0, 8).map((member, index) => {
                    const memberName = member.name || member.fullName || 'Unnamed member';
                    return (
                      <div className="summary-member" key={member.id || `${memberName}-${index}`}>
                        <span className="summary-member-avatar">{member.initials || getInitials(memberName)}</span>
                        <strong title={memberName}>{memberName}</strong>
                        <span>{member.role || 'Member'}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="summary-members-empty">
                  <Icon name="user" size={23} />
                  <strong>No members yet</strong>
                  <span>Members added to this space will appear here.</span>
                </div>
              )}
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
