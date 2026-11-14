import { useState } from 'react';
import Header from '../../components/layout/Header';
import Sidebar from '../../components/layout/Sidebar';
import Icon from '../../components/common/Icon';
import Toast from '../../components/common/Toast';
import UsersPanel from './UsersPanel';
import ProjectRolesPanel from './ProjectRolesPanel';
import MultilingualPanel from './MultilingualPanel';
import WidgetsPanel from './WidgetsPanel';
import './SystemSettings.css';

const TABS = [
  { id: 'users', label: 'User Management', icon: 'users', description: 'Accounts and system roles' },
  { id: 'project-roles', label: 'Project Roles', icon: 'shield', description: 'Roles for project members' },
  { id: 'multilingual', label: 'Multilingual', icon: 'file', description: 'Vietnamese / English' },
  { id: 'widgets', label: 'Widgets', icon: 'dashboard', description: 'SQL widgets for the Dashboard' }
];

/** System administration (admins only; App guards the route and the API checks the role). */
export default function SystemSettings({
  tab = 'users',
  onTabChange = () => {},
  onDataChanged = () => {},
  spaces = [],
  tasks = [],
  onNavigate = () => {},
  onCreateSpace = () => {},
  onOpenSpaceSettings = () => {},
  onDeleteSpace = () => {},
  onGlobalCreate = () => {},
  onOpenTask = () => {}
}) {
  const [toast, setToast] = useState(null);
  const active = TABS.find((item) => item.id === tab) || TABS[0];

  return (
    <div className="app-shell">
      <Header spaces={spaces} tasks={tasks} onGlobalCreate={onGlobalCreate} onOpenTask={onOpenTask} />
      <Sidebar activeSection="" spaces={spaces} onNavigate={onNavigate} onCreateSpace={onCreateSpace} onOpenSpaceSettings={onOpenSpaceSettings} onDeleteSpace={onDeleteSpace} />

      <main className="main-content ss-main">
        <div className="page-heading">
          <div>
            <div className="breadcrumb">Administration <span>/</span> System settings</div>
            <h1>System settings</h1>
            <p className="ss-subtitle">Manage accounts, project roles, languages and dashboard widgets. Only administrators can see this page.</p>
          </div>
        </div>

        <div className="ss-layout">
          <nav className="ss-nav" aria-label="System settings sections">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === active.id ? 'active' : ''}
                aria-current={item.id === active.id ? 'page' : undefined}
                onClick={() => onTabChange(item.id)}
              >
                <Icon name={item.icon} size={17} />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
              </button>
            ))}
          </nav>

          <section className="ss-panel" aria-label={active.label}>
            {active.id === 'users' && <UsersPanel onToast={setToast} onDataChanged={onDataChanged} />}
            {active.id === 'project-roles' && <ProjectRolesPanel onToast={setToast} onDataChanged={onDataChanged} />}
            {active.id === 'multilingual' && <MultilingualPanel />}
            {active.id === 'widgets' && <WidgetsPanel onToast={setToast} onOpenDashboard={() => onNavigate('dashboard')} />}
          </section>
        </div>
      </main>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
