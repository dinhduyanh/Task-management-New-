import { useEffect } from 'react';
import Icon from '../../components/common/Icon';
import { api } from '../../services/api';
import { fileCategory, formatBytes } from '../../services/fileTypes';

/** Full-screen preview for images and PDFs, with previous/next through `files`. */
export default function FilePreviewModal({ file, files = [], uploadedAt = '', onNavigate, onOpenWorkItem, onDelete, onClose }) {
  const index = files.findIndex((item) => item.id === file.id);
  const previous = index > 0 ? files[index - 1] : null;
  const next = index >= 0 && index < files.length - 1 ? files[index + 1] : null;
  const isImage = fileCategory(file.extension) === 'image';

  useEffect(() => {
    const onKey = (event) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft' && previous) onNavigate(previous);
      if (event.key === 'ArrowRight' && next) onNavigate(next);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [previous, next, onNavigate, onClose]);

  return (
    <div className="dc-preview-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="dc-preview" role="dialog" aria-modal="true" aria-labelledby="dc-preview-title">
        <header className="dc-preview-head">
          <div className="dc-preview-title">
            <h2 id="dc-preview-title" title={file.name}>{file.name}</h2>
            <small>
              {file.workItem?.key} · {formatBytes(file.size)}{uploadedAt ? ` · ${uploadedAt}` : ''}{file.uploadedBy?.name ? ` · ${file.uploadedBy.name}` : ''}
            </small>
          </div>
          <div className="dc-preview-actions">
            {files.length > 1 && <span className="dc-preview-count">{index + 1} / {files.length}</span>}
            <button type="button" onClick={onOpenWorkItem}>Open {file.workItem?.key || 'work item'}</button>
            <a href={api.attachmentUrl(file.id, 'download')} className="dc-preview-button"><Icon name="download" size={15} /> Download</a>
            <button type="button" className="danger" onClick={onDelete} aria-label={`Delete ${file.name}`}><Icon name="trash" size={15} /></button>
            <button type="button" onClick={onClose} aria-label="Close preview"><Icon name="close" size={16} /></button>
          </div>
        </header>
        <div className="dc-preview-body">
          {previous && <button type="button" className="dc-preview-nav is-prev" onClick={() => onNavigate(previous)} aria-label={`Previous: ${previous.name}`}>‹</button>}
          {isImage
            ? <img src={api.attachmentUrl(file.id)} alt={file.name} />
            : <iframe src={api.attachmentUrl(file.id)} title={file.name} />}
          {next && <button type="button" className="dc-preview-nav is-next" onClick={() => onNavigate(next)} aria-label={`Next: ${next.name}`}>›</button>}
        </div>
      </div>
    </div>
  );
}
