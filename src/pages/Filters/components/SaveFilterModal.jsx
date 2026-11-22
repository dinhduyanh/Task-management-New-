import { useEffect, useRef, useState } from 'react';
import Icon from '../../../components/common/Icon';

/**
 * Name / description / access of a filter.
 * onSubmit(values) resolves to an error message, or '' when saved.
 */
export default function SaveFilterModal({ title = 'Save filter', submitLabel = 'Save', initial = {}, tql = '', showQuery = true, onClose, onSubmit }) {
  const [name, setName] = useState(initial.name || '');
  const [description, setDescription] = useState(initial.description || '');
  const [visibility, setVisibility] = useState(initial.visibility || 'private');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const nameRef = useRef(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
    const onKey = (event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  async function submit(event) {
    event.preventDefault();
    if (!name.trim()) { setError('Give the filter a name.'); nameRef.current?.focus(); return; }
    setSaving(true);
    const problem = await onSubmit({ name: name.trim(), description: description.trim(), visibility });
    setSaving(false);
    if (problem) setError(problem);
  }

  return (
    <div className="slv-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="slv-modal fl-modal" role="dialog" aria-modal="true" aria-labelledby="fl-save-title">
        <div className="slv-modal-head">
          <h2 id="fl-save-title">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <form id="fl-save-form" className="slv-modal-content fl-form" onSubmit={submit} noValidate>
          <label className="fl-label" htmlFor="fl-name">Name <span aria-hidden="true">*</span></label>
          <input id="fl-name" ref={nameRef} className="fl-input" value={name} maxLength={80} onChange={(event) => { setName(event.target.value); setError(''); }} placeholder="e.g. My urgent bugs" />
          <label className="fl-label" htmlFor="fl-description">Description</label>
          <textarea id="fl-description" className="fl-input fl-textarea" value={description} maxLength={500} rows={3} onChange={(event) => setDescription(event.target.value)} placeholder="What does this filter show?" />
          <span className="fl-label" id="fl-access">Access</span>
          <div className="fl-access" role="radiogroup" aria-labelledby="fl-access">
            {[
              ['private', 'lock', 'Private', 'Only you can see it'],
              ['public', 'users', 'Public', 'Everyone can open and copy it']
            ].map(([value, icon, label, hint]) => (
              <label key={value} className={`fl-access-option ${visibility === value ? 'is-selected' : ''}`}>
                <input type="radio" name="fl-visibility" value={value} checked={visibility === value} onChange={() => setVisibility(value)} />
                <Icon name={icon} size={15} />
                <span><strong>{label}</strong><small>{hint}</small></span>
              </label>
            ))}
          </div>
          {showQuery && (
            <>
              <span className="fl-label">Query</span>
              <code className="fl-query">{tql || 'All work items (no conditions)'}</code>
            </>
          )}
          {error && <p className="fl-error" role="alert">{error}</p>}
        </form>
        <div className="slv-modal-foot">
          <button type="button" className="slv-btn secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="fl-save-form" className="slv-btn primary" disabled={saving}>{saving ? 'Saving…' : submitLabel}</button>
        </div>
      </div>
    </div>
  );
}
