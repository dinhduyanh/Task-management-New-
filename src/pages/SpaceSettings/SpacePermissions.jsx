import { useEffect, useState } from 'react';
import Icon from '../../components/common/Icon';
import { useAppShell } from '../../context/appShellContext';
import { api } from '../../services/api';
import ChipSelect from '../../components/common/ChipSelect';
import { ConfirmModal } from '../SpaceBacklog/SprintModals';
import SettingsModal from '../SystemSettings/SettingsModal';
import './SpacePermissions.css';

const KIND_LABEL = { role: 'Role', user: 'User', field: 'Field' };

function RuleBadge({ rule, label, locked = false, onRemove = null, disabled = false }) {
  const kind = KIND_LABEL[rule.type] || rule.type;
  return (
    <span className={`sp-rule is-${rule.type} ${locked ? 'is-locked' : ''}`}>
      <span className="sp-rule-kind">{kind}</span>
      <span className="sp-rule-value">{label}</span>
      {locked && <Icon name="lock" size={12} />}
      {onRemove && (
        <button type="button" className="sp-rule-remove" onClick={onRemove} disabled={disabled} aria-label={`Remove ${kind} ${label}`} title="Remove rule">
          <Icon name="close" size={11} />
        </button>
      )}
    </span>
  );
}

/** Nexus-style "UPDATE FOR … PERMISSION" dialog: Role checkboxes, User and User in Field pickers. */
function RuleModal({ permission, rules, data, onSave, onClose }) {
  const roles = data.roles.filter((role) => role.name !== data.adminRole);
  const [roleNames, setRoleNames] = useState(() => rules.filter((rule) => rule.type === 'role').map((rule) => rule.value));
  const [userIds, setUserIds] = useState(() => rules.filter((rule) => rule.type === 'user').map((rule) => rule.value));
  const [fields, setFields] = useState(() => rules.filter((rule) => rule.type === 'field').map((rule) => rule.value));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fieldsAllowed = permission.scope === 'task';
  const allChecked = roles.length > 0 && roles.every((role) => roleNames.includes(role.name));
  const toggleRole = (name) => setRoleNames((current) => (current.includes(name) ? current.filter((item) => item !== name) : [...current, name]));

  const userOptions = data.users
    .filter((user) => user.active || userIds.includes(user.id))
    .map((user) => ({ value: user.id, label: user.fullName || user.username, sublabel: user.email || `@${user.username}`, user }));
  const fieldOptions = data.fields.map((field) => ({ value: field.value, label: field.label, sublabel: field.description }));

  async function submit() {
    setSaving(true);
    setError('');
    const next = [
      ...roles.filter((role) => roleNames.includes(role.name)).map((role) => ({ type: 'role', value: role.name })),
      ...userIds.map((value) => ({ type: 'user', value })),
      ...(fieldsAllowed ? fields.map((value) => ({ type: 'field', value })) : [])
    ];
    const message = await onSave(next);
    setSaving(false);
    if (message) setError(message);
    else onClose();
  }

  return (
    <SettingsModal
      title={`UPDATE FOR ${permission.label.toUpperCase()} PERMISSION`}
      onClose={onClose}
      onSubmit={submit}
      footer={<>
        {error && <span className="ss-form-error" role="alert">{error}</span>}
        <button type="button" className="ss-button" onClick={onClose}>Cancel</button>
        <button type="submit" className="ss-button is-primary" disabled={saving}>{saving ? 'Updating…' : 'Update'}</button>
      </>}
    >
      <div className="spr-modal">
        <div className="spr-grant">Grant to</div>

        <div className="sp-field sp-role-field">
          <div className="sp-role-head">
            <span id="spr-roles">Role</span>
            <label className="sp-select-all">
              <input
                type="checkbox"
                checked={allChecked}
                ref={(el) => { if (el) el.indeterminate = !allChecked && roleNames.length > 0; }}
                onChange={() => setRoleNames(allChecked ? [] : roles.map((role) => role.name))}
              />
              Select all role
            </label>
          </div>
          <div className="sp-role-list" role="group" aria-labelledby="spr-roles">
            <label className="sp-role-row is-checked is-locked" title={`${data.adminRole} always has every permission.`}>
              <input type="checkbox" checked disabled />
              <span className="sp-role-name">{data.adminRole}</span>
              <Icon name="lock" size={11} />
              <span className="sp-role-desc">always has every permission</span>
            </label>
            {roles.map((role) => {
              const checked = roleNames.includes(role.name);
              const description = role.name === data.allMemberRole ? 'every member of the project' : role.description;
              return (
                <label key={role.id} className={`sp-role-row ${checked ? 'is-checked' : ''}`} title={description || role.name}>
                  <input type="checkbox" checked={checked} onChange={() => toggleRole(role.name)} />
                  <span className="sp-role-name">{role.name}</span>
                  {description && <span className="sp-role-desc">{description}</span>}
                </label>
              );
            })}
          </div>
        </div>

        <label className="sp-field" htmlFor="spr-users">
          <span>User</span>
          <ChipSelect
            id="spr-users"
            options={userOptions}
            value={userIds}
            onChange={setUserIds}
            placeholder="Search project members by name or email"
            ariaLabel="Users"
            chipLabel={(option) => (option.user?.email ? `${option.label} - ${option.user.email}` : option.label)}
            emptyText={data.users.length ? 'User not found' : 'This project has no members yet.'}
          />
          <small className="sp-hint">Only members of this project can be chosen.</small>
        </label>

        <label className="sp-field" htmlFor="spr-fields">
          <span>User in Field</span>
          <ChipSelect
            id="spr-fields"
            options={fieldOptions}
            value={fieldsAllowed ? fields : []}
            onChange={setFields}
            placeholder={fieldsAllowed ? 'Select fields' : 'Not available for this permission'}
            ariaLabel="User in Field"
            disabled={!fieldsAllowed}
          />
          <small className="sp-hint">{fieldsAllowed
            ? 'The person in that field of a work item gets this permission for that item.'
            : `"${permission.label}" is not tied to a work item, so field rules do not apply.`}</small>
        </label>
      </div>
    </SettingsModal>
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
  const [editing, setEditing] = useState(null); // permission whose rules are open in the dialog

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

  /** Saves a rule list. Resolves to '' or an error message. */
  async function saveRules(permission, rules) {
    const previous = data;
    setData((current) => ({ ...current, rules: { ...current.rules, [permission.key]: rules } }));
    setSaving(permission.key);
    try {
      setData(await api.updateSpacePermission(space.id, permission.key, rules));
      setNotice({ type: 'success', message: `${permission.label} updated.` });
      onChanged();
      return '';
    } catch (saveError) {
      setData(previous);
      setNotice({ type: 'error', message: saveError.message });
      return saveError.message;
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
  const userLabels = Object.fromEntries((data.users || []).map((user) => [user.id, user.fullName || user.username]));
  const ruleLabel = (rule) => (rule.type === 'field' ? fieldLabels[rule.value] || rule.value : rule.type === 'user' ? userLabels[rule.value] || 'Unknown user' : rule.value);
  const adminRule = { type: 'role', value: data.adminRole };
  const canEdit = data.canEdit;

  return (
    <section className="settings-secondary-content sp-permissions">
      <div className="sp-perm-heading">
        <div className="settings-content-heading">
          <h1>Permissions</h1>
          <p>Choose who can do what in this project. Rules can name a project role, a specific member, or a person field of the work item (its Assignee or Creator / Reporter).</p>
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
                    <RuleBadge rule={adminRule} label={data.adminRole} locked />
                    {rules.map((rule) => (
                      <RuleBadge
                        key={`${rule.type}:${rule.value}`}
                        rule={rule}
                        label={ruleLabel(rule)}
                        disabled={busy}
                        onRemove={canEdit ? () => saveRules(permission, rules.filter((item) => item !== rule)) : null}
                      />
                    ))}
                    {canEdit && (
                      <button type="button" className="sp-add-rule-button" onClick={() => setEditing(permission)} disabled={busy} aria-label={`Add access rule to ${permission.label}`}>
                        <Icon name="plus" size={12} /> Add rule
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {editing && (
        <RuleModal
          permission={editing}
          rules={data.rules[editing.key] || []}
          data={data}
          onSave={(rules) => saveRules(editing, rules)}
          onClose={() => setEditing(null)}
        />
      )}

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
