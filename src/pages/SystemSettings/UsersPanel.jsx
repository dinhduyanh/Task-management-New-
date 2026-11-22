import { useEffect, useMemo, useState } from 'react';
import Icon from '../../components/common/Icon';
import UserAvatar from '../../components/common/UserAvatar';
import { useAppShell } from '../../context/appShellContext';
import { api } from '../../services/api';
import { PASSWORD_RULES, isStrongPassword } from '../../services/userProfileService';
import MenuButton from '../SpaceBacklog/MenuButton';
import SettingsModal from './SettingsModal';

const PASSWORD_NOTE = 'At least 6 characters and include uppercase letters, lowercase letters, numbers, and at least one special character.';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[A-Za-z0-9._-]{3,40}$/;

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (number) => String(number).padStart(2, '0');
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
}

function PasswordInput({ id, value, onChange, label }) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="ss-password">
      <input id={id} type={visible ? 'text' : 'password'} autoComplete="new-password" value={value} onChange={(event) => onChange(event.target.value)} />
      <button type="button" onClick={() => setVisible((current) => !current)} aria-label={visible ? `Hide ${label}` : `Show ${label}`} aria-pressed={visible}>
        <Icon name={visible ? 'eyeOff' : 'eye'} size={16} />
      </button>
    </span>
  );
}

function RoleChoice({ value, onChange, disabled = false, disabledReason = '' }) {
  return (
    <div className="ss-role-choice" role="radiogroup" aria-label="System role" title={disabled ? disabledReason : undefined}>
      {[['user', 'User', 'Sees only the projects they create or are added to.'], ['admin', 'Admin', 'Sees and edits every project; manages system settings.']].map(([role, label, hint]) => (
        <label key={role} className={`${value === role ? 'active' : ''} ${disabled ? 'is-disabled' : ''}`}>
          <input type="radio" name="system-role" value={role} checked={value === role} disabled={disabled} onChange={() => onChange(role)} />
          <span><strong>{label}</strong><small>{hint}</small></span>
        </label>
      ))}
    </div>
  );
}

function UserFormModal({ user = null, isSelf = false, onClose, onSaved }) {
  const editing = Boolean(user);
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [username, setUsername] = useState(user?.username || '');
  const [email, setEmail] = useState(user?.email || '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [role, setRole] = useState(user?.role || 'user');
  const [isActive, setIsActive] = useState(user ? user.isActive : true);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const errors = {
    fullName: !fullName.trim() ? 'Full name is required.' : '',
    username: !editing && !USERNAME_RE.test(username.trim()) ? 'Use 3-40 letters, numbers, ".", "_" or "-".' : '',
    email: !EMAIL_RE.test(email.trim()) ? 'Enter a valid email address.' : '',
    password: !editing && !isStrongPassword(password) ? 'The password does not meet the requirements.' : '',
    confirm: !editing && confirm !== password ? 'Passwords do not match.' : ''
  };
  const invalid = Object.values(errors).some(Boolean);

  async function save() {
    setTouched(true);
    if (invalid) return;
    setSaving(true);
    setError('');
    try {
      const saved = editing
        ? await api.admin.updateUser(user.id, { fullName: fullName.trim(), email: email.trim(), ...(isSelf ? {} : { role, isActive }) })
        : await api.admin.createUser({ fullName: fullName.trim(), username: username.trim(), email: email.trim(), password, role });
      onSaved(saved, editing);
      onClose();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  const field = (key) => touched && errors[key] ? <small className="ss-field-error">{errors[key]}</small> : null;
  return (
    <SettingsModal
      title={editing ? `Edit ${user.fullName || user.username}` : 'Add user'}
      onClose={onClose}
      onSubmit={save}
      footer={<>
        {error && <span className="ss-form-error" role="alert">{error}</span>}
        <button type="button" className="ss-button" onClick={onClose}>Cancel</button>
        <button type="submit" className="ss-button is-primary" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create user'}</button>
      </>}
    >
      <div className="ss-form-grid">
        <label className="ss-field ss-span-2">
          <span>Full name <b>*</b></span>
          <input value={fullName} maxLength={120} autoFocus onChange={(event) => setFullName(event.target.value)} aria-invalid={touched && Boolean(errors.fullName)} />
          {field('fullName')}
        </label>
        <label className="ss-field">
          <span>Username {!editing && <b>*</b>}</span>
          <input value={username} maxLength={40} readOnly={editing} onChange={(event) => setUsername(event.target.value)} aria-invalid={touched && Boolean(errors.username)} autoComplete="off" />
          {editing ? <small className="ss-hint">Usernames cannot be changed.</small> : field('username')}
        </label>
        <label className="ss-field">
          <span>Email <b>*</b></span>
          <input type="email" value={email} maxLength={160} onChange={(event) => setEmail(event.target.value)} aria-invalid={touched && Boolean(errors.email)} autoComplete="off" />
          {field('email')}
        </label>
        {!editing && (
          <>
            <label className="ss-field">
              <span>Password <b>*</b></span>
              <PasswordInput id="ss-new-password" value={password} onChange={setPassword} label="password" />
              {field('password')}
            </label>
            <label className="ss-field">
              <span>Confirm password <b>*</b></span>
              <PasswordInput id="ss-confirm-password" value={confirm} onChange={setConfirm} label="password confirmation" />
              {field('confirm')}
            </label>
            <div className="ss-span-2 ss-password-rules">
              <small>{PASSWORD_NOTE}</small>
              {password && (
                <ul>
                  {PASSWORD_RULES.map((rule) => <li key={rule.id} className={rule.test(password) ? 'met' : ''}><Icon name={rule.test(password) ? 'check' : 'close'} size={12} />{rule.label}</li>)}
                </ul>
              )}
            </div>
          </>
        )}
        <div className="ss-field ss-span-2">
          <span>System role</span>
          <RoleChoice value={role} onChange={setRole} disabled={isSelf} disabledReason="You cannot change your own role." />
          {isSelf && <small className="ss-hint">You cannot change your own role or deactivate your own account.</small>}
        </div>
        {editing && !isSelf && (
          <label className="ss-check ss-span-2">
            <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
            <span><strong>Account is active</strong><small>Inactive accounts cannot sign in and are signed out immediately.</small></span>
          </label>
        )}
      </div>
    </SettingsModal>
  );
}

function ResetPasswordModal({ user, onClose, onDone }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!isStrongPassword(password)) return setError('The password does not meet the requirements.');
    if (password !== confirm) return setError('Passwords do not match.');
    setSaving(true);
    try {
      await api.admin.resetPassword(user.id, password);
      onDone();
      onClose();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsModal
      title={`Reset password for ${user.fullName || user.username}`}
      onClose={onClose}
      onSubmit={save}
      footer={<>
        {error && <span className="ss-form-error" role="alert">{error}</span>}
        <button type="button" className="ss-button" onClick={onClose}>Cancel</button>
        <button type="submit" className="ss-button is-primary" disabled={saving}>{saving ? 'Saving…' : 'Set password'}</button>
      </>}
    >
      <div className="ss-form-grid">
        <label className="ss-field"><span>New password</span><PasswordInput id="ss-reset-password" value={password} onChange={setPassword} label="new password" /></label>
        <label className="ss-field"><span>Confirm password</span><PasswordInput id="ss-reset-confirm" value={confirm} onChange={setConfirm} label="password confirmation" /></label>
        <small className="ss-hint ss-span-2">{PASSWORD_NOTE} The user is signed out of all sessions.</small>
      </div>
    </SettingsModal>
  );
}

export default function UsersPanel({ onToast }) {
  const { user: currentUser } = useAppShell();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [form, setForm] = useState(null); // { user } (null user = add)
  const [resetFor, setResetFor] = useState(null);

  useEffect(() => {
    let active = true;
    api.admin.getUsers()
      .then((rows) => { if (active) { setUsers(rows); setError(''); } })
      .catch((loadError) => { if (active) setError(loadError.message); });
    return () => { active = false; };
  }, [reloadKey]);

  const list = useMemo(() => users || [], [users]);
  const shown = useMemo(() => {
    const text = search.trim().toLowerCase();
    return list.filter((user) => {
      if (text && ![user.fullName, user.username, user.email].some((value) => String(value || '').toLowerCase().includes(text))) return false;
      if (roleFilter !== 'all' && user.role !== roleFilter) return false;
      if (statusFilter === 'active' && !user.isActive) return false;
      if (statusFilter === 'inactive' && user.isActive) return false;
      return true;
    });
  }, [list, search, roleFilter, statusFilter]);
  const adminCount = list.filter((user) => user.role === 'admin' && user.isActive).length;

  function replace(saved) {
    setUsers((current) => {
      const exists = (current || []).some((user) => user.id === saved.id);
      return exists ? current.map((user) => (user.id === saved.id ? saved : user)) : [...(current || []), saved];
    });
  }

  async function quickUpdate(user, changes, message) {
    try {
      replace(await api.admin.updateUser(user.id, changes));
      onToast({ type: 'success', message });
    } catch (updateError) {
      onToast({ type: 'error', message: updateError.message });
    }
  }

  return (
    <>
      <div className="ss-panel-head">
        <div>
          <h2>User Management</h2>
          <p>{list.length} account{list.length === 1 ? '' : 's'} · {adminCount} active admin{adminCount === 1 ? '' : 's'}. Admins see every project; users only see projects they create or are added to.</p>
        </div>
        <button type="button" className="ss-button is-primary" onClick={() => setForm({ user: null })}><Icon name="plus" size={15} /> Add user</button>
      </div>

      <div className="ss-toolbar">
        <div className="slv-search">
          <Icon name="search" size={15} />
          <input placeholder="Search name, username or email" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search users" />
        </div>
        <label className="ss-select"><span>Role</span>
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            <option value="all">All</option><option value="admin">Admin</option><option value="user">User</option>
          </select>
        </label>
        <label className="ss-select"><span>Status</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option>
          </select>
        </label>
      </div>

      <div className="ss-card">
        <div className="ss-scroll">
          <table className="ss-table">
            <thead>
              <tr><th>User</th><th>Email</th><th>System role</th><th>Status</th><th className="ss-num">Projects</th><th>Created</th><th className="ss-actions"><span className="ss-visually-hidden">Actions</span></th></tr>
            </thead>
            <tbody>
              {shown.map((user) => {
                const isSelf = user.id === currentUser?.id;
                return (
                  <tr key={user.id} className={user.isActive ? '' : 'is-inactive'}>
                    <td>
                      <span className="ss-user">
                        <UserAvatar user={user} size={30} />
                        <span><strong>{user.fullName}{isSelf && <em> (you)</em>}</strong><small>@{user.username}</small></span>
                      </span>
                    </td>
                    <td className="ss-email">{user.email}</td>
                    <td>
                      <select
                        className={`ss-role-select is-${user.role}`}
                        value={user.role}
                        disabled={isSelf}
                        title={isSelf ? 'You cannot change your own role.' : undefined}
                        aria-label={`System role of ${user.fullName}`}
                        onChange={(event) => quickUpdate(user, { role: event.target.value }, `${user.fullName} is now ${event.target.value === 'admin' ? 'an admin' : 'a user'}.`)}
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td><span className={`ss-status ${user.isActive ? 'is-active' : 'is-inactive'}`}>{user.isActive ? 'Active' : 'Inactive'}</span></td>
                    <td className="ss-num">{user.projectCount}</td>
                    <td className="ss-date">{formatDate(user.createdAt)}</td>
                    <td className="ss-actions">
                      <MenuButton
                        label={`Actions for ${user.fullName}`}
                        icon="moreVertical"
                        items={[
                          { label: 'Edit user', onSelect: () => setForm({ user }) },
                          { label: 'Reset password', onSelect: () => setResetFor(user) },
                          isSelf ? null : user.isActive
                            ? { label: 'Deactivate', danger: true, onSelect: () => quickUpdate(user, { isActive: false }, `${user.fullName} was deactivated and signed out.`) }
                            : { label: 'Activate', onSelect: () => quickUpdate(user, { isActive: true }, `${user.fullName} can sign in again.`) }
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
              {users !== null && !shown.length && <tr><td colSpan={7} className="ss-empty">No users match your filters.</td></tr>}
              {users === null && (
                <tr><td colSpan={7} className="ss-empty">{error ? <>{error} <button type="button" className="ss-link" onClick={() => setReloadKey((value) => value + 1)}>Retry</button></> : 'Loading users…'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {form && (
        <UserFormModal
          user={form.user}
          isSelf={form.user?.id === currentUser?.id}
          onClose={() => setForm(null)}
          onSaved={(saved, editing) => { replace(saved); onToast({ type: 'success', message: `${saved.fullName} ${editing ? 'updated' : 'created'}.` }); }}
        />
      )}
      {resetFor && (
        <ResetPasswordModal
          user={resetFor}
          onClose={() => setResetFor(null)}
          onDone={() => onToast({ type: 'success', message: `Password reset for ${resetFor.fullName}.` })}
        />
      )}
    </>
  );
}
