import { useEffect, useState } from 'react';
import { api } from './services/api';
import { authService, clearSession, getStoredUser, isAuthenticated, storeUser } from './services/authService';
import { userProfileService } from './services/userProfileService';
import { AppShellContext } from './context/appShellContext';
import { applyTheme, getInitialTheme } from './theme/theme';
import Login from './pages/Login/Login';
import MyTasks from './pages/MyTasks/MyTasks';
import CreateSpace from './pages/CreateSpace/CreateSpace';
import SpacesSummary from './pages/SpacesSummary/SpacesSummary';
import SpacesList, { IssueModal } from './pages/SpacesList/SpacesList';
import SpaceSettings from './pages/SpaceSettings/SpaceSettings';
import SpaceBoard from './pages/SpaceBoard/SpaceBoard';
import SpaceTimeline from './pages/SpaceTimeline/SpaceTimeline';
import SpaceBacklog from './pages/SpaceBacklog/SpaceBacklog';
import SpaceActiveSprints from './pages/SpaceActiveSprints/SpaceActiveSprints';
import SpaceTeams from './pages/SpaceTeams/SpaceTeams';
import Documents from './pages/Documents/Documents';
import SystemSettings from './pages/SystemSettings/SystemSettings';
import AccessDenied from './pages/SystemSettings/AccessDenied';
import { canInSpace } from './services/projectPermissions';
import Dashboard from './pages/Dashboard/Dashboard';
import PlaceholderPage from './pages/Placeholder/PlaceholderPage';
import UserProfile from './pages/UserProfile/UserProfile';
import './App.css';

const initialRoute = { page: 'myTasks', data: null };
const SETTINGS_HASH = /^#\/settings(?:\/([a-z-]+))?$/;

/** System Settings is the one page with its own URL (#/settings/<tab>), so it can be bookmarked. */
function settingsRouteFromHash() {
  const match = window.location.hash.match(SETTINGS_HASH);
  return match ? { page: 'systemSettings', data: { tab: match[1] || 'users' } } : null;
}

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(isAuthenticated);
  const [currentUser, setCurrentUser] = useState(getStoredUser);
  const [loginNotice, setLoginNotice] = useState('');
  const [theme, setTheme] = useState(getInitialTheme);
  const [navigationStack, setNavigationStack] = useState(() => {
    const settings = settingsRouteFromHash();
    return settings ? [initialRoute, settings] : [initialRoute];
  });
  const [spaces, setSpaces] = useState([]);
  // Spaces and Work Items are loaded from the persistent SQLite Backend.
  const [tasks, setTasks] = useState([]);
  const [globalCreateOpen, setGlobalCreateOpen] = useState(false);
  const [backendError, setBackendError] = useState('');

  async function loadPersistentData() {
    try {
      const [spaceRows, taskRows] = await Promise.all([api.getSpaces(), api.getWorkItems()]);
      setSpaces(Array.isArray(spaceRows) ? spaceRows : []);
      setTasks(Array.isArray(taskRows) ? taskRows : []);
      setBackendError('');
    } catch (error) {
      if (error?.status === 401) {
        endLocalSession('Your session has expired. Please sign in again.');
        return;
      }
      setBackendError(error.message || 'Cannot connect to TASKFLOW Backend.');
    }
  }

  // Projects and work items are only available to a signed-in user (and only the
  // projects that user may access), so they load after sign-in.
  useEffect(() => {
    if (!isLoggedIn) return;
    loadPersistentData();
  }, [isLoggedIn]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Refresh the signed-in user from the server. A 401 means the session cookie
  // expired or was revoked, so fall back to the Sign In page.
  useEffect(() => {
    if (!isLoggedIn) return undefined;
    let active = true;
    userProfileService.getMe()
      .then((user) => { if (active) setCurrentUser(user); })
      .catch((error) => {
        if (!active || error?.status !== 401) return;
        endLocalSession('Your session has expired. Please sign in again.');
      });
    return () => { active = false; };
  }, [isLoggedIn]);

  const currentRoute = navigationStack[navigationStack.length - 1] || initialRoute;
  const isAdmin = currentUser?.role === 'admin';

  // Keep the address bar in sync with System Settings (and open it when the URL is typed).
  useEffect(() => {
    const settingsTab = currentRoute.page === 'systemSettings' ? currentRoute.data?.tab || 'users' : null;
    const target = settingsTab ? `#/settings/${settingsTab}` : '';
    if (window.location.hash !== target && (settingsTab || SETTINGS_HASH.test(window.location.hash))) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${target}`);
    }
  }, [currentRoute]);

  useEffect(() => {
    const onHashChange = () => {
      const settings = settingsRouteFromHash();
      if (settings) setNavigationStack((current) => [...current, settings]);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  /** Replaces the data of the current route (e.g. the selected settings tab). */
  function updateCurrentRoute(data) {
    setNavigationStack((current) => [...current.slice(0, -1), { ...current[current.length - 1], data }]);
  }

  function navigate(page, data = null) {
    setNavigationStack((current) => {
      const lastRoute = current[current.length - 1];
      if (
        lastRoute?.page === page &&
        JSON.stringify(lastRoute?.data ?? null) === JSON.stringify(data ?? null)
      ) return current;
      // Already in System settings (e.g. the gear clicked again): switch tab, keep one entry,
      // so the back arrow returns to the screen the admin came from.
      if (page === 'systemSettings' && lastRoute?.page === 'systemSettings') {
        return [...current.slice(0, -1), { page, data }];
      }
      return [...current, { page, data }];
    });
  }

  function goBack() {
    setNavigationStack((current) => current.length <= 1 ? [initialRoute] : current.slice(0, -1));
  }

  function handleLogin(user) {
    setCurrentUser(user);
    setLoginNotice('');
    setIsLoggedIn(true);
    // Arriving through a #/settings link: open it after signing in (the page still checks the role).
    const settings = settingsRouteFromHash();
    setNavigationStack(settings ? [initialRoute, settings] : [initialRoute]);
  }

  function handleUserUpdated(updatedUser) {
    setCurrentUser(updatedUser);
    storeUser(updatedUser);
  }

  function endLocalSession(notice = '') {
    clearSession();
    setSpaces([]);
    setTasks([]);
    setCurrentUser(null);
    setIsLoggedIn(false);
    setLoginNotice(notice);
    setGlobalCreateOpen(false);
    setNavigationStack([initialRoute]);
  }

  async function handleSignOut() {
    await authService.logout();
    endLocalSession();
  }

  async function handleSaveSpace(spaceData) {
    const createdAt = new Date().toISOString();
    const spacePayload = {
      ...spaceData,
      createdAt,
      createdBy: 'You',
      owner: { name: 'You', initials: 'YO' },
      members: [{ id: 'current-user', name: 'You', initials: 'YO', role: 'Owner' }],
      activities: [{ id: 'space-created', actor: 'You', description: 'created this space', createdAt }]
    };
    try {
      const newSpace = await api.createSpace(spacePayload);
      setSpaces((currentSpaces) => [...currentSpaces, newSpace]);
      setBackendError('');
      setNavigationStack((current) => {
        const previousRoutes = current[current.length - 1]?.page === 'createSpace'
          ? current.slice(0, -1)
          : current;
        return [...previousRoutes, { page: 'space', data: { id: newSpace.id } }];
      });
      return newSpace;
    } catch (error) {
      setBackendError(error.message || 'Unable to save Space.');
      return null;
    }
  }

  async function handleUpdateSpace(spaceId, updates) {
    try {
      const savedSpace = await api.updateSpace(spaceId, updates);
      setSpaces((currentSpaces) => currentSpaces.map((space) => space.id === spaceId ? savedSpace : space));
      setBackendError('');
      return savedSpace;
    } catch (error) {
      setBackendError(error.message || 'Unable to update Space.');
      return null;
    }
  }

  /** Adds a member or changes their project roles. Resolves to '' or an error message. */
  async function handleAddSpaceMembers(spaceId, { userId, roles }) {
    try {
      const members = await api.addSpaceMember(spaceId, { userId, roles });
      setSpaces((currentSpaces) => currentSpaces.map((space) =>
        space.id === spaceId ? { ...space, members } : space
      ));
      return '';
    } catch (error) {
      return error.message || 'Unable to add the member.';
    }
  }

  /** Resolves to '' or an error message. */
  async function handleRemoveSpaceMember(spaceId, userId) {
    try {
      const members = await api.removeSpaceMember(spaceId, userId);
      setSpaces((currentSpaces) => currentSpaces.map((space) =>
        space.id === spaceId ? { ...space, members } : space
      ));
      return '';
    } catch (error) {
      return error.message || 'Unable to remove the member.';
    }
  }

  function handleOpenTaskFromGlobalSearch(task) {
    if (!task) return;

    const taskId = task.id ?? task._id;
    const taskSpaceId = task.spaceId ?? task.projectId ?? task.space?.id ?? task.project?.id;
    const taskSpaceCode = String(
      task.spaceCode ?? task.projectCode ?? task.space?.code ?? task.project?.code ?? ''
    ).trim().toLowerCase();
    const taskKey = String(task.key ?? task.code ?? task.taskCode ?? '').trim().toLowerCase();

    let targetSpace = spaces.find((space) =>
      taskSpaceId !== undefined && taskSpaceId !== null &&
      String(space.id) === String(taskSpaceId)
    );

    if (!targetSpace && taskSpaceCode) {
      targetSpace = spaces.find((space) =>
        String(space.code || '').trim().toLowerCase() === taskSpaceCode ||
        String(space.taskKeyPrefix || '').trim().toLowerCase() === taskSpaceCode
      );
    }

    // Older issue records may only carry their key. Resolve the Space by its
    // key prefix when that prefix identifies exactly one Space.
    if (!targetSpace && taskKey) {
      const prefixMatches = spaces.filter((space) => {
        const prefix = String(space.taskKeyPrefix || space.code || '').trim().toLowerCase();
        return prefix && taskKey.startsWith(`${prefix}-`);
      });
      if (prefixMatches.length === 1) targetSpace = prefixMatches[0];
    }

    if (!targetSpace || taskId === undefined || taskId === null) {
      console.warn('Global Search could not resolve the Space or issue ID for this work item.', task);
      return;
    }

    const openRequestId = globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    navigate('spaceList', {
      id: targetSpace.id,
      taskId,
      fullPageTaskDetail: true,
      openRequestId
    });
  }

  async function handleCreateTask(taskData) {
    try {
      const newTask = await api.createWorkItem(taskData);
      setTasks((currentTasks) => [...currentTasks, newTask]);
      setBackendError('');
      return newTask;
    } catch (error) {
      setBackendError(error.message || 'Unable to create Work Item.');
      return null;
    }
  }

  async function handleUpdateTask(taskId, updates) {
    try {
      const updatedTask = await api.updateWorkItem(taskId, updates);
      setTasks((currentTasks) => currentTasks.map((task) => task.id === taskId ? updatedTask : task));
      setBackendError('');
      return updatedTask;
    } catch (error) {
      setBackendError(error.message || 'Unable to update Work Item.');
      return null;
    }
  }

  /** Moves work items into a sprint (null = backlog) in the given order. Optimistic. */
  async function handleRankTasks(ids, sprintId) {
    const order = new Map(ids.map((id, index) => [String(id), index]));
    setTasks((currentTasks) => currentTasks.map((task) => order.has(String(task.id))
      ? { ...task, sprintId: sprintId || null, rank: order.get(String(task.id)) }
      : task));
    try {
      const updated = await api.rankWorkItems(ids, sprintId);
      const byId = new Map(updated.map((task) => [String(task.id), task]));
      setTasks((currentTasks) => currentTasks.map((task) => byId.get(String(task.id)) || task));
      setBackendError('');
      return true;
    } catch (error) {
      setBackendError(error.message || 'Unable to move Work Items.');
      loadPersistentData();
      return false;
    }
  }

  async function handleDeleteTasks(itemsOrIds) {
    const taskIds = (Array.isArray(itemsOrIds) ? itemsOrIds : []).map((item) =>
      typeof item === 'object' && item !== null ? item.id : item
    ).filter(Boolean);
    try {
      await api.deleteWorkItems(taskIds);
      const ids = new Set(taskIds.map(String));
      setTasks((currentTasks) => currentTasks.filter((task) => !ids.has(String(task.id))));
      setBackendError('');
    } catch (error) {
      setBackendError(error.message || 'Unable to delete Work Items.');
    }
  }

  async function handleMoveTasks(itemsOrIds, targetSpace) {
    const taskIds = (Array.isArray(itemsOrIds) ? itemsOrIds : []).map((item) =>
      typeof item === 'object' && item !== null ? item.id : item
    ).filter(Boolean);
    try {
      await api.moveWorkItems(taskIds, targetSpace.id);
      const updatedAt = new Date().toISOString();
      setTasks((currentTasks) => currentTasks.map((task) => taskIds.some((id) => String(id) === String(task.id))
        ? { ...task, spaceId: targetSpace.id, projectId: targetSpace.id, spaceCode: targetSpace.code || '', projectCode: targetSpace.code || '', updatedAt }
        : task));
      setBackendError('');
    } catch (error) {
      setBackendError(error.message || 'Unable to move Work Items.');
    }
  }

  async function handleDeleteSpace(spaceId) {
    try {
      await api.deleteSpace(spaceId);
      setSpaces((currentSpaces) => currentSpaces.filter((space) => String(space.id) !== String(spaceId)));
      setTasks((currentTasks) => currentTasks.filter((task) => String(task.spaceId) !== String(spaceId)));
      setNavigationStack([initialRoute]);
      setBackendError('');
    } catch (error) {
      setBackendError(error.message || 'Unable to delete Space.');
    }
  }

  function handleOpenSpaceSettings(space) {
    navigate('spaceSettings', { id: space.id, name: space.name, tab: 'Summary' });
  }

  function replaceWorkItem(updated) {
    if (!updated?.id) return;
    setTasks((currentTasks) => currentTasks.map((task) => String(task.id) === String(updated.id) ? updated : task));
  }

  const appShell = {
    user: currentUser,
    theme,
    setTheme,
    navigate,
    signOut: handleSignOut,
    isAdmin,
    replaceWorkItem
  };

  if (!isLoggedIn) return <Login onLogin={handleLogin} notice={loginNotice} />;

  const sharedNavigationProps = {
    spaces,
    tasks,
    allTasks: tasks,
    onNavigate: navigate,
    onCreateSpace: () => navigate('createSpace'),
    onOpenSpaceSettings: handleOpenSpaceSettings,
    onDeleteSpace: handleDeleteSpace,
    onGlobalCreate: () => setGlobalCreateOpen(true),
    onOpenTask: handleOpenTaskFromGlobalSearch
  };

  let pageContent;

  if (currentRoute.page === 'profile') {
    pageContent = (
      <UserProfile
        {...sharedNavigationProps}
        user={currentUser}
        onUserUpdated={handleUserUpdated}
        onPasswordChanged={() => endLocalSession('Password changed. Please sign in again with your new password.')}
        onSessionExpired={() => endLocalSession('Your session has expired. Please sign in again.')}
        onBack={goBack}
      />
    );
  } else if (currentRoute.page === 'createSpace') {
    pageContent = (
      <CreateSpace
        {...sharedNavigationProps}
        onBack={goBack}
        onCancel={goBack}
        onSave={handleSaveSpace}
      />
    );
  } else if (currentRoute.page === 'myTasks') {
    pageContent = <MyTasks {...sharedNavigationProps} />;
  } else if (currentRoute.page === 'space') {
    const selectedSpace = spaces.find((space) => space.id === currentRoute.data?.id) || currentRoute.data || {};
    pageContent = <SpacesSummary {...sharedNavigationProps} space={selectedSpace} />;
  } else if (currentRoute.page === 'spaceList') {
    const selectedSpace = spaces.find((space) => space.id === currentRoute.data?.id) || currentRoute.data || {};
    pageContent = (
      <SpacesList
        {...sharedNavigationProps}
        space={selectedSpace}
        initialTaskId={currentRoute.data?.taskId || null}
        initialTaskOpenRequestId={currentRoute.data?.openRequestId || null}
        fullPageTaskDetail={currentRoute.data?.fullPageTaskDetail === true}
        onCreateTask={handleCreateTask}
        onUpdateTask={handleUpdateTask}
        onDeleteTasks={handleDeleteTasks}
        onMoveTasks={handleMoveTasks}
      />
    );
  } else if (currentRoute.page === 'spaceSettings') {
    const selectedSpace = spaces.find((space) => space.id === currentRoute.data?.id);
    if (!selectedSpace) {
      pageContent = (
        <PlaceholderPage
          {...sharedNavigationProps}
          title="Space not found"
          activeSection="Spaces"
          onBack={goBack}
        />
      );
    } else if (!canInSpace(selectedSpace, 'project.setting', null, currentUser)) {
      // Route guard: project settings need the "Project Setting" permission (the API enforces it too).
      pageContent = (
        <AccessDenied
          {...sharedNavigationProps}
          message={`You need the Project Setting permission to open the settings of ${selectedSpace.name}. Ask a project admin if you need access.`}
          backLabel="Back to project"
          onBack={() => navigate('space', { id: selectedSpace.id, name: selectedSpace.name })}
        />
      );
    } else {
      pageContent = (
        <SpaceSettings
          {...sharedNavigationProps}
          space={selectedSpace}
          onBack={() => navigate('space', { id: selectedSpace.id, name: selectedSpace.name })}
          onSave={(updates) => handleUpdateSpace(selectedSpace.id, updates)}
          onAddMember={(payload) => handleAddSpaceMembers(selectedSpace.id, payload)}
          onRemoveMember={(userId) => handleRemoveSpaceMember(selectedSpace.id, userId)}
        />
      );
    }
  } else if (currentRoute.page === 'systemSettings') {
    // Route guard: the settings page is for administrators only (the API enforces it too).
    pageContent = isAdmin ? (
      <SystemSettings
        {...sharedNavigationProps}
        tab={currentRoute.data?.tab || 'users'}
        onTabChange={(tab) => updateCurrentRoute({ tab })}
        onBack={goBack}
        onDataChanged={loadPersistentData}
      />
    ) : (
      <AccessDenied {...sharedNavigationProps} onBack={() => setNavigationStack([initialRoute])} />
    );
  } else if (currentRoute.page === 'dashboard') {
    pageContent = <Dashboard {...sharedNavigationProps} isAdmin={isAdmin} />;
  } else if (currentRoute.page === 'documents') {
    pageContent = <Documents {...sharedNavigationProps} />;
  } else if (currentRoute.page === 'spaceTab' && currentRoute.data?.tab === 'Teams') {
    const selectedSpace = spaces.find((space) => space.id === currentRoute.data?.id) || currentRoute.data || {};
    pageContent = (
      <SpaceTeams
        key={selectedSpace.id}
        {...sharedNavigationProps}
        space={selectedSpace}
        onRefreshData={loadPersistentData}
      />
    );
  } else if (currentRoute.page === 'spaceTab' && currentRoute.data?.tab === 'Active Sprints') {
    const selectedSpace = spaces.find((space) => space.id === currentRoute.data?.id) || currentRoute.data || {};
    pageContent = (
      <SpaceActiveSprints
        key={selectedSpace.id}
        {...sharedNavigationProps}
        space={selectedSpace}
        onCreateTask={handleCreateTask}
        onUpdateTask={handleUpdateTask}
        onDeleteTasks={handleDeleteTasks}
        onRefreshTasks={loadPersistentData}
      />
    );
  } else if (currentRoute.page === 'spaceTab' && currentRoute.data?.tab === 'Backlog') {
    const selectedSpace = spaces.find((space) => space.id === currentRoute.data?.id) || currentRoute.data || {};
    pageContent = (
      <SpaceBacklog
        key={selectedSpace.id}
        {...sharedNavigationProps}
        space={selectedSpace}
        onCreateTask={handleCreateTask}
        onUpdateTask={handleUpdateTask}
        onDeleteTasks={handleDeleteTasks}
        onRankTasks={handleRankTasks}
        onRefreshTasks={loadPersistentData}
      />
    );
  } else if (currentRoute.page === 'spaceTab' && currentRoute.data?.tab === 'Timeline') {
    const selectedSpace = spaces.find((space) => space.id === currentRoute.data?.id) || currentRoute.data || {};
    pageContent = (
      <SpaceTimeline
        {...sharedNavigationProps}
        space={selectedSpace}
        onCreateTask={handleCreateTask}
        onUpdateTask={handleUpdateTask}
        onDeleteTasks={handleDeleteTasks}
      />
    );
  } else if (
    currentRoute.page === 'spaceBoard' ||
    (currentRoute.page === 'spaceTab' && currentRoute.data?.tab === 'Board')
  ) {
    const selectedSpace = spaces.find((space) => space.id === currentRoute.data?.id) || currentRoute.data || {};
    pageContent = (
      <SpaceBoard
        {...sharedNavigationProps}
        space={selectedSpace}
        onCreateTask={handleCreateTask}
        onUpdateTask={handleUpdateTask}
        onDeleteTasks={handleDeleteTasks}
        onSaveBoard={(columns) => handleUpdateSpace(selectedSpace.id, { board: { columns } })}
      />
    );
  } else if (currentRoute.page === 'spaceTab') {
    const space = spaces.find((item) => item.id === currentRoute.data?.id) || currentRoute.data || {};
    const tab = currentRoute.data?.tab || 'Space';
    pageContent = (
      <PlaceholderPage
        {...sharedNavigationProps}
        title={`${space.name || space.code || 'Space'} / ${tab}`}
        activeSection="Spaces"
        activeSpaceId={space.id || null}
        onBack={goBack}
      />
    );
  } else {
    const placeholderTitles = { filter: 'Filter' };
    pageContent = (
      <PlaceholderPage
        {...sharedNavigationProps}
        title={placeholderTitles[currentRoute.page] || 'TASKFLOW'}
        activeSection={placeholderTitles[currentRoute.page] || 'My Tasks'}
        onBack={goBack}
      />
    );
  }

  const routeSpaceId = currentRoute.data?.id;
  const globalInitialSpaceId = spaces.some((space) => String(space.id) === String(routeSpaceId))
    ? routeSpaceId
    : '';

  async function handleGlobalCreateTask(payload) {
    const createdTask = await handleCreateTask(payload);
    if (!createdTask) return false;
    // Global Create only saves the Work Item. Keep the user on the current screen.
    setGlobalCreateOpen(false);
    return createdTask;
  }

  return (
    <AppShellContext.Provider value={appShell}>
      {backendError && (
        <div role="alert" style={{ position: 'fixed', left: 16, bottom: 16, zIndex: 2000, maxWidth: 520, padding: '12px 14px', border: '1px solid #F1C6C8', borderRadius: 8, background: '#FFF1F0', color: '#9F2D2D', boxShadow: '0 4px 16px rgba(9,30,66,.12)', fontSize: 12 }}>
          <strong>Backend:</strong> {backendError}
          <button type="button" onClick={loadPersistentData} style={{ marginLeft: 12, border: 0, background: 'transparent', color: '#0052CC', fontWeight: 700, cursor: 'pointer' }}>Retry</button>
        </div>
      )}
      {pageContent}
      {globalCreateOpen && (
        <IssueModal
          allowProjectSelection
          spaces={spaces}
          existingIssues={tasks}
          initialSpaceId={globalInitialSpaceId}
          onClose={() => setGlobalCreateOpen(false)}
          onCreate={handleGlobalCreateTask}
        />
      )}
    </AppShellContext.Provider>
  );
}
