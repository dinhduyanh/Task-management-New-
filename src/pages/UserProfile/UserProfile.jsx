import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/common/Icon';
import { userProfileService } from '../../services/userProfileService';
import './UserProfile.css';

const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{6,}$/;

export default function UserProfile({ user: initialUser, onUserUpdated, onBack }) {
  const [user, setUser] = useState(initialUser || {});
  const [fullName, setFullName] = useState(initialUser?.fullName || initialUser?.full_name || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    let active = true;
    userProfileService.me()
      .then((result) => {
        const latest = result?.user || result?.data?.user;
        if (!active || !latest) return;
        setUser(latest);
        setFullName(latest.fullName || latest.full_name || '');
        onUserUpdated?.(latest);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, []);

  function applyUser(updatedUser) {
    setUser(updatedUser);
    setFullName(updatedUser.fullName || updatedUser.full_name || fullName);
    onUserUpdated?.(updatedUser);
  }

  async function saveProfile(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await userProfileService.updateProfile(fullName.trim());
      const updated = result?.user || result?.data?.user;
      if (updated) applyUser(updated);
      setNotice('Profile updated successfully.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadAvatar(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      setError('Only PNG, JPG, WEBP or GIF files are allowed.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('Avatar size must not exceed 2 MB.');
      return;
    }

    setBusy(true);
    setError('');
    setNotice('');
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const result = await userProfileService.updateAvatar(dataUrl);
      const updated = result?.user || result?.data?.user || {
        ...user,
        avatarUrl: result?.avatarUrl || dataUrl
      };
      applyUser(updated);
      setNotice('Profile picture updated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    setError('');
    setNotice('');

    if (!PASSWORD_RULE.test(newPassword)) {
      setError('New password does not meet the password requirements.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('New password must be different from current password.');
      return;
    }

    setBusy(true);
    try {
      await userProfileService.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setNotice('Password changed successfully.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const avatar = user.avatarUrl || user.avatar_url;
  const displayName = fullName || user.username || 'U';

  return (
    <main className="tf-profile-page">
      <div className="tf-profile-heading">
        <button type="button" className="tf-back" onClick={onBack}>
          <Icon name="arrowLeft" size={16} />
          Back
        </button>
        <h1>Your profile</h1>
        <p>Manage your personal information and account security.</p>
      </div>

      {error && <p className="tf-alert tf-error" role="alert">{error}</p>}
      {notice && <p className="tf-alert tf-success" role="status">{notice}</p>}

      <section className="tf-profile-card">
        <h2>PROFILE PICTURE</h2>
        <div className="tf-avatar-editor">
          {avatar
            ? <img src={avatar} alt="Current profile avatar" />
            : <div className="tf-avatar-placeholder">{displayName.slice(0, 1).toUpperCase()}</div>}
          <div className="tf-avatar-actions">
            <button
              type="button"
              className="tf-secondary-button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              Change Image
            </button>
            <input
              ref={fileInputRef}
              className="tf-visually-hidden"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={uploadAvatar}
              disabled={busy}
            />
            <small>PNG, JPG, WEBP or GIF. Up to 2 MB.</small>
          </div>
        </div>
      </section>

      <section className="tf-profile-card">
        <h2>ACCOUNT</h2>
        <form className="tf-profile-form" onSubmit={saveProfile}>
          <label>
            Full name
            <input
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              maxLength={120}
              required
            />
          </label>
          <label>
            Username
            <input value={user.username || ''} readOnly />
          </label>
          <label>
            Email
            <input value={user.email || ''} readOnly />
          </label>
          <div className="tf-profile-actions">
            <button type="submit" disabled={busy}>Save changes</button>
          </div>
        </form>
      </section>

      <section className="tf-profile-card">
        <h2>CHANGE PASSWORD</h2>
        <form className="tf-profile-form" onSubmit={changePassword}>
          <label>
            Current password
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </label>
          <label>
            New password
            <span className="tf-password-input">
              <input
                type={showNewPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
              />
              <button
                type="button"
                aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
                onClick={() => setShowNewPassword((value) => !value)}
              >
                <Icon name={showNewPassword ? 'eyeOff' : 'eye'} size={17} />
              </button>
            </span>
          </label>
          <label>
            Confirm new password
            <span className="tf-password-input">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
              <button
                type="button"
                aria-label={showConfirmPassword ? 'Hide confirmation password' : 'Show confirmation password'}
                onClick={() => setShowConfirmPassword((value) => !value)}
              >
                <Icon name={showConfirmPassword ? 'eyeOff' : 'eye'} size={17} />
              </button>
            </span>
          </label>
          <small className="tf-password-note">
            At least 6 characters and include uppercase letters, lowercase letters, numbers, and at least one special character.
          </small>
          <div className="tf-profile-actions">
            <button type="submit" disabled={busy}>Change password</button>
          </div>
        </form>
      </section>
    </main>
  );
}
