import { useEffect, useRef, useState } from 'react';
import Icon from '../common/Icon';
import UserProfileMenu from './UserProfileMenu';
import NotificationBell from './NotificationBell';
import { useAppShell } from '../../context/appShellContext';
import './Header.css';

function getTaskKey(task) {
  return String(task?.key || task?.code || task?.taskCode || '').trim();
}
function getTaskTitle(task) {
  return task?.summary || task?.title || task?.name || 'Untitled work item';
}
function getTaskType(task) {
  return task?.issueType || task?.type || 'Task';
}
function getSpaceName(task, spaces) {
  const id = task?.spaceId ?? task?.projectId ?? task?.space?.id;
  const code = String(task?.spaceCode ?? task?.projectCode ?? '').toLowerCase();
  const space = (spaces || []).find((item) =>
    (id !== undefined && id !== null && String(item.id) === String(id)) ||
    (code && String(item.code || '').toLowerCase() === code)
  );
  return space?.name || space?.code || task?.spaceName || task?.projectName || 'Unknown Project';
}

export default function Header({
  spaces = [], tasks = [], onGlobalCreate = () => {}, onOpenTask = () => {}
}) {
  const { isAdmin, navigate, openAssistant, sidebarCollapsed, toggleSidebar } = useAppShell();
  const [globalSearch, setGlobalSearch] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const searchWrapRef = useRef(null);
  useEffect(() => {
    if (searchResults === null) return undefined;
    const handleOutside = (event) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(event.target)) setSearchResults(null);
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape') setSearchResults(null);
    };
    document.addEventListener('pointerdown', handleOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [searchResults]);

  function submitGlobalSearch(event) {
    event.preventDefault();
    const query = globalSearch.trim().toLowerCase();
    if (!query) { setSearchResults(null); return; }
    const matches = (Array.isArray(tasks) ? tasks : []).filter((task) => {
      const keys = [task?.key, task?.code, task?.taskCode].filter(Boolean)
        .map((value) => String(value).trim().toLowerCase());
      return keys.includes(query);
    });
    if (matches.length === 1) {
      const task = matches[0];
      setSearchResults(null);
      setGlobalSearch('');
      onOpenTask(task);
      return;
    }
    setSearchResults(matches);
  }

  function chooseTask(task) {
    setSearchResults(null);
    setGlobalSearch('');
    onOpenTask(task);
  }

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <button
          type="button"
          className="header-icon-button menu-button"
          onClick={() => toggleSidebar()}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!sidebarCollapsed}
          title={sidebarCollapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}
        >
          <Icon name={sidebarCollapsed ? 'sidebarOpen' : 'sidebarClose'} size={19} />
        </button>
        <div className="brand-logo">TASK<span>FLOW</span></div>
      </div>

      <div className="topbar-main">
        <div className="global-search-wrap" ref={searchWrapRef}>
          <form className="global-search" onSubmit={submitGlobalSearch} role="search">
            <Icon name="search" size={17} />
            <input
              type="search" placeholder="Search..." value={globalSearch}
              onChange={(event) => {
                setGlobalSearch(event.target.value);
                if (searchResults !== null) setSearchResults(null);
              }}
              aria-label="Search work items across all Projects"
              aria-expanded={searchResults !== null && searchResults.length > 1}
              aria-controls="global-search-results"
            />
            {globalSearch && (
              <button type="button" className="global-search-clear"
                onClick={() => { setGlobalSearch(''); setSearchResults(null); }}
                aria-label="Clear search">×</button>
            )}
          </form>

          {searchResults !== null && (
            <div className="global-search-dropdown" id="global-search-results" role="listbox">
              {searchResults.length > 0 ? (
                <>
                  {searchResults.length > 1 && <div className="global-search-heading">Found {searchResults.length} work items with this key</div>}
                  {searchResults.map((task, index) => (
                    <button type="button" className="global-search-result"
                      key={`${task.id || getTaskKey(task)}-${index}`}
                      onClick={() => chooseTask(task)} role="option">
                      <span className="global-search-result-main">
                        <strong>{getTaskKey(task)}</strong><span>{getTaskTitle(task)}</span>
                      </span>
                      <span className="global-search-result-meta">{getSpaceName(task, spaces)} · {getTaskType(task)}</span>
                    </button>
                  ))}
                </>
              ) : (
                <div className="global-search-empty">
                  <strong>No work item found</strong>
                  <span>No issue with key “{globalSearch.trim()}” exists in the available Projects.</span>
                </div>
              )}
            </div>
          )}
        </div>

        <button type="button" className="create-button" onClick={onGlobalCreate} aria-label="Create" title="Create">
          <Icon name="plus" size={16} /><span>Create</span>
        </button>
        <div className="header-spacer" />
        <button type="button" className="header-icon-button ai-header-button" aria-label="AI Project Assistant" title="AI Project Assistant" onClick={() => openAssistant()}>
          <Icon name="sparkles" size={19} />
        </button>
        <NotificationBell />
        {/* System Settings is for administrators only (the page and its API are guarded too). */}
        {isAdmin && (
          <button
            type="button"
            className="header-icon-button header-settings-button"
            aria-label="System settings"
            title="System settings"
            onClick={() => navigate('systemSettings', { tab: 'users' })}
          >
            <Icon name="settings" size={19} />
          </button>
        )}

        <UserProfileMenu />
      </div>
    </header>
  );
}
