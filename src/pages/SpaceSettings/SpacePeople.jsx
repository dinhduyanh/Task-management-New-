import { useEffect, useMemo, useState } from 'react';
import Icon from '../../components/common/Icon';
import UserAvatar from '../../components/common/UserAvatar';
import { useAppShell } from '../../context/appShellContext';
import { api } from '../../services/api';
import { useProjectPermissions } from '../../services/projectPermissions';

const ADMIN_PROJECT = 'Admin Project';
import { ConfirmModal } from '../SpaceBacklog/SprintModals';

/** Project roles that can be given to members: never "All Member" (implicit); "Admin Project" only by project admins. */
function useProjectRoles(isProjectAdmin) {
  const [allRoles, setRoles] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api.getProjectRoles()
      .then((rows) => { if (active) setRoles(rows); })
      .catch((loadError) => { if (active) { setRoles([]); setError(loadError.message); } });
    return () => { active = false; };
  }, []);
  const roles = allRoles && allRoles.filter((role) => (role.isSystem ? role.name === ADMIN_PROJECT && isProjectAdmin : true));
  return { roles, error };
}

function memberRoles(member) {
  if (Array.isArray(member.roles) && member.roles.length) return member.roles;
  return member.role ? String(member.role).split(',').map((role) => role.trim()).filter(Boolean) : [];
}

function RoleChecklist({ roles, value, onChange, disabled = false, idPrefix }) {
  function toggle(name) {
    onChange(value.includes(name) ? value.filter((role) => role !== name) : [...value, name]);
  }
  return (
    <div className="sp-role-checks" role="group" aria-label="Project roles">
      {roles.map((role) => (
        <label key={role.id} className={`sp-role-check ${value.includes(role.name) ? 'active' : ''}`} title={role.description || role.name}>
          <input id={`${idPrefix}-${role.id}`} type="checkbox" checked={value.includes(role.name)} disabled={disabled} onChange={() => toggle(role.name)} />
          <span>{role.name}</span>
        </label>
      ))}
    </div>
  );
}

function AddMemberForm({ space, roles, onAdd }) {
  const [users, setUsers] = useState(null);
  const [userId, setUserId] = useState('');
  const [selectedRoles, setSelectedRoles] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api.getUsers()
      .then((rows) => { if (active) setUsers(rows); })
      .catch((loadError) => { if (active) { setUsers([]); setError(loadError.message); } });
    return () => { active = false; };
  }, []);

  const memberIds = useMemo(() => new Set((space.members || []).map((member) => member.userId || member.id)), [space.members]);
  const candidates = (users || []).filter((user) => !memberIds.has(user.id));
  const defaultRole = roles.find((role) => role.name === 'Developer')?.name || roles[0]?.name;

  async function submit(event) {
    event.preventDefault();
    if (!userId) return setError('Choose a person to add.');
    const chosen = selectedRoles.length ? selectedRoles : [defaultRole].filter(Boolean);
    if (!chosen.length) return setError('Choose at least one project role.');
    setSaving(true);
    setError('');
    const message = await onAdd({ userId, roles: chosen });
    setSaving(false);
    if (message) return setError(message);
    setUserId('');
    setSelectedRoles([]);
  }

  return (
    <form className="sp-add" onSubmit={submit}>
      <div className="sp-add-row">
        <label className="sp-field">
          <span>Person</span>
          <select value={userId} onChange={(event) => { setUserId(event.target.value); setError(''); }} disabled={users === null}>
            <option value="">{users === null ? 'Loading people…' : candidates.length ? 'Choose a person' : 'Everyone is already a member'}</option>
            {candidates.map((user) => <option key={user.id} value={user.id}>{user.fullName || user.username} ({user.username})</option>)}
          </select>
        </label>
        <button type="submit" className="sp-button is-primary" disabled={saving || !userId}>
          <Icon name="plus" size={14} /> {saving ? 'Adding…' : 'Add member'}
        </button>
      </div>
      <div className="sp-field">
        <span>Project roles {!selectedRoles.length && defaultRole && <small>(defaults to {defaultRole})</small>}</span>
        <RoleChecklist roles={roles} value={selectedRoles} onChange={setSelectedRoles} idPrefix="sp-new-role" />
      </div>
      {error && <p className="sp-error" role="alert">{error}</p>}
    </form>
  );
}

function MemberRow({ member, space, roles, canManage, isProjectAdmin, onAdd, onRemove }) {
  const { user: currentUser } = useAppShell();
  const userId = member.userId || member.id;
  const isOwner = Boolean(space.ownerId) && space.ownerId === userId;
  const current = memberRoles(member);
  // Only project admins may change or remove another project admin.
  const lockedAdmin = current.includes(ADMIN_PROJECT) && !isProjectAdmin;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const name = member.name || member.fullName || member.username || 'Unnamed member';

  async function save() {
    if (!draft.length) return setError('Choose at least one project role.');
    setSaving(true);
    const message = await onAdd({ userId, roles: draft });
    setSaving(false);
    if (message) return setError(message);
    setError('');
    setEditing(false);
  }

  return (
    <div className="sp-member">
      <div className="sp-member-main">
        <UserAvatar user={{ fullName: name }} size={34} />
        <div className="sp-member-name">
          <strong>
            {name}
            {isOwner && <span className="sp-tag is-owner">Owner</span>}
            {currentUser?.id === userId && <span className="sp-tag">You</span>}
          </strong>
          <small>{member.email || member.username || ''}</small>
        </div>
        {!editing && (
          <div className="sp-member-roles">
            {current.length ? current.map((role) => <span key={role} className="sp-role-chip">{role}</span>) : <span className="sp-role-chip is-empty">No role</span>}
          </div>
        )}
        {canManage && !lockedAdmin && !editing && (
          <div className="sp-member-actions">
            <button type="button" className="sp-icon-button" onClick={() => { setDraft(current); setEditing(true); }} aria-label={`Change roles of ${name}`} title="Change roles"><Icon name="edit" size={15} /></button>
            <button
              type="button"
              className="sp-icon-button is-danger"
              onClick={() => onRemove(member, name)}
              disabled={isOwner}
              aria-label={`Remove ${name}`}
              title={isOwner ? 'The project owner cannot be removed' : 'Remove from project'}
            >
              <Icon name="trash" size={15} />
            </button>
          </div>
        )}
      </div>
      {editing && (
        <div className="sp-member-edit">
          <RoleChecklist roles={roles} value={draft} onChange={setDraft} idPrefix={`sp-role-${userId}`} />
          {error && <p className="sp-error" role="alert">{error}</p>}
          <div className="sp-member-edit-actions">
            <button type="button" className="sp-button" onClick={() => { setEditing(false); setError(''); }}>Cancel</button>
            <button type="button" className="sp-button is-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save roles'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PeopleSettings({ space, onAddMember, onRemoveMember }) {
  const members = Array.isArray(space.members) ? space.members : [];
  const { can, isProjectAdmin } = useProjectPermissions(space);
  const canManage = can('project.setting');
  const { roles, error: rolesError } = useProjectRoles(isProjectAdmin);
  const [confirm, setConfirm] = useState(null);
  const [notice, setNotice] = useState('');

  // Legacy members (created before accounts were linked) have no real user id.
  const linked = (member) => Boolean(member.userId || member.username || member.email);

  return (
    <section className="settings-secondary-content">
      <div className="settings-content-heading">
        <h1>People</h1>
        <p>{canManage ? 'Add people to this project and choose their project roles. Only members can see the project.' : 'People who have access to this project. Only people with the Project Setting permission can change members.'}</p>
      </div>

      {canManage && (
        <div className="settings-section-card sp-card">
          <div className="settings-section-card-header"><strong>Add people</strong><span>Roles are managed by administrators</span></div>
          {roles === null ? <div className="settings-empty-state">Loading roles…</div> : <AddMemberForm space={space} roles={roles} onAdd={onAddMember} />}
          {rolesError && <p className="sp-error sp-pad" role="alert">{rolesError}</p>}
        </div>
      )}

      <div className="settings-section-card sp-card">
        <div className="settings-section-card-header"><strong>Project members</strong><span>{members.length} member{members.length === 1 ? '' : 's'}</span></div>
        {notice && <p className="sp-error sp-pad" role="alert">{notice}</p>}
        {members.length ? members.map((member, index) => (
          linked(member) ? (
            <MemberRow
              key={member.userId || member.id || index}
              member={member}
              space={space}
              roles={roles || []}
              canManage={canManage && roles !== null}
              isProjectAdmin={isProjectAdmin}
              onAdd={onAddMember}
              onRemove={(target, name) => setConfirm({ target, name })}
            />
          ) : (
            <div className="sp-member is-legacy" key={member.id || index}>
              <div className="sp-member-main">
                <UserAvatar user={{ fullName: member.name || 'Member' }} size={34} />
                <div className="sp-member-name"><strong>{member.name || 'Unnamed member'}</strong><small>Not linked to an account — add the person again to give them access.</small></div>
                <div className="sp-member-roles"><span className="sp-role-chip is-empty">{member.role || 'Member'}</span></div>
              </div>
            </div>
          )
        )) : <div className="settings-empty-state">No members have been added to this project yet.</div>}
      </div>

      {confirm && (
        <ConfirmModal
          title={`Remove ${confirm.name}?`}
          message="They will lose access to this project and its work items."
          confirmLabel="Remove"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            const target = confirm.target;
            setConfirm(null);
            setNotice(await onRemoveMember(target.userId || target.id));
          }}
        />
      )}
    </section>
  );
}
