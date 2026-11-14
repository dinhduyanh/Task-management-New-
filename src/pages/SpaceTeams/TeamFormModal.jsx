import { useEffect, useMemo, useState } from 'react';
import Icon from '../../components/common/Icon';
import UserAvatar from '../../components/common/UserAvatar';

const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/;

function initialMembers(team) {
  const map = new Map();
  (team?.members || []).forEach((member) => map.set(String(member.id), member.role === 'lead' ? 'lead' : 'member'));
  return map;
}

/**
 * Create or edit a project team on one screen: general information and members.
 * onSubmit(values) resolves to an error message, or '' when saved.
 */
export default function TeamFormModal({ team = null, users = [], usersError = '', unitOptions = [], onClose, onSubmit }) {
  const editing = Boolean(team);
  const [code, setCode] = useState(team?.code || '');
  const [name, setName] = useState(team?.name || '');
  const [unit, setUnit] = useState(team?.unit || '');
  const [description, setDescription] = useState(team?.description || '');
  const [members, setMembers] = useState(() => initialMembers(team)); // userId -> 'lead' | 'member'
  const [query, setQuery] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const leadId = [...members].find(([, role]) => role === 'lead')?.[0] || null;
  const leadUser = users.find((user) => String(user.id) === leadId);

  const visibleUsers = useMemo(() => {
    const text = query.trim().toLowerCase();
    return users.filter((user) => {
      if (selectedOnly && !members.has(String(user.id))) return false;
      if (!text) return true;
      return [user.fullName, user.username, user.email].some((value) => String(value || '').toLowerCase().includes(text));
    });
  }, [users, query, selectedOnly, members]);

  const fieldErrors = {
    code: !code.trim() ? 'Code is required.' : !CODE_RE.test(code.trim()) ? 'Use 1-20 letters, numbers, "-" or "_".' : '',
    name: !name.trim() ? 'Name is required.' : '',
    members: !members.size ? 'Select at least one member.' : !leadId ? 'Choose a team lead.' : ''
  };
  const invalid = Object.values(fieldErrors).some(Boolean);
  const dirty = code !== (team?.code || '') || name !== (team?.name || '') || unit !== (team?.unit || '') ||
    description !== (team?.description || '') ||
    JSON.stringify([...members].sort()) !== JSON.stringify([...initialMembers(team)].sort());

  function requestClose() {
    if (dirty && !saving && !window.confirm('Discard the changes to this team?')) return;
    onClose();
  }

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && !event.defaultPrevented) requestClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  function toggleMember(userId) {
    setMembers((current) => {
      const next = new Map(current);
      if (next.has(userId)) {
        const wasLead = next.get(userId) === 'lead';
        next.delete(userId);
        // Keep a lead: hand it to the first remaining member.
        if (wasLead && next.size) next.set(next.keys().next().value, 'lead');
      } else {
        next.set(userId, next.size === 0 ? 'lead' : 'member');
      }
      return next;
    });
  }

  function makeLead(userId) {
    setMembers((current) => {
      const next = new Map();
      current.forEach((role, id) => next.set(id, 'member'));
      next.set(userId, 'lead');
      return next;
    });
  }

  function toggleAllVisible(checked) {
    setMembers((current) => {
      const next = new Map(current);
      visibleUsers.forEach((user) => {
        const id = String(user.id);
        if (checked && !next.has(id)) next.set(id, next.size === 0 ? 'lead' : 'member');
        if (!checked && next.has(id)) next.delete(id);
      });
      if (next.size && ![...next.values()].includes('lead')) next.set(next.keys().next().value, 'lead');
      return next;
    });
  }

  async function submit(event) {
    event.preventDefault();
    setTouched(true);
    if (invalid) return;
    setSaving(true);
    setError('');
    const message = await onSubmit({
      code: code.trim().toUpperCase(),
      name: name.trim(),
      unit: unit.trim(),
      description: description.trim(),
      members: [...members].map(([userId, role]) => ({ userId, role }))
    });
    setSaving(false);
    if (message) setError(message);
    else onClose();
  }

  const visibleSelected = visibleUsers.filter((user) => members.has(String(user.id))).length;
  const allVisibleSelected = visibleUsers.length > 0 && visibleSelected === visibleUsers.length;

  return (
    <div className="tm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <form className="tm-modal" role="dialog" aria-modal="true" aria-labelledby="tm-title" onSubmit={submit} noValidate>
        <header className="tm-head">
          <h2 id="tm-title">User team information</h2>
          <button type="button" className="tm-icon-button" onClick={requestClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </header>

        <div className="tm-body">
          <section className="tm-section" aria-labelledby="tm-general">
            <h3 id="tm-general">General information</h3>
            <div className="tm-grid">
              <label className="tm-field">
                <span>Code <b aria-hidden="true">*</b></span>
                <input
                  value={code}
                  maxLength={20}
                  autoFocus={!editing}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  aria-invalid={touched && Boolean(fieldErrors.code)}
                  placeholder="e.g. TEAM-A"
                />
                {touched && fieldErrors.code && <small className="tm-error-text">{fieldErrors.code}</small>}
              </label>
              <label className="tm-field tm-wide">
                <span>Name <b aria-hidden="true">*</b></span>
                <input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} aria-invalid={touched && Boolean(fieldErrors.name)} placeholder="Team name" />
                {touched && fieldErrors.name && <small className="tm-error-text">{fieldErrors.name}</small>}
              </label>
              <label className="tm-field tm-full">
                <span>Unit</span>
                <input value={unit} maxLength={100} list="tm-unit-options" onChange={(event) => setUnit(event.target.value)} placeholder="Select or type a unit" />
                <datalist id="tm-unit-options">
                  {unitOptions.map((option) => <option key={option} value={option} />)}
                </datalist>
              </label>
              <label className="tm-field tm-full">
                <span>Description</span>
                <textarea rows={3} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} />
              </label>
            </div>
          </section>

          <section className="tm-section" aria-labelledby="tm-members">
            <div className="tm-members-head">
              <h3 id="tm-members">Members</h3>
              <span className="tm-members-summary">
                {members.size} selected{leadUser ? <> · Team lead: <strong>{leadUser.fullName || leadUser.username}</strong></> : ''}
              </span>
            </div>
            <div className="tm-members-tools">
              <div className="tm-search">
                <Icon name="search" size={14} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search users by name, username or email" aria-label="Search users" />
              </div>
              <label className="tm-check-label">
                <input type="checkbox" checked={selectedOnly} onChange={(event) => setSelectedOnly(event.target.checked)} /> Selected only
              </label>
            </div>

            <div className="tm-table" role="table" aria-label="Users">
              <div className="tm-row tm-row-head" role="row">
                <span role="columnheader">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    disabled={!visibleUsers.length}
                    ref={(node) => { if (node) node.indeterminate = visibleSelected > 0 && !allVisibleSelected; }}
                    onChange={(event) => toggleAllVisible(event.target.checked)}
                    aria-label="Select all listed users"
                  />
                </span>
                <span role="columnheader">Member</span>
                <span role="columnheader">Role</span>
              </div>
              {visibleUsers.map((user) => {
                const id = String(user.id);
                const role = members.get(id);
                return (
                  <div key={id} className={`tm-row ${role ? 'is-selected' : ''}`} role="row">
                    <span role="cell">
                      <input type="checkbox" checked={Boolean(role)} onChange={() => toggleMember(id)} aria-label={`Add ${user.fullName || user.username} to the team`} />
                    </span>
                    <span role="cell" className="tm-user" onClick={() => toggleMember(id)}>
                      <UserAvatar user={user} size={30} />
                      <span>
                        <strong>{user.fullName || user.username}</strong>
                        <small>{user.username}{user.email ? ` · ${user.email}` : ''}</small>
                      </span>
                    </span>
                    <span role="cell">
                      {role ? (
                        <span className="tm-role" role="radiogroup" aria-label={`Role of ${user.fullName || user.username}`}>
                          <button type="button" role="radio" aria-checked={role === 'member'} className={role === 'member' ? 'active' : ''} disabled={role === 'lead'} title={role === 'lead' ? 'Choose another team lead to change this role' : undefined}>Member</button>
                          <button type="button" role="radio" aria-checked={role === 'lead'} className={role === 'lead' ? 'active is-lead' : ''} onClick={() => makeLead(id)}>Team lead</button>
                        </span>
                      ) : <span className="tm-muted">Not in team</span>}
                    </span>
                  </div>
                );
              })}
              {!visibleUsers.length && (
                <div className="tm-empty">
                  {usersError || (users.length ? 'No users match your search.' : 'No users found.')}
                </div>
              )}
            </div>
            {touched && fieldErrors.members && <p className="tm-error-text">{fieldErrors.members}</p>}
          </section>
        </div>

        <footer className="tm-foot">
          {error && <span className="tm-error" role="alert">{error}</span>}
          <button type="button" className="tm-btn secondary" onClick={requestClose}>Cancel</button>
          <button type="submit" className="tm-btn primary" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Confirm & Create'}
          </button>
        </footer>
      </form>
    </div>
  );
}
