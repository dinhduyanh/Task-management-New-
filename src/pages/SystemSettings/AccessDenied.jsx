import Header from '../../components/layout/Header';
import Sidebar from '../../components/layout/Sidebar';
import Icon from '../../components/common/Icon';
import './SystemSettings.css';

/** Shown instead of System Settings to signed-in users who are not administrators. */
export default function AccessDenied({ spaces = [], tasks = [], onNavigate = () => {}, onCreateSpace = () => {}, onOpenSpaceSettings = () => {}, onDeleteSpace = () => {}, onGlobalCreate = () => {}, onOpenTask = () => {}, onBack = () => {} }) {
  return (
    <div className="app-shell">
      <Header spaces={spaces} tasks={tasks} onGlobalCreate={onGlobalCreate} onOpenTask={onOpenTask} />
      <Sidebar activeSection="" spaces={spaces} onNavigate={onNavigate} onCreateSpace={onCreateSpace} onOpenSpaceSettings={onOpenSpaceSettings} onDeleteSpace={onDeleteSpace} />
      <main className="main-content">
        <div className="ss-denied" role="alert">
          <span className="ss-denied-icon"><Icon name="lock" size={28} /></span>
          <h1>Access denied</h1>
          <p>System settings are only available to administrators. Ask an administrator if you need access.</p>
          <button type="button" className="ss-button is-primary" onClick={onBack}>Back to My Tasks</button>
        </div>
      </main>
    </div>
  );
}
