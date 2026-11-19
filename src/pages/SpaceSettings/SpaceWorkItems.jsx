import { useEffect, useState } from 'react';
import Icon from '../../components/common/Icon';
import WorkflowModal from '../../components/workflow/WorkflowModal';
import { StateChip } from '../../components/workflow/WorkflowDiagram';
import { api } from '../../services/api';
import { CHILD_TYPES_BY_PARENT, iconForType } from '../SpacesList/issueHelpers';
import './SpaceWorkItems.css';

// Hierarchy order: large containers first, then everyday work, then sub-tasks.
const ISSUE_TYPES = [
  { name: 'Epic', description: 'A large body of work, broken down into features, stories and tasks.' },
  { name: 'Feature', description: 'A product capability delivered as part of an epic.' },
  { name: 'Story', description: 'A requirement written from the user’s point of view.' },
  { name: 'Task', description: 'A piece of work that needs to be done.' },
  { name: 'Bug', description: 'A problem that stops the product from working as expected.' },
  { name: 'Improvement', description: 'An enhancement to something that already exists.' },
  { name: 'Sub-task', description: 'A smaller step inside another work item.' }
];

const typeClass = (type) => `type-${type.toLowerCase().replace(/[^a-z]+/g, '-')}`;

function TypeTag({ type }) {
  return (
    <span className={`swi-tag ${typeClass(type)}`}>
      <Icon name={iconForType(type)} size={11} /> {type}
    </span>
  );
}

/** Space settings → Work Items: issue types, the workflow each follows, and their children. */
export default function WorkItemsSettings({ space }) {
  const [workflows, setWorkflows] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null); // issue type whose workflow is shown

  useEffect(() => {
    let active = true;
    api.getSpaceWorkflows(space.id)
      .then((rows) => { if (active) setWorkflows(rows); })
      .catch((loadError) => { if (active) setError(loadError.message); });
    return () => { active = false; };
  }, [space.id]);

  const workflowOf = (type) => workflows?.find((workflow) => workflow.issueTypes.some((item) => item.toLowerCase() === type.toLowerCase()))
    || workflows?.find((workflow) => workflow.isDefault);

  return (
    <section className="settings-secondary-content">
      <div className="settings-content-heading">
        <h1>Work Items</h1>
        <p>Issue types that can be used in this space, the workflow each one follows and which types it can contain.</p>
      </div>
      <div className="settings-section-card swi-card">
        <div className="settings-section-card-header"><strong>Issue types</strong><span>{ISSUE_TYPES.length} types</span></div>
        {error && <div className="settings-empty-state">{error}</div>}
        <div className="swi-scroll">
          <table className="swi-table">
            <thead>
              <tr>
                <th>Issue type</th>
                <th>Workflow</th>
                <th className="swi-center">Initial status</th>
                <th>Can contain</th>
                <th className="swi-center">Work items</th>
              </tr>
            </thead>
            <tbody>
              {ISSUE_TYPES.map((type) => {
                const workflow = workflowOf(type.name);
                const initial = workflow?.states.find((state) => state.initial);
                const children = CHILD_TYPES_BY_PARENT[type.name] || [];
                const count = workflow?.issueTypeCounts?.[type.name] ?? 0;
                return (
                  <tr key={type.name}>
                    <td>
                      <div className="swi-type">
                        <span className={`swi-icon ${typeClass(type.name)}`} aria-hidden="true"><Icon name={iconForType(type.name)} size={16} /></span>
                        <span className="swi-type-text">
                          <strong>{type.name}</strong>
                          <small>{type.description}</small>
                        </span>
                      </div>
                    </td>
                    <td>
                      {workflow ? (
                        <button type="button" className="swi-workflow" onClick={() => setOpen(type.name)} title={`View ${workflow.name}`}>
                          <Icon name="workflow" size={13} /> {workflow.name}
                        </button>
                      ) : <span className="swi-muted">{workflows ? '—' : 'Loading…'}</span>}
                    </td>
                    <td className="swi-center">{initial ? <StateChip state={initial} /> : <span className="swi-muted">—</span>}</td>
                    <td>{children.length ? <div className="swi-tags">{children.map((child) => <TypeTag key={child} type={child} />)}</div> : <span className="swi-muted">No child items</span>}</td>
                    <td className="swi-center swi-count">{count}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="settings-note">Workflows are shared by every project. Open a workflow to see its states and transitions.</p>
      </div>
      {open && <WorkflowModal spaceId={space.id} issueType={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
