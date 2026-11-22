import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../common/Icon';
import { api } from '../../services/api';
import WorkflowDiagram, { StateChip } from './WorkflowDiagram';
import './WorkflowModal.css';

/** The workflow serving an issue type (the default workflow for unknown types). */
function workflowFor(workflows, issueType) {
  const type = String(issueType || 'Task').toLowerCase();
  return workflows.find((workflow) => workflow.issueTypes.some((item) => item.toLowerCase() === type))
    || workflows.find((workflow) => workflow.isDefault)
    || workflows[0];
}

/**
 * Popup with the workflow diagram of a work item's issue type, highlighting its current status
 * and the statuses it can move to next.
 */
export default function WorkflowModal({ spaceId, issueType, status, issueKey, onClose }) {
  const [workflows, setWorkflows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.getSpaceWorkflows(spaceId)
      .then((rows) => { if (active) setWorkflows(rows); })
      .catch((loadError) => { if (active) setError(loadError.message); });
    return () => { active = false; };
  }, [spaceId]);

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const workflow = workflows && workflowFor(workflows, issueType);
  const current = workflow?.states.find((state) => state.name.toLowerCase() === String(status || '').toLowerCase());
  const next = workflow && current
    ? workflow.transitions.filter((transition) => (transition.from === current.id || !transition.from) && transition.to !== current.id)
      .map((transition) => ({ transition, state: workflow.states.find((state) => state.id === transition.to) }))
    : [];

  return createPortal(
    <div className="wfm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="wfm-dialog" role="dialog" aria-modal="true" aria-label={workflow ? workflow.name : 'Workflow'}>
        <header className="wfm-head">
          <span className="wfm-icon" aria-hidden="true"><Icon name="workflow" size={16} /></span>
          <div className="wfm-title">
            <h2>{workflow ? workflow.name : 'Workflow'}</h2>
            <span>{issueKey ? `${issueType} · ${issueKey}` : `Workflow of ${issueType}`}</span>
          </div>
          <button type="button" className="wfm-close" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
        </header>
        {error && <div className="wfm-empty">{error}</div>}
        {!workflow && !error && <div className="wfm-empty">Loading workflow…</div>}
        {workflow && (
          <>
            {status && <div className="wfm-summary">
              <div>
                <span className="wfm-label">Current status</span>
                {current ? <StateChip state={current} /> : <span className="wfm-muted">{status || '—'}</span>}
              </div>
              <div className="wfm-next">
                <span className="wfm-label">Can move to</span>
                {next.length ? next.map(({ transition, state }) => (
                  <span key={transition.id} className="wfm-next-item" title={`Transition: ${transition.name}`}>
                    <StateChip state={state} /><small>{transition.name}</small>
                  </span>
                )) : <span className="wfm-muted">{current ? 'No further transitions (final status)' : 'This status is not part of the workflow'}</span>}
              </div>
            </div>}
            {!status && <p className="wfm-desc">{workflow.description} <span>Used by {workflow.issueTypes.join(', ')}.</span></p>}
            <WorkflowDiagram workflow={workflow} currentStatus={status} height="min(560px, calc(100vh - 220px))" />
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
