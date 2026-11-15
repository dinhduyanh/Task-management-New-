import { useEffect, useMemo, useState } from 'react';
import Icon from '../../components/common/Icon';
import UserAvatar from '../../components/common/UserAvatar';
import { useAppShell } from '../../context/appShellContext';
import { api } from '../../services/api';
import { useProjectPermissions } from '../../services/projectPermissions';
import { ConfirmModal } from '../SpaceBacklog/SprintModals';
import SettingsModal from '../SystemSettings/SettingsModal';

const ADMIN_PROJECT = 'Admin Project';

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

/** "Add people": search and tick several users, choose one project role for all of them. */
function AddPeopleModal({ space, roles, onAdd, onClose }) {
  const [users, setUsers] = useState(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState([]); // user ids
  const [role, setRole] = useState(() => roles.find((item) => item.name === 'Developer')?.name || roles[0]?.name || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api.getUsers()
      .then((rows) => { if (active) setUsers(rows); })
      .catch((loadError) => { if (active) { setUsers([]); setError(loadError.message); } });
    return () => { active = false; };
  }, []);

  const memberIds = useMemo(() => new Set((space.members || []).map((member) => String(member.userId || member.id))), [space.members]);
  const candidates = (users || []).filter((user) => !memberIds.has(String(user.id)));
  const needle = query.trim().toLowerCase();
  const matches = candidates.filter((user) => !needle || `${user.fullName} ${user.username} ${user.email}`.toLowerCase().includes(needle));
  const byId = new Map(candidates.map((user) => [user.id, user]));
  const toggle = (id) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  const allMatchesSelected = matches.length > 0 && matches.every((user) => selected.includes(user.id));

  async function submit() {
    if (!selected.length) return setError('Choose at least one person.');
    if (!role) return setError('Choose a project role.');
    setSaving(true);
    setError('');
    const message = await onAdd({ userIds: selected, roles: [role] });
    setSaving(false);
    if (message) return setError(message);
    onClose(selected.length);
  }

  return (
    <SettingsModal
      title="Add people"
      onClose={() => onClose(0)}
      onSubmit={submit}
      footer={<>
        {error && <span className="ss-form-error" role="alert">{error}</span>}
        <button type="button" className="ss-button" onClick={() => onClose(0)}>Cancel</button>
        <button type="submit" className="ss-button is-primary" disabled={saving || !selected.length || !role}>
          {saving ? 'Adding…' : selected.length ? `Add ${selected.length} ${selected.length === 1 ? 'person' : 'people'}` : 'Add'}
        </button>
      </>}
    >
      <div className="sp-people-form">
        <div className="sp-field">
          <span>People <b className="sp-required">*</b></span>
          {selected.length > 0 && (
            <div className="sp-chips" aria-label="Selected people">
              {selected.map((id) => (
                <span className="sp-chip" key={id}>
                  <UserAvatar user={byId.get(id)} size={20} />
                  {byId.get(id)?.fullName || id}
                  <button type="button" onClick={() => toggle(id)} aria-label={`Remove ${byId.get(id)?.fullName || 'person'}`}><Icon name="close" size={11} /></button>
                </span>
              ))}
            </div>
          )}
          <label className="sp-user-search">
            <Icon name="search" size={14} />
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, username or email" aria-label="Search people" />
          </label>
          <div className="sp-user-list" role="listbox" aria-multiselectable="true" aria-label="People who are not in the project yet">
            {users === null && <div className="sp-user-empty">Loading people…</div>}
            {users !== null && !candidates.length && <div className="sp-user-empty">Everyone is already a member of this project.</div>}
            {users !== null && candidates.length > 0 && !matches.length && <div className="sp-user-empty">No people match “{query}”.</div>}
            {matches.length > 1 && (
              <label className="sp-user-option is-all">
                <input type="checkbox" checked={allMatchesSelected} onChange={() => setSelected((current) => (allMatchesSelected
                  ? current.filter((id) => !matches.some((user) => user.id === id))
                  : [...new Set([...current, ...matches.map((user) => user.id)])]))} />
                <span>Select all {needle ? 'matches' : 'people'} ({matches.length})</span>
              </label>
            )}
            {matches.map((user) => (
              <label key={user.id} className={`sp-user-option ${selected.includes(user.id) ? 'is-selected' : ''}`} role="option" aria-selected={selected.includes(user.id)}>
                <input type="checkbox" checked={selected.includes(user.id)} onChange={() => toggle(user.id)} />
                <UserAvatar user={user} size={28} />
                <span className="sp-user-text">
                  <strong>{user.fullName || user.username}</strong>
                  <small>@{user.username}{user.email ? ` · ${user.email}` : ''}</small>
                </span>
              </label>
            ))}
          </div>
        </div>
        <label className="sp-field">
          <span>Project role <b className="sp-required">*</b></span>
          <select value={role} onChange={(event) => setRole(event.target.value)} aria-label="Project role">
            {roles.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
          </select>
          <small className="sp-hint">{roles.find((item) => item.name === role)?.description || 'Every selected person gets this role. You can change roles per person later.'}</small>
        </label>
      </div>
    </SettingsModal>
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

export function PeopleSettings({ space, onAddMember, onAddMembers, onRemoveMember }) {
  const members = Array.isArray(space.members) ? space.members : [];
  const { can, isProjectAdmin } = useProjectPermissions(space);
  const canManage = can('project.setting');
  const { roles, error: rolesError } = useProjectRoles(isProjectAdmin);
  const [confirm, setConfirm] = useState(null);
  const [notice, setNotice] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [added, setAdded] = useState(0);

  // Legacy members (created before accounts were linked) have no real user id.
  const linked = (member) => Boolean(member.userId || member.username || member.email);

  return (
    <section className="settings-secondary-content">
      <div className="settings-content-heading">
        <h1>People</h1>
        <p>{canManage ? 'People in this project and their project roles. Only members can see the project.' : 'People who have access to this project. Only people with the Project Setting permission can change members.'}</p>
      </div>

      <div className="settings-section-card sp-card">
        <div className="settings-section-card-header">
          <strong>Project members <span className="sp-count">{members.length}</span></strong>
          {canManage && (
            <button type="button" className="sp-button is-primary" onClick={() => setAddOpen(true)} disabled={roles === null}>
              <Icon name="plus" size={14} /> Add people
            </button>
          )}
        </div>
        {added > 0 && <p className="sp-success sp-pad" role="status">{added} {added === 1 ? 'person was' : 'people were'} added to the project.</p>}
        {rolesError && <p className="sp-error sp-pad" role="alert">{rolesError}</p>}
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

      {addOpen && roles && (
        <AddPeopleModal
          space={space}
          roles={roles}
          onAdd={onAddMembers}
          onClose={(count) => { setAddOpen(false); if (count) setAdded(count); }}
        />
      )}

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
