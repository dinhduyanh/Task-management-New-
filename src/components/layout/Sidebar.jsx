import { useEffect, useRef, useState } from 'react';
import { useAppShell } from '../../context/appShellContext';
import { SIDEBAR_DASHBOARD_LIMIT, sidebarDashboards } from '../../services/dashboards';
import { canInSpace } from '../../services/projectPermissions';
import Icon from '../common/Icon';
import './Sidebar.css';

const SIDEBAR_SPACE_LIMIT = 5;

/**
 * Projects shown under Spaces: the ones the user starred (oldest star first); without stars,
 * the first projects the user is involved in. The open project is always listed.
 */
function sidebarSpaceList(spaces, activeSpaceId) {
  const pinned = spaces.filter((space) => space.pinned).sort((a, b) => String(a.pinnedAt || '').localeCompare(String(b.pinnedAt || '')));
  const involved = spaces.filter((space) => space.involved !== false);
  const list = (pinned.length ? pinned : involved).slice(0, SIDEBAR_SPACE_LIMIT);
  const active = activeSpaceId && spaces.find((space) => space.id === activeSpaceId);
  if (active && !list.includes(active)) list.push(active);
  return list;
}

export default function Sidebar({
  activeSection = 'My Tasks',
  activeSpaceId = null,
  activeDashboardId = null,
  spaces = [],
  onCreateSpace = () => {},
  onNavigate = () => {},
  onOpenSpaceSettings = () => {},
  onDeleteSpace = () => {}
}) {
  const [spacesExpanded, setSpacesExpanded] = useState(true);
  const [dashboardsExpanded, setDashboardsExpanded] = useState(true);
  const { dashboards, sidebarCollapsed, toggleSidebar } = useAppShell();
  const shortcutDashboards = sidebarDashboards(dashboards);
  const sidebarSpaces = sidebarSpaceList(spaces, activeSpaceId);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [spaceToDelete, setSpaceToDelete] = useState(null);
  const menuAreaRef = useRef(null);

  useEffect(() => {
    function handlePointerDown(event) {
      if (menuAreaRef.current && !menuAreaRef.current.contains(event.target)) {
        setOpenMenuId(null);
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const navigate = (page, data = null) => onNavigate(page, data);

  function openSpaceMenu(event, spaceId) {
    event.stopPropagation();
    setOpenMenuId((current) => current === spaceId ? null : spaceId);
  }

  function confirmDelete() {
    if (!spaceToDelete) return;
    onDeleteSpace(spaceToDelete.id);
    setSpaceToDelete(null);
    setOpenMenuId(null);
  }

  return (
    <aside className={`sidebar ${spaceToDelete ? 'sidebar-with-dialog' : ''}`}>

      <nav className="sidebar-nav" aria-label="Main navigation">
        <button
          type="button"
          className={`nav-item nav-item-button ${activeSection === 'My Tasks' ? 'nav-item-active' : ''}`}
          onClick={() => navigate('myTasks')}
          aria-current={activeSection === 'My Tasks' ? 'page' : undefined}
          data-tip="My Tasks"
        >
          <Icon name="tasks" />
          <span className="nav-label">My Tasks</span>
        </button>

        <button
          type="button"
          className={`nav-item nav-item-button ${activeSection === 'Space Involved' ? 'nav-item-active' : ''}`}
          onClick={() => navigate('spaceInvolved')}
          aria-current={activeSection === 'Space Involved' ? 'page' : undefined}
          data-tip="Space Involved"
        >
          <Icon name="users" />
          <span className="nav-label">Space Involved</span>
        </button>

        <button
          type="button"
          className={`nav-item nav-item-button ${activeSection === 'Documents' ? 'nav-item-active' : ''}`}
          onClick={() => navigate('documents')}
          aria-current={activeSection === 'Documents' ? 'page' : undefined}
          data-tip="Documents"
        >
          <Icon name="file" />
          <span className="nav-label">Documents</span>
        </button>

        <div className="sidebar-divider" role="separator" />

        {/* Dashboards: up to 5 shortcuts (starred first, then recently opened). */}
        <div className={`spaces-nav-row ${activeSection === 'Dashboard' && !activeDashboardId ? 'spaces-nav-row-active' : ''}`}>
          <button
            type="button"
            className="spaces-main-toggle"
            onClick={() => navigate('dashboards')}
            aria-current={activeSection === 'Dashboard' && !activeDashboardId ? 'page' : undefined}
            title="All dashboards"
            data-tip="Dashboard"
          >
            <Icon name="dashboard" />
            <span className="nav-label">Dashboard</span>
          </button>
          <div className="spaces-nav-actions">
            <button
              type="button"
              className="spaces-add-button"
              onClick={() => navigate('dashboardBuilder')}
              aria-label="New dashboard"
              title="New dashboard"
            >
              <Icon name="plus" size={15} />
            </button>
            <button
              type="button"
              className={`spaces-chevron-button ${dashboardsExpanded ? 'is-expanded' : ''}`}
              onClick={() => setDashboardsExpanded((current) => !current)}
              aria-label={dashboardsExpanded ? 'Collapse Dashboards' : 'Expand Dashboards'}
              aria-expanded={dashboardsExpanded}
            >
              <Icon name="chevron" size={15} />
            </button>
          </div>
        </div>

        {dashboardsExpanded && !sidebarCollapsed && (
          <div className="spaces-submenu sidebar-dashboards" aria-label="Dashboards">
            {shortcutDashboards.map((dashboard) => (
              <div className={`space-item-row ${activeDashboardId === dashboard.id ? 'space-item-row-active' : ''}`} key={dashboard.id}>
                <button
                  type="button"
                  className={`space-item space-item-button ${activeDashboardId === dashboard.id ? 'space-item-active' : ''}`}
                  title={dashboard.name}
                  onClick={() => navigate('dashboard', { id: dashboard.id })}
                  aria-current={activeDashboardId === dashboard.id ? 'page' : undefined}
                >
                  <span className="sidebar-dashboard-icon"><Icon name="chart" size={15} /></span>
                  <span className="space-item-name">{dashboard.name}</span>
                  {dashboard.starred && <span className="sidebar-dashboard-star" aria-label="Starred"><Icon name="starFilled" size={13} /></span>}
                </button>
              </div>
            ))}
            {!shortcutDashboards.length && (
              <button type="button" className="sidebar-more-link" onClick={() => navigate('dashboardBuilder')}>
                <Icon name="plus" size={13} /> Create a dashboard
              </button>
            )}
            {dashboards.length > SIDEBAR_DASHBOARD_LIMIT && (
              <button type="button" className="sidebar-more-link" onClick={() => navigate('dashboards')}>
                <span>Show more dashboard</span>
                <Icon name="chevronsRight" size={14} />
              </button>
            )}
          </div>
        )}

        <div className={`spaces-nav-row ${activeSection === 'Spaces' ? 'spaces-nav-row-active' : ''}`}>
          <button
            type="button"
            className="spaces-main-toggle"
            onClick={() => {
              // Collapsed sidebar: open it on the project list instead of toggling a hidden list.
              if (sidebarCollapsed) { toggleSidebar(false); setSpacesExpanded(true); return; }
              setSpacesExpanded((current) => !current);
            }}
            aria-expanded={spacesExpanded && !sidebarCollapsed}
            data-tip="Spaces"
          >
            <Icon name="spaces" />
            <span className="nav-label">Spaces</span>
          </button>

          <div className="spaces-nav-actions">
            <button
              type="button"
              className="spaces-add-button"
              onClick={onCreateSpace}
              aria-label="Create Space"
              title="Create Space"
            >
              <Icon name="plus" size={15} />
            </button>
            <button
              type="button"
              className={`spaces-chevron-button ${spacesExpanded ? 'is-expanded' : ''}`}
              onClick={() => setSpacesExpanded((current) => !current)}
              aria-label={spacesExpanded ? 'Collapse Spaces' : 'Expand Spaces'}
              aria-expanded={spacesExpanded}
            >
              <Icon name="chevron" size={15} />
            </button>
          </div>
        </div>

        {spacesExpanded && !sidebarCollapsed && (
          <div className="spaces-submenu" ref={menuAreaRef}>
            {sidebarSpaces.length > 0 ? sidebarSpaces.map((space) => (
              <div className={`space-item-row ${activeSpaceId === space.id ? 'space-item-row-active' : ''}`} key={space.id}>
                <button
                  type="button"
                  className={`space-item space-item-button ${activeSpaceId === space.id ? 'space-item-active' : ''}`}
                  title={space.name}
                  onClick={() => navigate('space', { id: space.id, name: space.name })}
                >
                  {space.icon ? (
                    <img className="space-avatar space-avatar-image" src={space.icon} alt="" />
                  ) : (
                    <span className="space-avatar">
                      {(space.name || space.code || 'S').charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className="space-item-name">{space.name}</span>
                </button>

                {(canInSpace(space, 'project.setting') || space.permissions?.manage) && <button
                  type="button"
                  className={`space-more-button ${openMenuId === space.id ? 'is-open' : ''}`}
                  onClick={(event) => openSpaceMenu(event, space.id)}
                  aria-label={`More options for ${space.name}`}
                  aria-haspopup="menu"
                  aria-expanded={openMenuId === space.id}
                  title="More options"
                >
                  <Icon name="moreVertical" size={16} />
                </button>}

                {openMenuId === space.id && (
                  <div className="space-context-menu" role="menu">
                    {/* Project settings need the "Project Setting" permission. */}
                    {canInSpace(space, 'project.setting') && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setOpenMenuId(null);
                          onOpenSpaceSettings(space);
                        }}
                      >
                        <Icon name="settings" size={15} />
                        <span>Space setting</span>
                      </button>
                    )}
                    {/* Only the project owner or an administrator may delete a project. */}
                    {space.permissions?.manage && (
                      <button
                        type="button"
                        role="menuitem"
                        className="space-context-delete"
                        onClick={() => {
                          setOpenMenuId(null);
                          setSpaceToDelete(space);
                        }}
                      >
                        <Icon name="trash" size={15} />
                        <span>Delete space</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )) : (
              <div className="spaces-empty">No spaces yet</div>
            )}
            {spaces.length > sidebarSpaces.length && (
              <button type="button" className="sidebar-more-link" onClick={() => navigate('spaceInvolved')}>
                <span>Show more spaces</span>
                <Icon name="chevronsRight" size={14} />
              </button>
            )}
          </div>
        )}

        <div className="sidebar-divider" role="separator" />

        <button
          type="button"
          className={`nav-item nav-item-button ${activeSection === 'Filter' ? 'nav-item-active' : ''}`}
          onClick={() => navigate('filter')}
          aria-current={activeSection === 'Filter' ? 'page' : undefined}
          data-tip="Filter"
        >
          <Icon name="filter" />
          <span className="nav-label">Filter</span>
        </button>
      </nav>

      <div className="sidebar-bottom">
        <div className="workspace-profile" data-tip="TASKFLOW · Personal workspace">
          <div className="workspace-avatar">T</div>
          <div className="workspace-text">
            <strong>TASKFLOW</strong>
            <span>Personal workspace</span>
          </div>
        </div>
      </div>

      {spaceToDelete && (
        <div className="space-delete-overlay" role="presentation" onMouseDown={() => setSpaceToDelete(null)}>
          <section
            className="space-delete-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-space-title"
            aria-describedby="delete-space-description"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="space-delete-icon"><Icon name="trash" size={21} /></div>
            <h2 id="delete-space-title">Delete space?</h2>
            <p id="delete-space-description">
              Are you sure you want to delete <strong>{spaceToDelete.name || spaceToDelete.code}</strong>? This action cannot be undone.
            </p>
            <div className="space-delete-actions">
              <button type="button" className="space-delete-cancel" onClick={() => setSpaceToDelete(null)}>Cancel</button>
              <button type="button" className="space-delete-confirm" onClick={confirmDelete}>Delete space</button>
            </div>
          </section>
        </div>
      )}
    </aside>
  );
}
