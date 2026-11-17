import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { BaseEdge, Background, Controls, EdgeLabelRenderer, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, getSmoothStepPath, useReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import Icon from '../common/Icon';
import { useAppShell } from '../../context/appShellContext';
import { CATEGORY_LABEL } from './workflowMeta';
import './WorkflowDiagram.css';

const HIGHLIGHT = '#1d7afc';
const SELECTED = '#e56910';
const START_EDGE = '__start-edge';

/** Which transition is selected, shared with the edges. */
const SelectionContext = createContext({ selectedId: null, select: () => {} });
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
  const { selectedId, select } = useContext(SelectionContext);
  const selected = selectedId === id;
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 10, offset: data?.offset ?? 28 });
  const style = selected ? { stroke: SELECTED, strokeWidth: 3 } : data?.highlight ? { stroke: HIGHLIGHT, strokeWidth: 2.4 } : undefined;
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className="wf-edge-path" style={style} interactionWidth={18} />
      {label && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className={`wf-edge-label nodrag nopan ${data?.highlight ? 'is-next' : ''} ${selected ? 'is-selected' : ''}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            onClick={(event) => { event.stopPropagation(); select(selected ? null : id); }}
            aria-pressed={selected}
            title="Show transition details"
          >
            {label}
          </button>
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
    edges.push(edge(START_EDGE, '__start', initial.id, 'Start', 'b', 't'));
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


function statePill(state) {
  return state ? <StateChip state={state} /> : <span className="wf-chip is-any">Any status</span>;
}

/** Details of the selected transition, shown over the diagram. */
function TransitionPanel({ workflow, transitionId, currentStatus, onClose }) {
  const byId = Object.fromEntries(workflow.states.map((state) => [state.id, state]));
  const initial = workflow.states.find((state) => state.initial) || workflow.states[0];
  if (transitionId === START_EDGE) {
    return (
      <div className="wf-panel" role="dialog" aria-label="Start">
        <div className="wf-panel-head"><strong>Start</strong><button type="button" onClick={onClose} aria-label="Close details"><Icon name="close" size={13} /></button></div>
        <p className="wf-panel-text">New {workflow.issueTypes.join(' / ')} work items are created in {statePill(initial)}.</p>
      </div>
    );
  }
  const transition = workflow.transitions.find((item) => item.id === transitionId);
  if (!transition) return null;
  const from = transition.from ? byId[transition.from] : null;
  const to = byId[transition.to];
  const current = currentStatus ? workflow.states.find((state) => state.name.toLowerCase() === String(currentStatus).toLowerCase()) : null;
  const availableNow = current && (transition.from === current.id || (!transition.from && current.id !== transition.to));
  const reverse = workflow.transitions.find((item) => item.from === transition.to && item.to === transition.from);
  const otherWaysIn = workflow.transitions.filter((item) => item.to === transition.to && item.id !== transition.id);
  const conditions = ['Needs the "Move task" permission in the project.'];
  if (to?.name === 'In Progress') conditions.push('The work item must have an Assignee.');
  if (to?.category === 'done' && workflow.completionRequiresChildren) conditions.push('Every child work item must be Done.');

  return (
    <div className="wf-panel" role="dialog" aria-label={`Transition ${transition.name}`}>
      <div className="wf-panel-head">
        <span className="wf-panel-kind">Transition</span>
        <strong>{transition.name}</strong>
        <button type="button" onClick={onClose} aria-label="Close details"><Icon name="close" size={13} /></button>
      </div>
      <dl className="wf-panel-grid">
        <dt>From</dt><dd>{statePill(from)}</dd>
        <dt>To</dt><dd>{statePill(to)}</dd>
        <dt>Stage</dt><dd>{from ? (CATEGORY_LABEL[from.category] || from.category) : 'Any'} → {CATEGORY_LABEL[to?.category] || to?.category}</dd>
        {from && typeof from.workItemCount === 'number' && <><dt>Work items</dt><dd>{from.workItemCount} in {from.name} can use it</dd></>}
      </dl>
      {current && (
        <p className={`wf-panel-status ${availableNow ? 'is-ok' : ''}`}>
          <Icon name={availableNow ? 'check' : 'info'} size={13} />
          {availableNow ? `Available now: this work item is in ${current.name}.` : `Not available now: this work item is in ${current.name}.`}
        </p>
      )}
      <div className="wf-panel-section">
        <span>Conditions</span>
        <ul>{conditions.map((text) => <li key={text}>{text}</li>)}</ul>
      </div>
      <div className="wf-panel-section">
        <span>Way back</span>
        <p className="wf-panel-text">{reverse ? <>{reverse.name}: {statePill(to)} → {statePill(from)}</> : 'No direct transition back.'}</p>
      </div>
      {otherWaysIn.length > 0 && (
        <div className="wf-panel-section">
          <span>Other ways into {to?.name}</span>
          <p className="wf-panel-text">{otherWaysIn.map((item) => `${item.name} (from ${item.from ? byId[item.from]?.name : 'any'})`).join(', ')}</p>
        </div>
      )}
    </div>
  );
}

/** Re-fits the diagram whenever its frame changes size, until the user pans or zooms. */
function AutoFit({ containerRef, userMovedRef }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    let last = '';
    const observer = new ResizeObserver(() => {
      const size = `${element.clientWidth}x${element.clientHeight}`;
      if (size === last) return;
      last = size;
      if (!userMovedRef.current) fitView({ padding: 0.18 });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef, fitView, userMovedRef]);
  return null;
}

/**
 * Interactive diagram of a workflow (pan, zoom, drag to inspect, reset).
 * `currentStatus` highlights that state and the transitions leaving it.
 */
export default function WorkflowDiagram({ workflow, currentStatus = null, height = 600, selectedTransitionId, onSelectTransition }) {
  const { theme } = useAppShell();
  const graph = useMemo(() => buildGraph(workflow, currentStatus), [workflow, currentStatus]);
  const [flowKey, setFlowKey] = useState(0); // remount to undo node dragging
  const [ownSelection, setOwnSelection] = useState(null);
  const controlled = selectedTransitionId !== undefined;
  const selectedId = controlled ? selectedTransitionId : ownSelection;
  const select = (id) => (onSelectTransition ? onSelectTransition(id) : setOwnSelection(id));
  const containerRef = useRef(null);
  const userMovedRef = useRef(false);
  const moveStartRef = useRef(null);
  return (
    <div className="wf-canvas" ref={containerRef} style={{ height }} aria-label={`${workflow.name} diagram`}>
      <SelectionContext.Provider value={{ selectedId, select }}>
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
              onEdgeClick={(_event, clicked) => select(clicked.id === selectedId ? null : clicked.id)}
              onPaneClick={() => select(null)}
              onMoveStart={(_event, viewport) => { moveStartRef.current = viewport; }}
              onMoveEnd={(event, viewport) => {
                // A plain click also starts a "move": only a real pan or zoom stops the auto-fit.
                const start = moveStartRef.current;
                if (event && start && (Math.abs(start.x - viewport.x) > 1 || Math.abs(start.y - viewport.y) > 1 || Math.abs(start.zoom - viewport.zoom) > 0.001)) userMovedRef.current = true;
              }}
            >
              <AutoFit containerRef={containerRef} userMovedRef={userMovedRef} />
              <Background gap={18} size={1} />
              <Controls
                showInteractive={false}
                position="bottom-left"
                onZoomIn={() => { userMovedRef.current = true; }}
                onZoomOut={() => { userMovedRef.current = true; }}
                onFitView={() => { userMovedRef.current = false; }}
              />
            </ReactFlow>
          </ReactFlowProvider>
          {selectedId && <TransitionPanel workflow={workflow} transitionId={selectedId} currentStatus={currentStatus} onClose={() => select(null)} />}
      </SelectionContext.Provider>
          <button type="button" className="wf-reset" onClick={() => { userMovedRef.current = false; setFlowKey((value) => value + 1); }} title="Put the states back in place"><Icon name="refresh" size={13} /> Reset layout</button>
          <div className="wf-legend" aria-label="Legend">
            <span><i className="wf-start-dot" /> Start</span>
            <span><i className="wf-arrow" /> Transition</span>
            <span>Click an arrow for details · drag to pan · scroll to zoom</span>
          </div>
        </div>

  );
}
