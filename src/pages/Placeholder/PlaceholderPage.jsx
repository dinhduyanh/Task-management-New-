import Header from '../../components/layout/Header';
import Sidebar from '../../components/layout/Sidebar';
import Icon from '../../components/common/Icon';
import './PlaceholderPage.css';

export default function PlaceholderPage({
  title,
  activeSection,
  activeSpaceId = null,
  spaces = [],
  tasks = [],
  onGlobalCreate = () => {},
  onOpenTask = () => {},
  onNavigate = () => {},
  onCreateSpace = () => {},
  onBack = () => {}
}) {
  return (
    <div className="app-shell">
      <Header spaces={spaces} tasks={tasks} onGlobalCreate={onGlobalCreate} onOpenTask={onOpenTask} />
      <Sidebar
        activeSection={activeSection}
        activeSpaceId={activeSpaceId}
        spaces={spaces}
        onNavigate={onNavigate}
        onCreateSpace={onCreateSpace}
      />

      <main className="main-content">
        <div className="page-heading">
          <div>
            <div className="breadcrumb">My Workspace <span>/</span> {title}</div>
            <h1>{title}</h1>
          </div>
          <button type="button" className="placeholder-back-button" onClick={onBack}>
            <Icon name="arrowLeft" size={16} />
            Back
          </button>
        </div>

        <section className="placeholder-feature-card">
          <Icon name="file" size={30} />
          <h2>{title}</h2>
          <p>This section has not been implemented yet.</p>
          <span>You can continue using the available TASKFLOW sections from the sidebar.</span>
        </section>
      </main>

    </div>
  );
}
