// Looks people up in the user directory (GET /api/users) so every avatar shows the user's
// uploaded picture, however the person was stored (id, email, username or display name).
const norm = (value) => String(value || '').trim().toLowerCase();

export function personName(person) {
  if (!person) return '';
  if (typeof person === 'string') return person;
  return person.fullName || person.name || person.displayName || person.username || person.email || '';
}

/** The directory entry for a person (object or name), or null. */
export function findUser(users, person) {
  if (!person || !Array.isArray(users) || !users.length) return null;
  if (typeof person === 'string') {
    const key = norm(person);
    return users.find((user) => norm(user.fullName) === key || norm(user.username) === key || norm(user.email) === key || String(user.id) === person) || null;
  }
  const id = person.id ?? person.userId ?? person.assigneeId;
  if (id !== undefined && id !== null) {
    const byId = users.find((user) => String(user.id) === String(id));
    if (byId) return byId;
  }
  if (person.email) {
    const byEmail = users.find((user) => norm(user.email) === norm(person.email));
    if (byEmail) return byEmail;
  }
  if (person.username) {
    const byUsername = users.find((user) => norm(user.username) === norm(person.username));
    if (byUsername) return byUsername;
  }
  const name = norm(personName(person));
  return name ? users.find((user) => norm(user.fullName) === name) || null : null;
}

export function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)).toUpperCase();
}
