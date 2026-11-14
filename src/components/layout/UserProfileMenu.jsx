import { useEffect, useRef, useState } from 'react';
import Icon from '../common/Icon';
import UserAvatar from '../common/UserAvatar';
import { useAppShell } from '../../context/appShellContext';
import './UserProfileMenu.css';

export default function UserProfileMenu() {
  const { user, theme, setTheme, navigate, signOut } = useAppShell();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const displayName = user?.fullName || user?.username || 'User';

  return (
    <div className="tf-profile-menu" ref={rootRef}>
      <button
        type="button"
        className="tf-avatar-button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open user menu"
        title={displayName}
      >
        <UserAvatar user={user} size={36} />
      </button>

      {open && (
        <div className="tf-profile-dropdown" role="menu" aria-label="User menu">
          <div className="tf-profile-summary">
            <UserAvatar user={user} size={40} />
            <div>
              <strong>{displayName}</strong>
              {user?.email && <small>{user.email}</small>}
            </div>
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate('profile');
            }}
          >
            <Icon name="user" size={17} />
            <span>Your profile</span>
          </button>

          <div className="tf-theme-row">
            <span>Theme</span>
            <div className="tf-theme-switch" role="radiogroup" aria-label="Theme">
              <button
                type="button"
                role="radio"
                className={theme === 'light' ? 'active' : ''}
                aria-label="Light theme"
                aria-checked={theme === 'light'}
                title="Light"
                onClick={() => setTheme('light')}
              >
                <Icon name="sun" size={17} />
              </button>
              <button
                type="button"
                role="radio"
                className={theme === 'dark' ? 'active' : ''}
                aria-label="Dark theme"
                aria-checked={theme === 'dark'}
                title="Dark"
                onClick={() => setTheme('dark')}
              >
                <Icon name="moon" size={17} />
              </button>
            </div>
          </div>

          <button
            type="button"
            role="menuitem"
            className="tf-logout"
            onClick={() => {
              setOpen(false);
              signOut();
            }}
          >
            <Icon name="power" size={17} />
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}
