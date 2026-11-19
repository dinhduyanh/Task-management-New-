import { useState } from 'react';
import './UserAvatar.css';

function initialsOf(user) {
  const name = String(user?.fullName || user?.username || 'U').trim();
  const parts = name.split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 1);
  return letters.toUpperCase() || 'U';
}

/**
 * The user's uploaded picture, or their initials when none is set or the picture fails to load
 * (e.g. an expired Google photo link). referrerPolicy="no-referrer" lets Google photos load from localhost.
 */
export default function UserAvatar({ user, size = 36, className = '' }) {
  const [failedUrl, setFailedUrl] = useState('');
  const url = user?.avatarUrl && user.avatarUrl !== failedUrl ? user.avatarUrl : '';
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  return (
    <span className={`tf-user-avatar ${className}`} style={style} aria-hidden="true">
      {url ? <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailedUrl(url)} /> : initialsOf(user)}
    </span>
  );
}
