import { useState } from 'react';
import { useAppShell } from '../../context/appShellContext';
import { findUser, initialsOf, personName } from '../../services/userDirectory';
import './PersonAvatar.css';

/**
 * Avatar of a person (user object, member record, assignee or plain name): their uploaded
 * picture from the user directory, otherwise their initials. Keeps the caller's class
 * (size and colours come from it), e.g. <PersonAvatar person={assignee} className="td-avatar" />.
 * The initials are always drawn; the picture covers them only once it has loaded, so a slow,
 * blocked or expired picture never shows a blank circle or a broken-image icon.
 */
export default function PersonAvatar({ person, className = '', fallback = null, title }) {
  const { users = [], user: currentUser } = useAppShell();
  const [failedUrl, setFailedUrl] = useState('');
  const [loadedUrl, setLoadedUrl] = useState('');
  const directory = currentUser ? [currentUser, ...users] : users;
  const match = findUser(directory, person);
  const candidate = (typeof person === 'object' && person?.avatarUrl) || match?.avatarUrl || '';
  const url = candidate && candidate !== failedUrl ? candidate : '';
  const name = personName(person) || match?.fullName || '';
  const shown = Boolean(url) && loadedUrl === url;
  return (
    <span className={`${className} tf-person-avatar ${shown ? 'has-photo' : ''}`} title={title} aria-hidden="true">
      {fallback ?? initialsOf(name)}
      {url && (
        <img
          className={`tf-person-photo ${shown ? 'is-loaded' : ''}`}
          src={url}
          alt=""
          referrerPolicy="no-referrer"
          onLoad={() => setLoadedUrl(url)}
          onError={() => setFailedUrl(url)}
        />
      )}
    </span>
  );
}
