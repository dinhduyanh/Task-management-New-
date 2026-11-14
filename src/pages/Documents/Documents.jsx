import { useEffect, useMemo, useState } from 'react';
import Header from '../../components/layout/Header';
import Sidebar from '../../components/layout/Sidebar';
import Icon from '../../components/common/Icon';
import Toast from '../../components/common/Toast';
import Pagination from '../../components/common/Pagination';
import UserAvatar from '../../components/common/UserAvatar';
import { useAppShell } from '../../context/appShellContext';
import { api } from '../../services/api';
import { FILE_CATEGORIES, PREVIEWABLE_EXTENSIONS, fileCategory, formatBytes } from '../../services/fileTypes';
import { MultiFilter } from '../SpacesList/IssueFilters';
import { iconForType } from '../SpacesList/issueHelpers';
import MenuButton from '../SpaceBacklog/MenuButton';
import { ConfirmModal } from '../SpaceBacklog/SprintModals';
import FilePreviewModal from './FilePreviewModal';
import './Documents.css';

const VIEW_KEY = 'taskflow.documents.view';
const DATE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: 'year', label: 'This year' },
  { value: 'custom', label: 'Custom range' }
];
const CATEGORY_ICONS = { image: 'image', pdf: 'file', document: 'file', spreadsheet: 'dashboard', presentation: 'dashboard', archive: 'inbox', other: 'file' };

const CATEGORY_BY_LABEL = Object.fromEntries(Object.entries(FILE_CATEGORIES).map(([key, value]) => [value.label, key]));

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (number) => String(number).padStart(2, '0');
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Whether a file's upload time falls in the chosen "Date Added" range. */
function inDateRange(value, range, custom) {
  if (range === 'all') return true;
  const date = new Date(value);
  const today = startOfDay(new Date());
  if (range === 'today') return date >= today;
  if (range === '7' || range === '30') return date >= new Date(today.getFullYear(), today.getMonth(), today.getDate() - Number(range) + 1);
  if (range === 'year') return date.getFullYear() === today.getFullYear();
  if (range === 'custom') {
    if (custom.from && date < new Date(`${custom.from}T00:00:00`)) return false;
    if (custom.to && date > new Date(`${custom.to}T23:59:59.999`)) return false;
    return true;
  }
  return true;
}

function SortButton({ field, sort, onToggle, children }) {
  const active = sort.field === field;
  return (
    <button type="button" className={`dc-sort ${active ? 'is-active' : ''}`} onClick={() => onToggle(field)}>
      {children}
      <span aria-hidden="true">{active ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}</span>
      <span className="dc-visually-hidden">{active ? `sorted ${sort.direction === 'asc' ? 'ascending' : 'descending'}` : 'sort'}</span>
    </button>
  );
}

function readView() {
  try { return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'; } catch { return 'list'; }
}

function FileIcon({ file, size = 18 }) {
  const category = fileCategory(file.extension);
  return (
    <span className={`dc-file-icon cat-${category}`} aria-hidden="true">
      <Icon name={CATEGORY_ICONS[category]} size={size} />
    </span>
  );
}

function Owner({ file }) {
  const name = file.uploadedBy?.name;
  if (!name) return <span className="dc-muted">Unknown</span>;
  return <span className="dc-owner"><UserAvatar user={{ fullName: name }} size={22} /><span>{name}</span></span>;
}

export default function Documents({
  tasks = [],
  spaces = [],
  onNavigate = () => {},
  onCreateSpace = () => {},
  onOpenSpaceSettings = () => {},
  onDeleteSpace = () => {},
  onGlobalCreate = () => {},
  onOpenTask = () => {}
}) {
  const { replaceWorkItem } = useAppShell();
  const [files, setFiles] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [view, setViewState] = useState(readView);
  const [search, setSearch] = useState('');
  const [categories, setCategories] = useState([]);
  const [projects, setProjects] = useState([]);
  const [owners, setOwners] = useState([]);
  const [dateRange, setDateRange] = useState('all');
  const [customRange, setCustomRange] = useState({ from: '', to: '' });
  const [sort, setSort] = useState({ field: 'createdAt', direction: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => (readView() === 'grid' ? 12 : 10));
  const [previewId, setPreviewId] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    let active = true;
    api.getAttachments()
      .then((rows) => { if (active) { setFiles(rows); setLoadError(''); } })
      .catch((error) => { if (active) setLoadError(error.message || 'Unable to load files.'); });
    return () => { active = false; };
  }, [reloadKey]);

  function setView(value) {
    setViewState(value);
    // Grid tiles come in rows, so it uses multiples of 4 per page.
    setPageSize(value === 'grid' ? 12 : 10);
    setPage(1);
    try { localStorage.setItem(VIEW_KEY, value); } catch { /* per-viewer preference only */ }
  }

  const list = useMemo(() => files || [], [files]);
  const options = useMemo(() => ({
    projects: [...new Set(list.map((file) => file.space?.name).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    owners: [...new Set(list.map((file) => file.uploadedBy?.name || 'Unknown'))].sort((a, b) => a.localeCompare(b))
  }), [list]);

  const filtered = useMemo(() => {
    const text = search.trim().toLowerCase();
    const wanted = new Set(categories.map((label) => CATEGORY_BY_LABEL[label]));
    const rows = list.filter((file) => {
      if (text && ![file.name, file.workItem?.key, file.workItem?.title].some((value) => String(value || '').toLowerCase().includes(text))) return false;
      if (wanted.size && !wanted.has(fileCategory(file.extension))) return false;
      if (projects.length && !projects.includes(file.space?.name)) return false;
      if (owners.length && !owners.includes(file.uploadedBy?.name || 'Unknown')) return false;
      return inDateRange(file.createdAt, dateRange, customRange);
    });
    const direction = sort.direction === 'asc' ? 1 : -1;
    return rows.sort((a, b) => {
      if (sort.field === 'name') return a.name.localeCompare(b.name) * direction;
      if (sort.field === 'size') return (a.size - b.size) * direction;
      return (new Date(a.createdAt) - new Date(b.createdAt)) * direction;
    });
  }, [list, search, categories, projects, owners, dateRange, customRange, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const previewable = filtered.filter((file) => PREVIEWABLE_EXTENSIONS.has(file.extension));
  const previewFile = previewId ? list.find((file) => file.id === previewId) : null;
  const hasFilters = Boolean(search || categories.length || projects.length || owners.length || dateRange !== 'all');

  const reset = (setter) => (value) => { setter(value); setPage(1); };

  function clearFilters() {
    setSearch(''); setCategories([]); setProjects([]); setOwners([]); setDateRange('all'); setCustomRange({ from: '', to: '' }); setPage(1);
  }

  function toggleSort(field) {
    setSort((current) => current.field === field
      ? { field, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      : { field, direction: field === 'createdAt' ? 'desc' : 'asc' });
  }

  function openWorkItem(file) {
    const task = tasks.find((item) => String(item.id) === String(file.workItem?.id));
    if (task) onOpenTask(task);
    else setToast({ type: 'error', message: `${file.workItem?.key || 'The work item'} could not be opened.` });
  }

  function confirmDelete(file) {
    setConfirm({
      title: `Delete ${file.name}?`,
      message: `The file will be removed from ${file.workItem?.key || 'its work item'} and from Documents. This cannot be undone.`,
      onConfirm: async () => {
        try {
          const result = await api.deleteAttachment(file.id);
          replaceWorkItem(result.workItem);
          setFiles((current) => current.filter((item) => item.id !== file.id));
          if (previewId === file.id) setPreviewId(null);
          setToast({ type: 'success', message: `${file.name} deleted.` });
        } catch (error) {
          setToast({ type: 'error', message: error.message });
        }
      }
    });
  }

  const menuItems = (file) => [
    PREVIEWABLE_EXTENSIONS.has(file.extension) ? { label: 'Preview', onSelect: () => setPreviewId(file.id) } : null,
    { label: 'Download', onSelect: () => { window.location.assign(api.attachmentUrl(file.id, 'download')); } },
    { label: `Open ${file.workItem?.key || 'work item'}`, onSelect: () => openWorkItem(file) },
    file.permissions?.delete ? { label: 'Delete', danger: true, onSelect: () => confirmDelete(file) } : null
  ];


  function openFile(file) {
    if (PREVIEWABLE_EXTENSIONS.has(file.extension)) setPreviewId(file.id);
    else window.location.assign(api.attachmentUrl(file.id, 'download'));
  }

  return (
    <div className="app-shell">
      <Header spaces={spaces} tasks={tasks} onGlobalCreate={onGlobalCreate} onOpenTask={onOpenTask} />
      <Sidebar activeSection="Documents" spaces={spaces} onNavigate={onNavigate} onCreateSpace={onCreateSpace} onOpenSpaceSettings={onOpenSpaceSettings} onDeleteSpace={onDeleteSpace} />

      <main className="main-content dc-main">
        <div className="page-heading">
          <div>
            <div className="breadcrumb">My Workspace <span>/</span> Documents</div>
            <h1>Documents</h1>
            <p className="dc-subtitle">Every file attached to work items across your projects.</p>
          </div>
        </div>

        <section className="dc-toolbar" aria-label="File filters">
          <div className="slv-search">
            <Icon name="search" size={15} />
            <input placeholder="Search" value={search} onChange={(event) => reset(setSearch)(event.target.value)} aria-label="Search files by name or work item" />
            {search && <button type="button" onClick={() => reset(setSearch)('')} aria-label="Clear search">×</button>}
          </div>
          <MultiFilter label="File extension" options={Object.values(FILE_CATEGORIES).map((category) => category.label)} selected={categories} onChange={reset(setCategories)} />
          <label className="dc-select-pill">
            <span>Date Added</span>
            <select value={dateRange} onChange={(event) => reset(setDateRange)(event.target.value)} aria-label="Date added">
              {DATE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          {dateRange === 'custom' && (
            <div className="slv-date-filter">
              <input type="date" value={customRange.from} aria-label="Added from" onChange={(event) => { setCustomRange((current) => ({ ...current, from: event.target.value })); setPage(1); }} />
              <span>to</span>
              <input type="date" value={customRange.to} aria-label="Added to" onChange={(event) => { setCustomRange((current) => ({ ...current, to: event.target.value })); setPage(1); }} />
            </div>
          )}
          <MultiFilter label="Project" options={options.projects} selected={projects} onChange={reset(setProjects)} width={220} />
          <MultiFilter label="Owner" options={options.owners} selected={owners} onChange={reset(setOwners)} width={220} />
          {hasFilters && <button type="button" className="it-clear-filters" onClick={clearFilters}><Icon name="close" size={13} /> Clear filters</button>}

          <div className="dc-view" role="radiogroup" aria-label="View">
            <button type="button" role="radio" aria-checked={view === 'list'} className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} title="List view" aria-label="List view"><Icon name="list" size={16} /></button>
            <button type="button" role="radio" aria-checked={view === 'grid'} className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} title="Grid view" aria-label="Grid view"><Icon name="grid" size={16} /></button>
          </div>
        </section>

        <section className="dc-card">
          {files === null ? (
            <div className="dc-empty">
              {loadError ? <>{loadError} <button type="button" className="dc-link" onClick={() => setReloadKey((value) => value + 1)}>Retry</button></> : 'Loading files…'}
            </div>
          ) : !pageRows.length ? (
            <div className="dc-empty">
              <Icon name="paperclip" size={28} />
              <strong>{list.length ? 'No files match your filters' : 'No files yet'}</strong>
              <span>{list.length ? 'Try changing the search or filters.' : 'Files attached to work items (in task details, comments or when creating a work item) appear here.'}</span>
            </div>
          ) : view === 'list' ? (
            <div className="dc-scroll">
              <table className="dc-table">
                <thead>
                  <tr>
                    <th><SortButton field="name" sort={sort} onToggle={toggleSort}>File name</SortButton></th>
                    <th>Attached To</th>
                    <th><SortButton field="createdAt" sort={sort} onToggle={toggleSort}>Create date</SortButton></th>
                    <th>Owner</th>
                    <th className="dc-actions"><span className="dc-visually-hidden">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((file) => (
                    <tr key={file.id}>
                      <td>
                        <button type="button" className="dc-name" onClick={() => openFile(file)} title={PREVIEWABLE_EXTENSIONS.has(file.extension) ? `Preview ${file.name}` : `Download ${file.name}`}>
                          <FileIcon file={file} />
                          <span>
                            <strong>{file.name}</strong>
                            <small>{file.extension.toUpperCase()} · {formatBytes(file.size)}{file.source === 'comment' ? ' · from a comment' : ''}</small>
                          </span>
                        </button>
                      </td>
                      <td>
                        <button type="button" className="dc-attached" onClick={() => openWorkItem(file)} title={`Open ${file.workItem.key} in ${file.space?.name || 'its project'}`}>
                          <span className={`slv-type-icon type-${String(file.workItem.issueType || 'Task').toLowerCase().replace(/[^a-z]+/g, '-')}`}><Icon name={iconForType(file.workItem.issueType)} size={15} /></span>
                          <strong>{file.workItem.key}</strong>
                          <span>{file.workItem.title}</span>
                        </button>
                      </td>
                      <td className="dc-date">{formatDateTime(file.createdAt)}</td>
                      <td><Owner file={file} /></td>
                      <td className="dc-actions">
                        <MenuButton label={`Actions for ${file.name}`} icon="moreVertical" items={menuItems(file)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="dc-grid">
              {pageRows.map((file) => {
                const category = fileCategory(file.extension);
                return (
                  <article key={file.id} className="dc-tile">
                    <button type="button" className={`dc-thumb cat-${category}`} onClick={() => openFile(file)} aria-label={PREVIEWABLE_EXTENSIONS.has(file.extension) ? `Preview ${file.name}` : `Download ${file.name}`}>
                      {category === 'image'
                        ? <img src={api.attachmentUrl(file.id)} alt="" loading="lazy" />
                        : <span className="dc-thumb-icon"><Icon name={CATEGORY_ICONS[category]} size={34} /><b>{file.extension.toUpperCase()}</b></span>}
                    </button>
                    <div className="dc-tile-body">
                      <div className="dc-tile-title">
                        <strong title={file.name}>{file.name}</strong>
                        <MenuButton label={`Actions for ${file.name}`} icon="moreVertical" items={menuItems(file)} />
                      </div>
                      <button type="button" className="dc-attached is-compact" onClick={() => openWorkItem(file)}>
                        <strong>{file.workItem.key}</strong><span>{file.workItem.title}</span>
                      </button>
                      <div className="dc-tile-meta">
                        <Owner file={file} />
                        <span title={formatDateTime(file.createdAt)}>{formatDateTime(file.createdAt).slice(0, 10)} · {formatBytes(file.size)}</span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {files !== null && (
            <Pagination
              page={currentPage}
              pageSize={pageSize}
              total={filtered.length}
              pageSizes={view === 'grid' ? [12, 24, 48] : [10, 20, 50]}
              label="Files"
              onPageChange={setPage}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
            />
          )}
        </section>
      </main>

      <Toast toast={toast} onClose={() => setToast(null)} />

      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          uploadedAt={formatDateTime(previewFile.createdAt)}
          files={previewable}
          onNavigate={(file) => setPreviewId(file.id)}
          onOpenWorkItem={() => openWorkItem(previewFile)}
          onDelete={previewFile.permissions?.delete ? () => confirmDelete(previewFile) : null}
          onClose={() => setPreviewId(null)}
        />
      )}

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          onClose={() => setConfirm(null)}
          onConfirm={() => { confirm.onConfirm(); setConfirm(null); }}
        />
      )}
    </div>
  );
}
