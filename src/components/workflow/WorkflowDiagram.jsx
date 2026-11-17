import { useMemo, useState } from 'react';
import { BaseEdge, Background, Controls, EdgeLabelRenderer, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, getSmoothStepPath } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import Icon from '../common/Icon';
import { useAppShell } from '../../context/appShellContext';
import { CATEGORY_LABEL } from './workflowMeta';
import './WorkflowDiagram.css';

const HIGHLIGHT = '#1d7afc';
const NODE_W = 150;
const NODE_H = 42;
const SIDES = [['t', Position.Top], ['r', Position.Right], ['b', Position.Bottom], ['l', Position.Left]];

/** A workflow state: coloured box with handles on every side (both directions). */
function StateNode({ data }) {
  return (
    <div className={`wf-node is-${data.color} ${data.current ? 'is-current' : ''} ${data.next ? 'is-next' : ''}`} title={`${data.name} · ${CATEGORY_LABEL[data.category] || data.category}${data.current ? ' · current status' : ''}`}>
      {SIDES.map(([id, position]) => (
        <span key={id}>
          <Handle type="target" id={`in-${id}`} position={position} isConnectable={false} />
          <Handle type="source" id={`out-${id}`} position={position} isConnectable={false} />
        </span>
      ))}
      <span className="wf-node-name">{data.name}</span>
      {data.count > 0 && <span className="wf-node-count" title={`${data.count} work item${data.count === 1 ? '' : 's'} of this project`}>{data.count}</span>}
      {data.any && <span className="wf-node-any">Any</span>}
      {data.current && <span className="wf-node-current">Current</span>}
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
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className="wf-edge-path" style={data?.highlight ? { stroke: HIGHLIGHT, strokeWidth: 2.4 } : undefined} />
      {label && (
        <EdgeLabelRenderer>
          <span className={`wf-edge-label nodrag nopan ${data?.highlight ? 'is-next' : ''}`} style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>{label}</span>
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

function buildGraph(workflow, currentStatus = null) {
  const current = currentStatus ? workflow.states.find((state) => state.name.toLowerCase() === String(currentStatus).toLowerCase()) : null;
  const nextIds = new Set(current ? workflow.transitions.filter((transition) => transition.from === current.id || !transition.from).map((transition) => transition.to) : []);
  const byId = new Map(workflow.states.map((state) => [state.id, state]));
  const anyTargets = new Set(workflow.transitions.filter((transition) => !transition.from).map((transition) => transition.to));
  const initial = workflow.states.find((state) => state.initial) || workflow.states[0];
  const nodes = workflow.states.map((state) => ({
    id: state.id,
    type: 'state',
    position: { x: state.x, y: state.y },
    data: { name: state.name, color: state.color, category: state.category, count: state.workItemCount || 0, any: anyTargets.has(state.id), current: current?.id === state.id, next: nextIds.has(state.id) && current?.id !== state.id },
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
    edges.push(edge(transition.id, from.id, to.id, transition.name, source, target, current?.id === from.id));
  }
  return { nodes, edges };
}

function edge(id, source, target, label, sourceSide, targetSide, highlight = false) {
  return {
    id,
    source,
    target,
    sourceHandle: `out-${sourceSide}`,
    targetHandle: `in-${targetSide}`,
    label,
    type: 'transition',
    data: { offset: 28, highlight },
    zIndex: highlight ? 2 : 0,
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, ...(highlight ? { color: HIGHLIGHT } : {}) }
  };
}

export function StateChip({ state }) {
  return <span className={`wf-chip is-${state.color}`}>{state.name}</span>;
}


/**
 * Interactive diagram of a workflow (pan, zoom, drag to inspect, reset).
 * `currentStatus` highlights that state and the transitions leaving it.
 */
export default function WorkflowDiagram({ workflow, currentStatus = null, height = 600 }) {
  const { theme } = useAppShell();
  const graph = useMemo(() => buildGraph(workflow, currentStatus), [workflow, currentStatus]);
  const [flowKey, setFlowKey] = useState(0); // remount to undo node dragging
  return (
    <div className="wf-canvas" style={{ height }} aria-label={`${workflow.name} diagram`}>
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

  );
}
