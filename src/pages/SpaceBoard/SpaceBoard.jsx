import { useMemo, useState } from 'react';
import Header from '../../components/layout/Header';
import Sidebar from '../../components/layout/Sidebar';
import Icon from '../../components/common/Icon';
import Toast from '../../components/common/Toast';
import TaskDetailDrawer from '../SpacesList/TaskDetailDrawer';
import { IssueModal } from '../SpacesList/SpacesList';
import IssueToolbar from '../SpacesList/IssueToolbar';
import ProjectHeader from '../SpacesList/ProjectHeader';
import useIssueFilters from '../SpacesList/useIssueFilters';
import { assigneeName, isInSpace, issueKey } from '../SpacesList/issueHelpers';
import { getIssueStatus } from '../SpacesList/workflows';
import BoardSettingsModal from './BoardSettingsModal';
import KanbanBoard from './KanbanBoard';
import { collectStatuses, findColumnForStatus, getBoardColumns, resolveTarget } from './boardConfig';
import './SpaceBoard.css';

export default function SpaceBoard({
  space = {},
  tasks = [],
  spaces = [],
  onNavigate = () => {},
  onCreateSpace = () => {},
  onOpenSpaceSettings = () => {},
  onDeleteSpace = () => {},
  onCreateTask = () => {},
  onUpdateTask = () => {},
  onDeleteTasks = () => {},
  onSaveBoard = async () => null,
  onGlobalCreate = () => {},
  onOpenTask = () => {}
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailIssueId, setDetailIssueId] = useState(null);
  const [createRequest, setCreateRequest] = useState(null); // { columnId, parentId, allowedIssueTypes }
  const [toast, setToast] = useState(null);

  const spaceName = space.name || space.code || 'Untitled Space';
  const columns = useMemo(() => getBoardColumns(space), [space]);
  const inSpace = useMemo(
    () => (Array.isArray(tasks) ? tasks : []).filter((task) => isInSpace(task, space)),
    [tasks, space]
  );

  const statusOptions = useMemo(() => collectStatuses(columns, inSpace), [columns, inSpace]);
  const filters = useIssueFilters(inSpace);
  const { filtered } = filters;

  const hiddenCount = useMemo(
    () => filtered.filter((issue) => !findColumnForStatus(columns, getIssueStatus(issue))).length,
    [filtered, columns]
  );

  async function handleCreate(payload) {
    const created = await onCreateTask(payload);
    if (!created) return false;
    const column = columns.find((item) => item.id === createRequest?.columnId);
    if (column) {
      const target = resolveTarget(created, column, inSpace);
      if (target.status && !(target.status === 'In Progress' && !assigneeName(created))) {
        onUpdateTask(created.id, { status: target.status });
      } else if (!target.same) {
        const landed = findColumnForStatus(columns, getIssueStatus(created));
        setToast({
          type: 'info',
          message: `${issueKey(created)} was created in ${getIssueStatus(created)}${landed ? ` (column "${landed.name}")` : ''}; its workflow does not allow starting in "${column.name}".`
        });
      }
    }
    return created;
  }

  async function saveBoard(nextColumns) {
    const saved = await onSaveBoard(nextColumns);
    if (saved) setToast({ type: 'success', message: 'Board settings saved.' });
    return Boolean(saved);
  }

  const detailIssue = detailIssueId === null ? null : inSpace.find((issue) => String(issue.id) === String(detailIssueId));

  return (
    <div className="app-shell spaces-list-shell">
      <Header spaces={spaces} tasks={tasks} onGlobalCreate={onGlobalCreate} onOpenTask={onOpenTask} />
      <Sidebar activeSection="Spaces" activeSpaceId={space.id} spaces={spaces} onCreateSpace={onCreateSpace} onNavigate={onNavigate} onOpenSpaceSettings={onOpenSpaceSettings} onDeleteSpace={onDeleteSpace} />

      <main className="spaces-list-main sb-main">
        <ProjectHeader space={space} title={`${space.code || spaceName} board`} activeTab="Board" onNavigate={onNavigate} />

        <IssueToolbar filters={filters} statusOptions={statusOptions} searchLabel="Search work items on the board">
          <button type="button" className="it-toolbar-button" onClick={() => setSettingsOpen(true)}>
            <Icon name="sliders" size={15} /> Board settings
          </button>
        </IssueToolbar>

        {hiddenCount > 0 && (
          <div className="sb-notice" role="status">
            <Icon name="info" size={15} />
            <span>
              {hiddenCount} work item{hiddenCount === 1 ? ' is' : 's are'} hidden because
              {hiddenCount === 1 ? ' its status is' : ' their statuses are'} not mapped to a column.
            </span>
            <button type="button" onClick={() => setSettingsOpen(true)}>Map statuses</button>
          </div>
        )}

        <KanbanBoard
          columns={columns}
          issues={filtered}
          allIssues={inSpace}
          members={space.members}
          ariaLabel={`${spaceName} board`}
          onUpdateTask={onUpdateTask}
          onOpenIssue={setDetailIssueId}
          onCreateInColumn={(column) => setCreateRequest({ columnId: column.id, parentId: '', allowedIssueTypes: null })}
          onToast={setToast}
        />
      </main>

      <Toast toast={toast} onClose={() => setToast(null)} />

      {settingsOpen && (
        <BoardSettingsModal
          columns={columns}
          issues={inSpace}
          onClose={() => setSettingsOpen(false)}
          onSave={saveBoard}
        />
      )}

      {detailIssue && (
        <TaskDetailDrawer
          issue={detailIssue}
          allIssues={inSpace}
          space={space}
          onClose={() => setDetailIssueId(null)}
          onUpdateTask={onUpdateTask}
          onDeleteTask={(issue) => { onDeleteTasks([issue.id]); setDetailIssueId(null); }}
          onCloneTask={(payload) => onCreateTask(payload)}
          onCreateChild={(parentIssue, allowedIssueTypes) => setCreateRequest({ columnId: null, parentId: String(parentIssue.id), allowedIssueTypes })}
          onOpenIssue={(issueId) => setDetailIssueId(issueId)}
        />
      )}

      {createRequest && (
        <IssueModal
          space={space}
          existingIssues={inSpace}
          initialParentId={createRequest.parentId}
          allowedIssueTypes={createRequest.allowedIssueTypes}
          onClose={() => setCreateRequest(null)}
          onCreate={handleCreate}
        />
      )}

    </div>
  );
}
