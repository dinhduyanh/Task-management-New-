import { useEffect, useRef, useState } from 'react';
import Icon from '../common/Icon';
import './UserProfileMenu.css';

export default function UserProfileMenu({
  user,
  onNavigate = () => {},
  onLogout = () => {},
  theme = 'light',
  onThemeChange = () => {}
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const displayName = user?.fullName || user?.full_name || user?.username || 'User';
  const avatar = user?.avatarUrl || user?.avatar_url || '';
  const initials = displayName.trim().slice(0, 1).toUpperCase() || 'U';

  return (
    <div className="tf-profile-menu" ref={rootRef}>
      <button
        type="button"
        className="tf-avatar-button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label="Open profile menu"
      >
        {avatar ? <img src={avatar} alt="" /> : <span>{initials}</span>}
      </button>

      {open && (
        <div className="tf-profile-dropdown" role="menu">
          <div className="tf-profile-summary">
            <strong>{displayName}</strong>
            <small>{user?.email || user?.username || ''}</small>
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onNavigate('profile');
            }}
          >
            Your profile
          </button>

          <div className="tf-theme-row">
            <span>Theme</span>
            <div className="tf-theme-switch" role="group" aria-label="Choose theme">
              <button
                type="button"
                className={theme === 'light' ? 'active' : ''}
                aria-label="Light theme"
                aria-pressed={theme === 'light'}
                onClick={() => onThemeChange('light')}
              >
                <Icon name="sun" size={17} />
              </button>
              <button
                type="button"
                className={theme === 'dark' ? 'active' : ''}
                aria-label="Dark theme"
                aria-pressed={theme === 'dark'}
                onClick={() => onThemeChange('dark')}
              >
                <Icon name="moon" size={17} />
              </button>
            </div>
          </div>

          <button className="tf-logout" type="button" role="menuitem" onClick={() => {
            setOpen(false);
            onLogout();
          }}>
            <Icon name="power" size={16} />
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}
