import { useEffect, useRef, useState } from 'react';
import { canInSpace } from '../../services/projectPermissions';
import Icon from '../common/Icon';
import './Sidebar.css';

export default function Sidebar({
  activeSection = 'My Tasks',
  activeSpaceId = null,
  spaces = [],
  onCreateSpace = () => {},
  onNavigate = () => {},
  onOpenSpaceSettings = () => {},
  onDeleteSpace = () => {}
}) {
  const [spacesExpanded, setSpacesExpanded] = useState(true);
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
      <div className="sidebar-section-label">WORKSPACE</div>

      <nav className="sidebar-nav" aria-label="Main navigation">
        <button
          type="button"
          className={`nav-item nav-item-button ${activeSection === 'My Tasks' ? 'nav-item-active' : ''}`}
          onClick={() => navigate('myTasks')}
          aria-current={activeSection === 'My Tasks' ? 'page' : undefined}
        >
          <Icon name="tasks" />
          <span>My Tasks</span>
        </button>

        <button
          type="button"
          className={`nav-item nav-item-button ${activeSection === 'Documents' ? 'nav-item-active' : ''}`}
          onClick={() => navigate('documents')}
          aria-current={activeSection === 'Documents' ? 'page' : undefined}
        >
          <Icon name="file" />
          <span>Documents</span>
        </button>

        <button
          type="button"
          className={`nav-item nav-item-button ${activeSection === 'Dashboard' ? 'nav-item-active' : ''}`}
          onClick={() => navigate('dashboard')}
          aria-current={activeSection === 'Dashboard' ? 'page' : undefined}
        >
          <Icon name="dashboard" />
          <span>Dashboard</span>
        </button>

        <div className={`spaces-nav-row ${activeSection === 'Spaces' ? 'spaces-nav-row-active' : ''}`}>
          <button
            type="button"
            className="spaces-main-toggle"
            onClick={() => setSpacesExpanded((current) => !current)}
            aria-expanded={spacesExpanded}
          >
            <Icon name="spaces" />
            <span>Spaces</span>
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

        {spacesExpanded && (
          <div className="spaces-submenu" ref={menuAreaRef}>
            {spaces.length > 0 ? spaces.map((space) => (
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
          </div>
        )}

        <button
          type="button"
          className={`nav-item nav-item-button ${activeSection === 'Filter' ? 'nav-item-active' : ''}`}
          onClick={() => navigate('filter')}
          aria-current={activeSection === 'Filter' ? 'page' : undefined}
        >
          <Icon name="filter" />
          <span>Filter</span>
        </button>
      </nav>

      <div className="sidebar-bottom">
        <div className="workspace-profile">
          <div className="workspace-avatar">T</div>
          <div>
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
