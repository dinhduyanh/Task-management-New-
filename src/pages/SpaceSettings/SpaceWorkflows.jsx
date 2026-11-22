import { useEffect, useState } from 'react';
import Icon from '../../components/common/Icon';
import WorkflowDiagram, { StateChip } from '../../components/workflow/WorkflowDiagram';
import { CATEGORY_LABEL } from '../../components/workflow/workflowMeta';
import { api } from '../../services/api';
import './SpaceWorkflows.css';

/** Row in the workflow list (clicking it opens the diagram). */
function WorkflowRow({ workflow, onOpen }) {
  const rank = { todo: 0, progress: 1, done: 2, closed: 3 };
  const ordered = [...workflow.states].sort((a, b) => ((rank[a.category] ?? 9) - (rank[b.category] ?? 9)) || (a.y - b.y) || (a.x - b.x));
  const count = workflow.workItemCount || 0;
  return (
    <tr className="wf-row" tabIndex={0} onClick={() => onOpen(workflow.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(workflow.id); } }} aria-label={`Open ${workflow.name}`}>
      <td>
        <div className="wf-row-name">
          <span className="wf-row-icon" aria-hidden="true"><Icon name="workflow" size={15} /></span>
          <span className="wf-row-text">
            <strong>{workflow.name}{workflow.isDefault && <span className="wf-badge">Default</span>}</strong>
            <small title={workflow.description}>{workflow.description}</small>
          </span>
        </div>
      </td>
      <td className="wf-row-types">{workflow.issueTypes.join(', ')}</td>
      <td><div className="wf-row-states">{ordered.map((state) => <StateChip key={state.id} state={state} />)}</div></td>
      <td className="wf-num">{workflow.transitions.length}</td>
      <td className="wf-num">{count}</td>
      <td className="wf-go"><Icon name="chevronsRight" size={15} /></td>
    </tr>
  );
}

/** Diagram + transition list of one workflow. */
function WorkflowDetail({ workflow, onBack }) {
  const [selected, setSelected] = useState(null); // transition shown in the diagram's details panel
  const names = Object.fromEntries(workflow.states.map((state) => [state.id, state]));

  return (
    <section className="settings-secondary-content wf-detail">
      <button type="button" className="wf-back" onClick={onBack}><Icon name="arrowLeft" size={15} /> All workflows</button>
      <div className="wf-detail-head">
        <div>
          <h1>{workflow.name} {workflow.isDefault && <span className="wf-badge">Default</span>}</h1>
          <p>{workflow.description}</p>
          <div className="wf-detail-meta">
            <span><strong>Issue types:</strong> {workflow.issueTypes.join(', ')}</span>
            <span><strong>{workflow.states.length}</strong> states</span>
            <span><strong>{workflow.transitions.length}</strong> transitions</span>
            {workflow.completionRequiresChildren && <span className="wf-rule"><Icon name="info" size={13} /> Done only when every child work item is Done</span>}
          </div>
        </div>
      </div>

      <div className="wf-layout">
        <WorkflowDiagram workflow={workflow} selectedTransitionId={selected} onSelectTransition={setSelected} />

        <aside className="wf-side">
          <h2>Transitions</h2>
          <ol className="wf-transitions">
            {workflow.transitions.map((transition) => (
              <li key={transition.id}>
                <button type="button" className={`wf-transition ${selected === transition.id ? 'is-selected' : ''}`} onClick={() => setSelected(selected === transition.id ? null : transition.id)} aria-pressed={selected === transition.id}>
                  <span className="wf-transition-name">{transition.name}</span>
                  <span className="wf-transition-path">
                    {transition.from ? <StateChip state={names[transition.from]} /> : <span className="wf-chip is-any">Any</span>}
                    <Icon name="chevronsRight" size={12} />
                    <StateChip state={names[transition.to]} />
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <h2>States</h2>
          <ul className="wf-states">
            {workflow.states.map((state) => (
              <li key={state.id}>
                <StateChip state={state} />
                <small>{CATEGORY_LABEL[state.category] || state.category}{state.initial ? ' · initial' : ''}</small>
                <span className="wf-state-count">{state.workItemCount || 0}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
}

/** Space settings → Workflow: list of workflows; clicking one opens its diagram. */
export default function WorkflowSettings({ space }) {
  const [workflows, setWorkflows] = useState(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    let active = true;
    api.getSpaceWorkflows(space.id)
      .then((rows) => { if (active) { setWorkflows(rows); setError(''); } })
      .catch((loadError) => { if (active) setError(loadError.message); });
    return () => { active = false; };
  }, [space.id]);

  const open = workflows?.find((workflow) => workflow.id === openId);
  if (open) return <WorkflowDetail workflow={open} onBack={() => setOpenId(null)} />;

  return (
    <section className="settings-secondary-content">
      <div className="settings-content-heading">
        <h1>Workflow</h1>
        <p>Each issue type follows a workflow: the states a work item moves through and the transitions allowed between them. Open a workflow to see its diagram.</p>
      </div>
      {error && <div className="settings-section-card"><div className="settings-empty-state">{error}</div></div>}
      {!workflows && !error && <div className="settings-section-card"><div className="settings-empty-state">Loading workflows…</div></div>}
      {workflows && (
        <div className="settings-section-card wf-list">
          <div className="wf-list-scroll">
            <table className="wf-table">
              <thead>
                <tr>
                  <th>Workflow</th>
                  <th>Issue types</th>
                  <th>States</th>
                  <th className="wf-num">Transitions</th>
                  <th className="wf-num">Work items</th>
                  <th aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {workflows.map((workflow) => <WorkflowRow key={workflow.id} workflow={workflow} onOpen={setOpenId} />)}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
