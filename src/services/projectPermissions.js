// Client-side view of project permissions. The server is the authority (it rejects
// anything not allowed); these helpers only decide which controls to show or disable.
//
// space.permissions (from the API):
//   admin   - Admin Project: every permission
//   manage  - may delete the project (owner or system admin)
//   grants  - { [permissionKey]: { all: boolean, fields: ['assignee' | 'creator'] } }
import { useCallback } from 'react';
import { useAppShell } from '../context/appShellContext';

function personId(value) {
  if (!value) return '';
  if (typeof value === 'object') return String(value.id || value.userId || '');
  return String(value);
}

function fieldUserId(item, field) {
  if (!item) return '';
  if (field === 'assignee') return personId(item.assignee) || personId(item.assigneeId);
  if (field === 'creator') return personId(item.creator) || personId(item.creatorId);
  return '';
}

/**
 * Does `user` hold `key` in `space`? With an `item`, "User in Field" rules are checked
 * against it; without one, a field rule counts as "possible" only when `possible` is set.
 */
export function canInSpace(space, key, item = null, user = null, { possible = false } = {}) {
  const permissions = space?.permissions;
  if (!permissions) return false;
  if (permissions.admin) return true;
  const grant = permissions.grants?.[key];
  if (!grant) return false;
  if (grant.all) return true;
  if (!grant.fields?.length) return false;
  if (!item) return possible;
  const userId = String(user?.id || '');
  return Boolean(userId) && grant.fields.some((field) => fieldUserId(item, field) === userId);
}

/** The space a work item belongs to, from a list of spaces. */
export function spaceOfItem(spaces, item) {
  const id = String(item?.spaceId ?? item?.projectId ?? '');
  return (Array.isArray(spaces) ? spaces : []).find((space) => String(space.id) === id) || null;
}

/** Hook: `can(key, item)` for one space and the signed-in user. */
export function useProjectPermissions(space) {
  const { user } = useAppShell();
  const can = useCallback((key, item = null, options) => canInSpace(space, key, item, user, options), [space, user]);
  return {
    can,
    isProjectAdmin: Boolean(space?.permissions?.admin),
    canDeleteProject: Boolean(space?.permissions?.manage),
    user
  };
}

/** Hook for pages that show work items of many spaces (My Tasks, global search). */
export function useItemPermissions(spaces) {
  const { user } = useAppShell();
  return useCallback((key, item) => canInSpace(spaceOfItem(spaces, item), key, item, user), [spaces, user]);
}

/** The signed-in user as stored on work items (assignee, creator, comment author). */
export function userAsPerson(user) {
  if (!user) return null;
  const name = user.fullName || user.username || 'You';
  return { id: user.id, name, fullName: name, username: user.username, email: user.email || '' };
}
