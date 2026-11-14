import Header from '../../components/layout/Header';
import Sidebar from '../../components/layout/Sidebar';
import Icon from '../../components/common/Icon';
import './SystemSettings.css';

/** Shown instead of a page the signed-in user may not open (System settings, project settings). */
export default function AccessDenied({ spaces = [], tasks = [], onNavigate = () => {}, onCreateSpace = () => {}, onOpenSpaceSettings = () => {}, onDeleteSpace = () => {}, onGlobalCreate = () => {}, onOpenTask = () => {}, onBack = () => {}, message = 'System settings are only available to administrators. Ask an administrator if you need access.', backLabel = 'Back to My Tasks' }) {
  return (
    <div className="app-shell">
      <Header spaces={spaces} tasks={tasks} onGlobalCreate={onGlobalCreate} onOpenTask={onOpenTask} />
      <Sidebar activeSection="" spaces={spaces} onNavigate={onNavigate} onCreateSpace={onCreateSpace} onOpenSpaceSettings={onOpenSpaceSettings} onDeleteSpace={onDeleteSpace} />
      <main className="main-content">
        <div className="ss-denied" role="alert">
          <span className="ss-denied-icon"><Icon name="lock" size={28} /></span>
          <h1>Access denied</h1>
          <p>{message}</p>
          <button type="button" className="ss-button is-primary" onClick={onBack}>{backLabel}</button>
        </div>
      </main>
    </div>
  );
}
