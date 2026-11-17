import { useAppShell } from '../../context/appShellContext';
import { findUser, initialsOf, personName } from '../../services/userDirectory';
import './PersonAvatar.css';

/**
 * Avatar of a person (user object, member record, assignee or plain name): their uploaded
 * picture from the user directory, otherwise their initials. Keeps the caller's class
 * (size and colours come from it), e.g. <PersonAvatar person={assignee} className="td-avatar" />.
 */
export default function PersonAvatar({ person, className = '', fallback = null, title }) {
  const { users = [], user: currentUser } = useAppShell();
  const directory = currentUser ? [currentUser, ...users] : users;
  const match = findUser(directory, person);
  const url = (typeof person === 'object' && person?.avatarUrl) || match?.avatarUrl || '';
  const name = personName(person) || match?.fullName || '';
  return (
    <span className={`${className} ${url ? 'has-photo' : ''}`} title={title} aria-hidden="true">
      {url ? <img className="tf-person-photo" src={url} alt="" loading="lazy" /> : (fallback ?? initialsOf(name))}
    </span>
  );
}
