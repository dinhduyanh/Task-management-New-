import { useEffect, useRef, useState } from 'react';
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

/** Matching users (not yet in the project) for the "Add people" search, fetched as the user types. */
function useCandidateSearch(spaceId, query) {
  const [state, setState] = useState({ query: '', results: [], error: '' });
  const needle = query.trim();
  useEffect(() => {
    if (!needle) return undefined;
    let active = true;
    const timer = setTimeout(() => {
      api.searchMemberCandidates(spaceId, needle)
        .then((rows) => { if (active) setState({ query: needle, results: rows || [], error: '' }); })
        .catch((loadError) => { if (active) setState({ query: needle, results: [], error: loadError.message }); });
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [spaceId, needle]);
  const loading = Boolean(needle) && state.query !== needle;
  return { results: needle && !loading ? state.results : [], loading, error: needle ? state.error : '' };
}

/** "Add people": find people by typing (autocomplete), pick several as chips, tick one or more roles. */
function AddPeopleModal({ space, roles, onAdd, onClose }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState([]); // user objects
  const [chosenRoles, setChosenRoles] = useState(() => {
    const preferred = roles.find((item) => item.name === 'Developer') || roles[0];
    return preferred ? [preferred.name] : [];
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);
  const { results, loading, error: searchError } = useCandidateSearch(space.id, query);
  const options = results.filter((user) => !selected.some((item) => item.id === user.id));
  const showDropdown = open && query.trim().length > 0;
  const activeIndex = Math.min(active, Math.max(options.length - 1, 0));

  function pick(user) {
    setSelected((current) => [...current, user]);
    setQuery('');
    setActive(0);
    setError('');
    inputRef.current?.focus();
  }

  function unpick(id) {
    setSelected((current) => current.filter((user) => user.id !== id));
    inputRef.current?.focus();
  }

  function toggleRole(name) {
    setChosenRoles((current) => (current.includes(name) ? current.filter((role) => role !== name) : [...current, name]));
    setError('');
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive((index) => Math.min(index + 1, options.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
    else if (event.key === 'Enter') {
      event.preventDefault(); // never submit the form from the search box
      if (showDropdown && options[activeIndex]) pick(options[activeIndex]);
    } else if (event.key === 'Escape' && showDropdown) {
      event.preventDefault(); // close the list, not the dialog
      setOpen(false);
    } else if (event.key === 'Backspace' && !query && selected.length) {
      setSelected((current) => current.slice(0, -1));
    }
  }

  async function submit() {
    if (!selected.length) return setError('Choose at least one person.');
    if (!chosenRoles.length) return setError('Choose at least one project role.');
    setSaving(true);
    setError('');
    const message = await onAdd({ userIds: selected.map((user) => user.id), roles: chosenRoles });
    setSaving(false);
    if (message) return setError(message);
    onClose(selected.length);
  }

  const listId = 'sp-people-options';
  return (
    <SettingsModal
      title="Add people"
      onClose={() => onClose(0)}
      onSubmit={submit}
      footer={<>
        {error && <span className="ss-form-error" role="alert">{error}</span>}
        <button type="button" className="ss-button" onClick={() => onClose(0)}>Cancel</button>
        <button type="submit" className="ss-button is-primary" disabled={saving || !selected.length || !chosenRoles.length}>
          {saving ? 'Adding…' : selected.length ? `Add ${selected.length} ${selected.length === 1 ? 'person' : 'people'}` : 'Add'}
        </button>
      </>}
    >
      <div className="sp-people-form">
        <div className="sp-field">
          <span id="sp-people-label">People <b className="sp-required">*</b></span>
          <div className="sp-combo">
            <div className={`sp-tag-input ${showDropdown ? 'is-open' : ''}`} onMouseDown={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); inputRef.current?.focus(); } }}>
              <Icon name="search" size={14} />
              {selected.map((user) => (
                <span className="sp-chip" key={user.id}>
                  <UserAvatar user={user} size={20} />
                  <span className="sp-chip-name">{user.fullName || user.username}</span>
                  <button type="button" onClick={() => unpick(user.id)} aria-label={`Remove ${user.fullName || user.username}`}><Icon name="close" size={11} /></button>
                </span>
              ))}
              <input
                ref={inputRef}
                autoFocus
                value={query}
                onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(0); }}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
                onKeyDown={onKeyDown}
                placeholder={selected.length ? 'Add more people…' : 'Search by name, username or email'}
                role="combobox"
                aria-labelledby="sp-people-label"
                aria-autocomplete="list"
                aria-expanded={showDropdown}
                aria-controls={listId}
                aria-activedescendant={showDropdown && options[activeIndex] ? `sp-opt-${options[activeIndex].id}` : undefined}
              />
            </div>
            {showDropdown && (
              <ul className="sp-dropdown" id={listId} role="listbox" aria-label="Matching people" onMouseDown={(event) => event.preventDefault()}>
                {loading && <li className="sp-dropdown-status"><span className="sp-spinner" aria-hidden="true" /> Searching…</li>}
                {!loading && searchError && <li className="sp-dropdown-status is-error">{searchError}</li>}
                {!loading && !searchError && !options.length && (
                  <li className="sp-dropdown-status is-empty" role="status">
                    <Icon name="user" size={16} />
                    <span><strong>User not found</strong><small>No one outside this project matches “{query.trim()}”.</small></span>
                  </li>
                )}
                {!loading && options.map((user, index) => (
                  <li
                    key={user.id}
                    id={`sp-opt-${user.id}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    className={`sp-dropdown-option ${index === activeIndex ? 'is-active' : ''}`}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => pick(user)}
                  >
                    <UserAvatar user={user} size={28} />
                    <span className="sp-user-text">
                      <strong>{user.fullName || user.username}</strong>
                      <small>@{user.username}{user.email ? ` · ${user.email}` : ''}</small>
                    </span>
                    <Icon name="plus" size={14} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <small className="sp-hint">{selected.length ? `${selected.length} selected. ` : ''}Type to find people who are not in this project yet.</small>
        </div>

        <fieldset className="sp-field sp-role-fieldset">
          <legend>Project roles <b className="sp-required">*</b> <small>{chosenRoles.length} selected</small></legend>
          <div className="sp-role-options">
            {roles.map((item) => {
              const checked = chosenRoles.includes(item.name);
              return (
                <label key={item.id} className={`sp-role-option ${checked ? 'is-checked' : ''}`}>
                  <input type="checkbox" checked={checked} onChange={() => toggleRole(item.name)} />
                  <span className="sp-role-option-text">
                    <strong>{item.name}</strong>
                    <small>{item.description || 'Custom project role.'}</small>
                  </span>
                </label>
              );
            })}
          </div>
          <small className="sp-hint">Every person you add gets all ticked roles. You can change roles per person later.</small>
        </fieldset>
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
