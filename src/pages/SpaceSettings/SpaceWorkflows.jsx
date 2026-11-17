import { useEffect, useMemo, useState } from 'react';
import { BaseEdge, Background, Controls, EdgeLabelRenderer, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, getSmoothStepPath } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import Icon from '../../components/common/Icon';
import { useAppShell } from '../../context/appShellContext';
import { api } from '../../services/api';
import './SpaceWorkflows.css';

const NODE_W = 150;
const NODE_H = 42;
const SIDES = [['t', Position.Top], ['r', Position.Right], ['b', Position.Bottom], ['l', Position.Left]];
const CATEGORY_LABEL = { todo: 'To do', progress: 'In progress', done: 'Done', closed: 'Closed' };

/** A workflow state: coloured box with handles on every side (both directions). */
function StateNode({ data }) {
  return (
    <div className={`wf-node is-${data.color}`} title={`${data.name} · ${CATEGORY_LABEL[data.category] || data.category}`}>
      {SIDES.map(([id, position]) => (
        <span key={id}>
          <Handle type="target" id={`in-${id}`} position={position} isConnectable={false} />
          <Handle type="source" id={`out-${id}`} position={position} isConnectable={false} />
        </span>
      ))}
      <span className="wf-node-name">{data.name}</span>
      {data.count > 0 && <span className="wf-node-count" title={`${data.count} work item${data.count === 1 ? '' : 's'} of this project`}>{data.count}</span>}
      {data.any && <span className="wf-node-any">Any</span>}
    </div>
  );
}

function StartNode() {
  return (
    <div className="wf-start" title="Start: new work items begin here">
      <Handle type="source" id="out-b" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}

const nodeTypes = { state: StateNode, start: StartNode };

/** Elbow arrow whose label is HTML above every arrow, so crossing lines never cover a label. */
function TransitionEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, label, markerEnd, data }) {
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 10, offset: data?.offset ?? 28 });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className="wf-edge-path" />
      {label && (
        <EdgeLabelRenderer>
          <span className="wf-edge-label nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>{label}</span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const edgeTypes = { transition: TransitionEdge };

/** Picks the sides an arrow leaves/enters so the diagram reads top-down with few crossings. */
function edgeSides(from, to, hasReverse) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) < 40) return dy >= 0 ? ['b', 't'] : ['l', 'l']; // same column: down, or loop back on the left
  if (hasReverse && dy < 0) return ['t', dx < 0 ? 'r' : 'l']; // second arrow of a pair: leave from the top
  return dx > 0 ? ['r', 'l'] : ['l', 'r'];
}

function buildGraph(workflow) {
  const byId = new Map(workflow.states.map((state) => [state.id, state]));
  const anyTargets = new Set(workflow.transitions.filter((transition) => !transition.from).map((transition) => transition.to));
  const initial = workflow.states.find((state) => state.initial) || workflow.states[0];
  const nodes = workflow.states.map((state) => ({
    id: state.id,
    type: 'state',
    position: { x: state.x, y: state.y },
    data: { name: state.name, color: state.color, category: state.category, count: state.workItemCount || 0, any: anyTargets.has(state.id) },
    style: { width: NODE_W, height: NODE_H }
  }));
  const edges = [];
  if (initial) {
    nodes.push({ id: '__start', type: 'start', position: { x: initial.x + NODE_W / 2 - 11, y: initial.y - 110 }, data: {}, selectable: false });
    edges.push(edge('__start-edge', '__start', initial.id, 'Start', 'b', 't'));
  }
  for (const transition of workflow.transitions) {
    if (!transition.from) continue; // "Any" transitions are shown as a badge on the target state
    const from = byId.get(transition.from);
    const to = byId.get(transition.to);
    if (!from || !to) continue;
    const hasReverse = workflow.transitions.some((other) => other.from === transition.to && other.to === transition.from);
    const [source, target] = edgeSides(from, to, hasReverse);
    edges.push(edge(transition.id, from.id, to.id, transition.name, source, target));
  }
  return { nodes, edges };
}

function edge(id, source, target, label, sourceSide, targetSide) {
  return {
    id,
    source,
    target,
    sourceHandle: `out-${sourceSide}`,
    targetHandle: `in-${targetSide}`,
    label,
    type: 'transition',
    data: { offset: 28 },
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 }
  };
}

function StateChip({ state }) {
  return <span className={`wf-chip is-${state.color}`}>{state.name}</span>;
}

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
  const { theme } = useAppShell();
  const graph = useMemo(() => buildGraph(workflow), [workflow]);
  const [flowKey, setFlowKey] = useState(0); // remount to undo node dragging
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
        <div className="wf-canvas" aria-label={`${workflow.name} diagram`}>
          <ReactFlowProvider>
            <ReactFlow
              key={flowKey}
              defaultNodes={graph.nodes}
              defaultEdges={graph.edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              colorMode={theme === 'dark' ? 'dark' : 'light'}
              fitView
              fitViewOptions={{ padding: 0.18 }}
              minZoom={0.3}
              maxZoom={1.8}
              nodesConnectable={false}
              edgesFocusable={false}
              elementsSelectable={false}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={18} size={1} />
              <Controls showInteractive={false} position="bottom-left" />
            </ReactFlow>
          </ReactFlowProvider>
          <button type="button" className="wf-reset" onClick={() => setFlowKey((value) => value + 1)} title="Put the states back in place"><Icon name="refresh" size={13} /> Reset layout</button>
          <div className="wf-legend" aria-label="Legend">
            <span><i className="wf-start-dot" /> Start</span>
            <span><i className="wf-arrow" /> Transition</span>
            <span>Drag to pan · scroll to zoom</span>
          </div>
        </div>

        <aside className="wf-side">
          <h2>Transitions</h2>
          <ol className="wf-transitions">
            {workflow.transitions.map((transition) => (
              <li key={transition.id}>
                <span className="wf-transition-name">{transition.name}</span>
                <span className="wf-transition-path">
                  {transition.from ? <StateChip state={names[transition.from]} /> : <span className="wf-chip is-any">Any</span>}
                  <Icon name="chevronsRight" size={12} />
                  <StateChip state={names[transition.to]} />
                </span>
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
