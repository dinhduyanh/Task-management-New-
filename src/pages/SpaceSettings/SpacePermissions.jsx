import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/common/Icon';
import { useAppShell } from '../../context/appShellContext';
import { api } from '../../services/api';
import { ConfirmModal } from '../SpaceBacklog/SprintModals';
import './SpacePermissions.css';

function RuleBadge({ rule, fieldLabels, locked = false, onRemove = null, disabled = false }) {
  const isField = rule.type === 'field';
  const value = isField ? fieldLabels[rule.value] || rule.value : rule.value;
  return (
    <span className={`sp-rule ${isField ? 'is-field' : 'is-role'} ${locked ? 'is-locked' : ''}`}>
      <span className="sp-rule-kind">{isField ? 'User in Field' : 'Role'}</span>
      <span className="sp-rule-value">{value}</span>
      {locked && <Icon name="lock" size={12} />}
      {onRemove && (
        <button type="button" className="sp-rule-remove" onClick={onRemove} disabled={disabled} aria-label={`Remove ${isField ? 'User in Field' : 'Role'} ${value}`} title="Remove rule">
          <Icon name="close" size={11} />
        </button>
      )}
    </span>
  );
}

/** "Add rule" button with a menu of the roles and fields not used yet. */
function AddRuleMenu({ permission, rules, roles, fields, allMemberRole, disabled, onAdd }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => { if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false); };
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const usedRoles = new Set(rules.filter((rule) => rule.type === 'role').map((rule) => rule.value));
  const usedFields = new Set(rules.filter((rule) => rule.type === 'field').map((rule) => rule.value));
  const availableRoles = roles.filter((role) => role.name !== 'Admin Project' && !usedRoles.has(role.name));
  const availableFields = fields.filter((field) => !usedFields.has(field.value));
  const fieldsAllowed = permission.scope === 'task';
  const choose = (rule) => { setOpen(false); onAdd(rule); };

  return (
    <div className="sp-add-rule" ref={rootRef}>
      <button type="button" className="sp-add-rule-button" onClick={() => setOpen((value) => !value)} disabled={disabled} aria-expanded={open} aria-haspopup="menu" aria-label={`Add access rule to ${permission.label}`}>
        <Icon name="plus" size={12} /> Add rule
      </button>
      {open && (
        <div className="sp-rule-menu" role="menu">
          <div className="sp-rule-menu-group">Role</div>
          {availableRoles.length ? availableRoles.map((role) => (
            <button type="button" role="menuitem" key={role.id} onClick={() => choose({ type: 'role', value: role.name })}>
              <span className="sp-rule-menu-kind is-role">Role</span>
              <span>
                <strong>{role.name}</strong>
                <small>{role.name === allMemberRole ? 'Every member of the project' : role.description || 'Members with this project role'}</small>
              </span>
            </button>
          )) : <div className="sp-rule-menu-empty">Every role is already listed.</div>}
          <div className="sp-rule-menu-group">User in Field</div>
          {!fieldsAllowed ? (
            <div className="sp-rule-menu-empty">Not available: this permission is not tied to a work item.</div>
          ) : availableFields.length ? availableFields.map((field) => (
            <button type="button" role="menuitem" key={field.value} onClick={() => choose({ type: 'field', value: field.value })}>
              <span className="sp-rule-menu-kind is-field">Field</span>
              <span><strong>{field.label}</strong><small>{field.description}</small></span>
            </button>
          )) : <div className="sp-rule-menu-empty">Both fields are already listed.</div>}
        </div>
      )}
    </div>
  );
}

export default function PermissionsSettings({ space, onChanged = () => {} }) {
  const { isAdmin, navigate } = useAppShell();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');
  const [notice, setNotice] = useState(null); // { type, message }
  const [confirmReset, setConfirmReset] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    api.getSpacePermissions(space.id)
      .then((payload) => { if (active) { setData(payload); setError(''); } })
      .catch((loadError) => { if (active) setError(loadError.message); });
    return () => { active = false; };
  }, [space.id, reloadKey]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function saveRules(permission, rules) {
    const previous = data;
    setData((current) => ({ ...current, rules: { ...current.rules, [permission.key]: rules } }));
    setSaving(permission.key);
    try {
      setData(await api.updateSpacePermission(space.id, permission.key, rules));
      setNotice({ type: 'success', message: `${permission.label} updated.` });
      onChanged();
    } catch (saveError) {
      setData(previous);
      setNotice({ type: 'error', message: saveError.message });
    } finally {
      setSaving('');
    }
  }

  async function reset() {
    setConfirmReset(false);
    try {
      setData(await api.resetSpacePermissions(space.id));
      setNotice({ type: 'success', message: 'Permissions were reset to the defaults.' });
      onChanged();
    } catch (resetError) {
      setNotice({ type: 'error', message: resetError.message });
    }
  }

  if (!data) {
    return (
      <section className="settings-secondary-content">
        <div className="settings-content-heading"><h1>Permissions</h1></div>
        <div className="settings-section-card"><div className="settings-empty-state">
          {error ? <>{error} <button type="button" className="sp-link" onClick={() => setReloadKey((value) => value + 1)}>Retry</button></> : 'Loading permissions…'}
        </div></div>
      </section>
    );
  }

  const fieldLabels = Object.fromEntries(data.fields.map((field) => [field.value, field.label]));
  const adminRule = { type: 'role', value: data.adminRole };
  const canEdit = data.canEdit;

  return (
    <section className="settings-secondary-content sp-permissions">
      <div className="sp-perm-heading">
        <div className="settings-content-heading">
          <h1>Permissions</h1>
          <p>Choose who can do what in this project. Rules can name a project role or a person field of the work item (its Assignee or Creator).</p>
        </div>
        {canEdit && <button type="button" className="sp-button" onClick={() => setConfirmReset(true)}><Icon name="refresh" size={14} /> Reset to defaults</button>}
      </div>

      <div className={`sp-perm-banner ${canEdit ? '' : 'is-readonly'}`} role="note">
        <Icon name={canEdit ? 'shield' : 'lock'} size={16} />
        <div>
          <strong>{canEdit ? 'You are a project admin.' : 'Only project admins can change these rules.'}</strong>
          <span>
            {data.adminRole} (the project owner, system administrators and members with that role) always has every permission.
            {' '}{data.allMemberRole} means every member of the project.
            {isAdmin && <> Project roles are managed in <button type="button" className="sp-link" onClick={() => navigate('systemSettings', { tab: 'project-roles' })}>System settings</button>.</>}
          </span>
        </div>
      </div>

      {notice && <div className={`sp-perm-notice is-${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>{notice.message}</div>}

      {data.groups.map((group) => (
        <div className="sp-perm-group" key={group.id}>
          <h2>{group.label}</h2>
          <div className="sp-perm-table" role="table" aria-label={group.label}>
            <div className="sp-perm-row sp-perm-head" role="row">
              <span role="columnheader">Permission</span>
              <span role="columnheader">Access Rules</span>
            </div>
            {group.permissions.map((permission) => {
              const rules = data.rules[permission.key] || [];
              const busy = saving === permission.key;
              return (
                <div className={`sp-perm-row ${busy ? 'is-saving' : ''}`} role="row" key={permission.key} data-permission={permission.key}>
                  <div className="sp-perm-name" role="cell">
                    <strong>{permission.label}</strong>
                    <small>{permission.description}</small>
                  </div>
                  <div className="sp-perm-rules" role="cell">
                    <RuleBadge rule={adminRule} fieldLabels={fieldLabels} locked />
                    {rules.map((rule) => (
                      <RuleBadge
                        key={`${rule.type}:${rule.value}`}
                        rule={rule}
                        fieldLabels={fieldLabels}
                        disabled={busy}
                        onRemove={canEdit ? () => saveRules(permission, rules.filter((item) => item !== rule)) : null}
                      />
                    ))}
                    {canEdit && (
                      <AddRuleMenu
                        permission={permission}
                        rules={rules}
                        roles={data.roles}
                        fields={data.fields}
                        allMemberRole={data.allMemberRole}
                        disabled={busy}
                        onAdd={(rule) => saveRules(permission, [...rules, rule])}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {confirmReset && (
        <ConfirmModal
          title="Reset permissions?"
          message="Every permission of this project goes back to its default rules. Changes you made are lost."
          confirmLabel="Reset"
          onClose={() => setConfirmReset(false)}
          onConfirm={reset}
        />
      )}
    </section>
  );
}
