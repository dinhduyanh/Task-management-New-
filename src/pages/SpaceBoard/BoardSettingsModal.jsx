import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../components/common/Icon';
import {
  collectStatuses,
  countIssuesByStatus,
  createColumnId,
  getUnmappedStatuses,
  validateBoardColumns
} from './boardConfig';
import { statusTone } from '../SpacesList/issueHelpers';
import './BoardSettingsModal.css';

const UNMAPPED = '__unmapped__';
// Custom MIME types: dragover can read dataTransfer.types (not the data), so the
// drop target knows what is being dragged without relying on React state.
const STATUS_TYPE = 'application/x-taskflow-status';
const COLUMN_TYPE = 'application/x-taskflow-column';

function StatusMoveMenu({ status, columns, currentColumnId, onMove }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (!ref.current?.contains(event.target)) setOpen(false); };
    // Capture phase + preventDefault so Escape closes only this menu, not the modal.
    const onKey = (event) => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); } };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const targets = [
    ...(currentColumnId !== UNMAPPED ? [{ id: UNMAPPED, name: 'Unmapped statuses' }] : []),
    ...columns.filter((column) => column.id !== currentColumnId)
  ];

  return (
    <div className="bs-status-menu" ref={ref}>
      <button
        type="button"
        className="bs-icon-button"
        aria-label={`Move ${status} to another column`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="more" size={15} />
      </button>
      {open && (
        <div className="bs-menu" role="menu">
          <div className="bs-menu-title">Move to</div>
          {targets.map((target) => (
            <button
              key={target.id}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); onMove(status, target.id); }}
            >
              {target.name || 'Untitled'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusCard({ status, count, columns, columnId, onMove, onDragStart, onDragEnd, dragging }) {
  return (
    <div
      className={`bs-status-card ${dragging ? 'is-dragging' : ''}`}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(STATUS_TYPE, status);
        event.dataTransfer.setData('text/plain', status);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      <div>
        <span className={`bs-status-lozenge tone-${statusTone(status)}`}>{status}</span>
        <small>{count} work item{count === 1 ? '' : 's'}</small>
      </div>
      <StatusMoveMenu status={status} columns={columns} currentColumnId={columnId} onMove={onMove} />
    </div>
  );
}

export default function BoardSettingsModal({ columns: savedColumns, issues = [], onClose, onSave }) {
  const [columns, setColumns] = useState(() => savedColumns.map((column) => ({ ...column, statuses: [...column.statuses] })));
  const [drag, setDrag] = useState(null); // for styling only: { kind: 'status', status } | { kind: 'column', id }
  const [dropTarget, setDropTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Id of a just-added column whose name input should receive focus once rendered.
  const pendingFocusRef = useRef(null);

  const allStatuses = useMemo(() => collectStatuses(columns, issues), [columns, issues]);
  const unmapped = getUnmappedStatuses(columns, allStatuses);
  const countFor = useMemo(() => countIssuesByStatus(issues), [issues]);
  const dirty = JSON.stringify(columns) !== JSON.stringify(savedColumns);

  function requestClose() {
    if (dirty && !window.confirm('Discard your unsaved board changes?')) return;
    onClose();
  }

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && !event.defaultPrevented) requestClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  function moveStatus(status, targetColumnId, beforeStatus = null) {
    setError('');
    setColumns((current) => current.map((column) => {
      const statuses = column.statuses.filter((item) => item !== status);
      if (column.id !== targetColumnId) return { ...column, statuses };
      const index = beforeStatus ? statuses.indexOf(beforeStatus) : -1;
      if (index >= 0) statuses.splice(index, 0, status);
      else statuses.push(status);
      return { ...column, statuses };
    }));
  }

  function moveColumn(columnId, toIndex) {
    setColumns((current) => {
      const from = current.findIndex((column) => column.id === columnId);
      if (from < 0) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, moved);
      return next;
    });
  }

  function addColumn() {
    const id = createColumnId();
    setColumns((current) => [...current, { id, name: 'New column', statuses: [] }]);
    pendingFocusRef.current = id;
    setError('');
  }

  function deleteColumn(columnId) {
    setColumns((current) => current.filter((column) => column.id !== columnId));
    setError('');
  }

  function renameColumn(columnId, name) {
    setColumns((current) => current.map((column) => column.id === columnId ? { ...column, name } : column));
    setError('');
  }

  function handleDrop(event, targetColumnId, beforeStatus = null) {
    event.preventDefault();
    event.stopPropagation();
    const status = event.dataTransfer.getData(STATUS_TYPE);
    const draggedColumnId = event.dataTransfer.getData(COLUMN_TYPE);
    setDropTarget(null);
    setDrag(null);
    if (status) {
      moveStatus(status, targetColumnId, targetColumnId === UNMAPPED ? null : beforeStatus);
    } else if (draggedColumnId && targetColumnId !== UNMAPPED) {
      moveColumn(draggedColumnId, columns.findIndex((column) => column.id === targetColumnId));
    }
  }

  function allowDrop(event, targetId) {
    const types = Array.from(event.dataTransfer.types || []);
    const isStatus = types.includes(STATUS_TYPE);
    const isColumn = types.includes(COLUMN_TYPE);
    if (!isStatus && !(isColumn && targetId !== UNMAPPED)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (dropTarget !== targetId) setDropTarget(targetId);
  }

  async function save() {
    const trimmed = columns.map((column) => ({ ...column, name: column.name.trim() }));
    const message = validateBoardColumns(trimmed);
    if (message) {
      setError(message);
      return;
    }
    setSaving(true);
    setError('');
    const ok = await onSave(trimmed);
    setSaving(false);
    if (ok) onClose();
    else setError('The board settings could not be saved. Please try again.');
  }

  function renderStatusList(statuses, columnId) {
    return statuses.map((status) => (
      <div
        key={status}
        onDragOver={(event) => allowDrop(event, columnId)}
        onDrop={(event) => handleDrop(event, columnId, status)}
      >
        <StatusCard
          status={status}
          count={countFor(status)}
          columns={columns}
          columnId={columnId}
          onMove={moveStatus}
          dragging={drag?.kind === 'status' && drag.status === status}
          onDragStart={() => setDrag({ kind: 'status', status })}
          onDragEnd={() => { setDrag(null); setDropTarget(null); }}
        />
      </div>
    ));
  }

  return (
    <div className="bs-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <div className="bs-modal" role="dialog" aria-modal="true" aria-labelledby="bs-title">
        <header className="bs-head">
          <div>
            <h2 id="bs-title">Columns and statuses</h2>
            <p>Use columns and statuses to define how work progresses on your board. Drag statuses between columns, or use the <Icon name="more" size={13} /> menu.</p>
          </div>
          <button type="button" className="bs-icon-button bs-close" onClick={requestClose} aria-label="Close board settings">
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="bs-body">
          <section
            className={`bs-unmapped ${dropTarget === UNMAPPED ? 'is-drop-target' : ''}`}
            aria-label="Unmapped statuses"
            onDragOver={(event) => allowDrop(event, UNMAPPED)}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropTarget(null); }}
            onDrop={(event) => handleDrop(event, UNMAPPED)}
          >
            <h3>Unmapped statuses</h3>
            <p>Work items with these statuses won&apos;t be visible on the board.</p>
            <div className="bs-status-list">
              {unmapped.length ? renderStatusList(unmapped, UNMAPPED) : <div className="bs-empty">All statuses are mapped.</div>}
            </div>
          </section>

          {columns.map((column, index) => (
            <section
              key={column.id}
              className={`bs-column ${dropTarget === column.id ? 'is-drop-target' : ''} ${drag?.kind === 'column' && drag.id === column.id ? 'is-dragging' : ''}`}
              aria-label={`Column ${column.name || 'Untitled'}`}
              onDragOver={(event) => allowDrop(event, column.id)}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropTarget(null); }}
              onDrop={(event) => handleDrop(event, column.id)}
            >
              <div className="bs-column-head">
                <button
                  type="button"
                  className="bs-icon-button bs-grip"
                  draggable
                  aria-label={`Reorder column ${column.name || 'Untitled'}. Drag, or use the left and right arrow keys.`}
                  title="Drag to reorder"
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData(COLUMN_TYPE, column.id);
                    event.dataTransfer.setData('text/plain', column.name);
                    setDrag({ kind: 'column', id: column.id });
                  }}
                  onDragEnd={() => { setDrag(null); setDropTarget(null); }}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowLeft') { event.preventDefault(); moveColumn(column.id, index - 1); }
                    if (event.key === 'ArrowRight') { event.preventDefault(); moveColumn(column.id, index + 1); }
                  }}
                >
                  <Icon name="grip" size={16} />
                </button>
                <input
                  ref={(node) => {
                    if (node && pendingFocusRef.current === column.id) {
                      pendingFocusRef.current = null;
                      node.focus();
                      node.select();
                    }
                  }}
                  value={column.name}
                  maxLength={40}
                  onChange={(event) => renameColumn(column.id, event.target.value)}
                  aria-label="Column name"
                  aria-invalid={!column.name.trim() || undefined}
                />
                <button
                  type="button"
                  className="bs-icon-button bs-delete"
                  onClick={() => deleteColumn(column.id)}
                  aria-label={`Delete column ${column.name || 'Untitled'}`}
                  title="Delete column (its statuses become unmapped)"
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
              <div className="bs-status-list">
                {column.statuses.length
                  ? renderStatusList(column.statuses, column.id)
                  : <div className="bs-empty">Drop statuses here</div>}
              </div>
            </section>
          ))}

          <button type="button" className="bs-add-column" onClick={addColumn} aria-label="Add column" title="Add column">
            <Icon name="plus" size={18} />
          </button>
        </div>

        <footer className="bs-foot">
          <span className="bs-error" role={error ? 'alert' : undefined}>{error}</span>
          <button type="button" className="bs-btn secondary" onClick={requestClose}>Cancel</button>
          <button type="button" className="bs-btn primary" onClick={save} disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  );
}
