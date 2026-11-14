import Icon from '../../components/common/Icon';
import { PROJECT_TABS, navigateProjectTab } from './projectNavigation';

/** Breadcrumb, page title and the project tab bar shared by List, Board and Timeline. */
export default function ProjectHeader({ space = {}, title, activeTab, onNavigate = () => {} }) {
  const spaceName = space.name || space.code || 'Untitled Space';
  return (
    <>
      <div className="slv-project-heading">
        <div className="slv-breadcrumb"><span>Projects</span><span>/</span><strong>{spaceName}</strong></div>
        <h1>{title || spaceName}</h1>
      </div>
      <nav className="slv-tabs" aria-label="Project navigation">
        {PROJECT_TABS.map(([label, icon]) => (
          <button
            key={label}
            type="button"
            className={`slv-tab ${label === activeTab ? 'active' : ''}`}
            aria-current={label === activeTab ? 'page' : undefined}
            onClick={() => { if (label !== activeTab) navigateProjectTab(onNavigate, space, label); }}
          >
            <Icon name={icon} size={15} /><span>{label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
