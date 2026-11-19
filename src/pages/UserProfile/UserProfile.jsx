import { useRef, useState } from 'react';
import Header from '../../components/layout/Header';
import Sidebar from '../../components/layout/Sidebar';
import Icon from '../../components/common/Icon';
import UserAvatar from '../../components/common/UserAvatar';
import {
  AVATAR_MIME_TYPES,
  PASSWORD_RULES,
  isStrongPassword,
  userProfileService,
  validateAvatarFile
} from '../../services/userProfileService';
import './UserProfile.css';

const PASSWORD_NOTE = 'At least 6 characters and include uppercase letters, lowercase letters, numbers, and at least one special character.';

function Feedback({ state }) {
  if (!state?.message) return null;
  return (
    <p className={`tf-alert ${state.type === 'error' ? 'tf-error' : 'tf-success'}`} role={state.type === 'error' ? 'alert' : 'status'}>
      {state.message}
    </p>
  );
}

function PasswordField({ id, label, value, onChange, autoComplete, revealable = false, invalid = false, describedBy }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="tf-field">
      <label htmlFor={id}>{label}</label>
      <span className="tf-password-input">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
        />
        {revealable && (
          <button
            type="button"
            onClick={() => setVisible((current) => !current)}
            aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
            aria-pressed={visible}
          >
            <Icon name={visible ? 'eyeOff' : 'eye'} size={17} />
          </button>
        )}
      </span>
    </div>
  );
}

function isUnauthorized(error) {
  return error?.status === 401;
}

export default function UserProfile({
  user,
  onUserUpdated = () => {},
  onPasswordChanged = () => {},
  onSessionExpired = () => {},
  onBack = () => {},
  spaces = [],
  tasks = [],
  onGlobalCreate,
  onOpenTask,
  onNavigate,
  onCreateSpace,
  onOpenSpaceSettings,
  onDeleteSpace
}) {
  const fileInputRef = useRef(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarFeedback, setAvatarFeedback] = useState(null);

  const savedFullName = user?.fullName || '';
  // null = untouched, so the field keeps showing the latest saved value.
  const [draftFullName, setDraftFullName] = useState(null);
  const fullName = draftFullName ?? savedFullName;
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountFeedback, setAccountFeedback] = useState(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState(null);

  function handleRequestError(error, setFeedback) {
    if (isUnauthorized(error)) {
      onSessionExpired();
      return;
    }
    setFeedback({ type: 'error', message: error?.message || 'Something went wrong. Please try again.' });
  }

  async function handleAvatarChange(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const validationError = validateAvatarFile(file);
    if (validationError) {
      setAvatarFeedback({ type: 'error', message: validationError });
      return;
    }

    setAvatarBusy(true);
    setAvatarFeedback(null);
    try {
      const updated = await userProfileService.uploadAvatar(file);
      onUserUpdated({ ...user, ...updated });
      setAvatarFeedback({ type: 'success', message: 'Profile picture updated.' });
    } catch (error) {
      handleRequestError(error, setAvatarFeedback);
    } finally {
      setAvatarBusy(false);
    }
  }

  const trimmedFullName = fullName.trim();
  const fullNameChanged = trimmedFullName !== savedFullName.trim();

  async function handleSaveAccount(event) {
    event.preventDefault();
    if (!trimmedFullName) {
      setAccountFeedback({ type: 'error', message: 'Full name is required.' });
      return;
    }
    if (!fullNameChanged) return;

    setAccountBusy(true);
    setAccountFeedback(null);
    try {
      const updated = await userProfileService.updateFullName(trimmedFullName);
      onUserUpdated(updated);
      setDraftFullName(null);
      setAccountFeedback({ type: 'success', message: 'Full name saved.' });
    } catch (error) {
      handleRequestError(error, setAccountFeedback);
    } finally {
      setAccountBusy(false);
    }
  }

  const confirmMismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;

  async function handleChangePassword(event) {
    event.preventDefault();
    setPasswordFeedback(null);

    let message = '';
    if (!currentPassword || !newPassword || !confirmPassword) message = 'Please fill in all password fields.';
    else if (!isStrongPassword(newPassword)) message = `New password is too weak. ${PASSWORD_NOTE}`;
    else if (newPassword !== confirmPassword) message = 'New password and confirmation do not match.';
    else if (newPassword === currentPassword) message = 'New password must be different from the current password.';
    if (message) {
      setPasswordFeedback({ type: 'error', message });
      return;
    }

    setPasswordBusy(true);
    try {
      await userProfileService.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      // The server revokes every session after a password change.
      onPasswordChanged();
    } catch (error) {
      // A wrong current password is a 400, not a session problem.
      handleRequestError(error, setPasswordFeedback);
    } finally {
      setPasswordBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <Header spaces={spaces} tasks={tasks} onGlobalCreate={onGlobalCreate} onOpenTask={onOpenTask} />
      <Sidebar
        activeSection=""
        spaces={spaces}
        onNavigate={onNavigate}
        onCreateSpace={onCreateSpace}
        onOpenSpaceSettings={onOpenSpaceSettings}
        onDeleteSpace={onDeleteSpace}
      />

      <main className="main-content">
        <div className="tf-profile-page">
          <div className="tf-profile-heading">
            <button type="button" className="tf-back" onClick={onBack}>
              <Icon name="arrowLeft" size={16} />
              Back
            </button>
            <h1>Your profile</h1>
            <p>Manage your personal information and account security.</p>
          </div>

          <section className="tf-profile-card" aria-labelledby="profile-picture-title">
            <h2 id="profile-picture-title">PROFILE PICTURE</h2>
            <div className="tf-avatar-editor">
              <UserAvatar user={user} size={84} className="tf-avatar-large" />
              <div className="tf-avatar-actions">
                <button
                  type="button"
                  className="tf-secondary-button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={avatarBusy}
                >
                  <Icon name="camera" size={16} />
                  {avatarBusy ? 'Uploading…' : 'Change Image'}
                </button>
                <input
                  ref={fileInputRef}
                  className="tf-visually-hidden"
                  type="file"
                  accept={AVATAR_MIME_TYPES.join(',')}
                  onChange={handleAvatarChange}
                  tabIndex={-1}
                  aria-hidden="true"
                />
                <small>PNG, JPG, WEBP or GIF. Up to 2 MB.</small>
              </div>
            </div>
            <Feedback state={avatarFeedback} />
          </section>

          <section className="tf-profile-card" aria-labelledby="account-title">
            <h2 id="account-title">ACCOUNT</h2>
            <form className="tf-profile-form" onSubmit={handleSaveAccount} noValidate>
              <div className="tf-field">
                <label htmlFor="profile-full-name">Full name</label>
                <input
                  id="profile-full-name"
                  value={fullName}
                  onChange={(event) => setDraftFullName(event.target.value)}
                  maxLength={120}
                  autoComplete="name"
                  aria-invalid={!trimmedFullName || undefined}
                />
              </div>
              <div className="tf-field">
                <label htmlFor="profile-username">Username</label>
                <input id="profile-username" value={user?.username || ''} readOnly />
              </div>
              <div className="tf-field">
                <label htmlFor="profile-email">Email</label>
                <input id="profile-email" type="email" value={user?.email || ''} readOnly />
              </div>
              <Feedback state={accountFeedback} />
              <div className="tf-profile-actions">
                <button type="submit" disabled={accountBusy || !fullNameChanged || !trimmedFullName}>
                  {accountBusy ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          </section>

          <section className="tf-profile-card" aria-labelledby="change-password-title">
            <h2 id="change-password-title">CHANGE PASSWORD</h2>
            <form className="tf-profile-form" onSubmit={handleChangePassword} noValidate>
              <PasswordField
                id="current-password"
                label="Current password"
                value={currentPassword}
                onChange={setCurrentPassword}
                autoComplete="current-password"
              />
              <PasswordField
                id="new-password"
                label="New password"
                value={newPassword}
                onChange={setNewPassword}
                autoComplete="new-password"
                revealable
                invalid={newPassword.length > 0 && !isStrongPassword(newPassword)}
                describedBy="password-note"
              />
              <PasswordField
                id="confirm-password"
                label="Confirm new password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                autoComplete="new-password"
                revealable
                invalid={confirmMismatch}
                describedBy={confirmMismatch ? 'confirm-password-error' : undefined}
              />
              {confirmMismatch && (
                <small id="confirm-password-error" className="tf-field-error">Passwords do not match.</small>
              )}

              <div id="password-note" className="tf-password-note">
                <small>{PASSWORD_NOTE}</small>
                {newPassword && (
                  <ul className="tf-password-rules" aria-label="Password requirements">
                    {PASSWORD_RULES.map((rule) => {
                      const met = rule.test(newPassword);
                      return (
                        <li key={rule.id} className={met ? 'met' : ''}>
                          <Icon name={met ? 'check' : 'close'} size={13} />
                          {rule.label}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <Feedback state={passwordFeedback} />
              <div className="tf-profile-actions">
                <button type="submit" disabled={passwordBusy}>
                  {passwordBusy ? 'Changing…' : 'Change password'}
                </button>
              </div>
            </form>
          </section>
        </div>
      </main>
    </div>
  );
}
