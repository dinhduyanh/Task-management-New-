import { useEffect, useState } from 'react';
import Icon from '../../components/common/Icon';
import { api } from '../../services/api';
import { ConfirmModal } from '../SpaceBacklog/SprintModals';
import SettingsModal from './SettingsModal';

function RoleFormModal({ role = null, onClose, onSaved }) {
  const [name, setName] = useState(role?.name || '');
  const [description, setDescription] = useState(role?.description || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return setError('Role name is required.');
    setSaving(true);
    setError('');
    try {
      const values = { name: name.trim(), description: description.trim() };
      const saved = role ? await api.admin.updateProjectRole(role.id, values) : await api.admin.createProjectRole(values);
      onSaved(saved, Boolean(role));
      onClose();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsModal
      title={role ? `Edit ${role.name}` : 'New project role'}
      onClose={onClose}
      onSubmit={save}
      footer={<>
        {error && <span className="ss-form-error" role="alert">{error}</span>}
        <button type="button" className="ss-button" onClick={onClose}>Cancel</button>
        <button type="submit" className="ss-button is-primary" disabled={saving}>{saving ? 'Saving…' : role ? 'Save changes' : 'Create role'}</button>
      </>}
    >
      <div className="ss-form-grid">
        <label className="ss-field ss-span-2">
          <span>Role name <b>*</b></span>
          <input value={name} maxLength={60} autoFocus={!role?.isSystem} readOnly={role?.isSystem} onChange={(event) => setName(event.target.value)} placeholder="e.g. Business Analyst" />
          {role?.isSystem && <small className="ss-hint">Built-in roles cannot be renamed; you can change the description.</small>}
          {role?.memberCount > 0 && <small className="ss-hint">Renaming updates the {role.memberCount} project member{role.memberCount === 1 ? '' : 's'} who have this role.</small>}
        </label>
        <label className="ss-field ss-span-2">
          <span>Description</span>
          <textarea rows={3} maxLength={300} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What does this role do in a project?" />
        </label>
      </div>
    </SettingsModal>
  );
}

export default function ProjectRolesPanel({ onToast, onDataChanged }) {
  const [roles, setRoles] = useState(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [form, setForm] = useState(null); // { role }
  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
    let active = true;
    api.admin.getProjectRoles()
      .then((rows) => { if (active) { setRoles(rows); setError(''); } })
      .catch((loadError) => { if (active) setError(loadError.message); });
    return () => { active = false; };
  }, [reloadKey]);

  function remove(role) {
    setConfirm({
      title: `Delete ${role.name}?`,
      message: 'The role will no longer be available for project members and is removed from every project permission rule.',
      onConfirm: async () => {
        try {
          await api.admin.deleteProjectRole(role.id);
          setRoles((current) => current.filter((item) => item.id !== role.id));
          onToast({ type: 'success', message: `${role.name} deleted.` });
        } catch (deleteError) {
          onToast({ type: 'error', message: deleteError.message });
        }
      }
    });
  }

  return (
    <>
      <div className="ss-panel-head">
        <div>
          <h2>Project Roles</h2>
          <p>Roles given to members inside a project (Space settings › People) and used by project permission rules. “Admin Project” always has every permission; “All Member” means every member.</p>
        </div>
        <button type="button" className="ss-button is-primary" onClick={() => setForm({ role: null })}><Icon name="plus" size={15} /> New role</button>
      </div>

      {roles === null ? (
        <div className="ss-card ss-empty">{error ? <>{error} <button type="button" className="ss-link" onClick={() => setReloadKey((value) => value + 1)}>Retry</button></> : 'Loading roles…'}</div>
      ) : (
        <div className="ss-role-list">
          {roles.map((role) => (
            <article key={role.id} className="ss-role-card">
              <span className="ss-role-icon"><Icon name="shield" size={18} /></span>
              <div className="ss-role-text">
                <strong>{role.name}{role.isSystem && <span className="ss-pill ss-builtin">Built-in</span>}</strong>
                <p>{role.description || <span className="ss-muted">No description</span>}</p>
              </div>
              <span className="ss-role-usage" title="Project members with this role">
                <Icon name="users" size={14} /> {role.memberCount === null ? 'Every member' : `${role.memberCount} member${role.memberCount === 1 ? '' : 's'}`}
              </span>
              <div className="ss-role-actions">
                <button type="button" className="ss-icon-button" onClick={() => setForm({ role })} aria-label={`Edit ${role.name}`} title="Edit"><Icon name="edit" size={15} /></button>
                <button
                  type="button"
                  className="ss-icon-button is-danger"
                  onClick={() => remove(role)}
                  disabled={role.isSystem || role.memberCount > 0}
                  aria-label={`Delete ${role.name}`}
                  title={role.isSystem ? 'Built-in roles cannot be deleted' : role.memberCount > 0 ? 'In use: change these members’ roles first' : 'Delete'}
                >
                  <Icon name="trash" size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {form && (
        <RoleFormModal
          role={form.role}
          onClose={() => setForm(null)}
          onSaved={(saved, editing) => {
            setRoles((current) => (editing ? current.map((item) => (item.id === saved.id ? saved : item)) : [...current, saved]));
            if (editing) onDataChanged(); // renamed roles appear on project members
            onToast({ type: 'success', message: `${saved.name} ${editing ? 'updated' : 'created'}.` });
          }}
        />
      )}
      {confirm && (
        <ConfirmModal title={confirm.title} message={confirm.message} onClose={() => setConfirm(null)} onConfirm={() => { confirm.onConfirm(); setConfirm(null); }} />
      )}
    </>
  );
}
