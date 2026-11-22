import { useEffect, useState } from 'react';
import Icon from '../../components/common/Icon';
import PriorityIcon from '../../components/common/PriorityIcon';
import { api } from '../../services/api';
import { iconForType } from '../SpacesList/issueHelpers';
import { EMPTY_VALUE, LIST_FIELDS } from '../../../shared/tql';

let cachedMeta = null;

/** Values for the filter dropdowns and TQL auto-complete (GET /filters/meta), cached. */
export function useFilterMeta() {
  const [meta, setMeta] = useState(cachedMeta);
  useEffect(() => {
    let active = true;
    api.getFilterMeta().then((value) => { cachedMeta = value; if (active) setMeta(value); }).catch(() => {});
    return () => { active = false; };
  }, []);
  return meta;
}

const norm = (value) => String(value ?? '').trim().toLowerCase();

const emptyOption = (label) => ({ value: EMPTY_VALUE, label, pinned: true, icon: <span className="fs-empty-icon" aria-hidden="true"><Icon name="close" size={10} /></span> });

/** Dropdown options of every Default-mode field. */
export function buildOptions(meta, currentUser) {
  if (!meta) return Object.fromEntries(LIST_FIELDS.map((name) => [name, []]));
  const people = (withEmpty) => {
    const me = meta.users.find((user) => String(user.id) === String(currentUser?.id)) || currentUser;
    return [
      ...(me ? [{ value: 'currentUser()', label: me.fullName || me.name || 'Me', isCurrentUser: true, pinned: true, user: me, aliases: [me.email, me.username, String(me.id)] }] : []),
      ...(withEmpty ? [emptyOption('Unassigned')] : []),
      ...meta.users.filter((user) => String(user.id) !== String(currentUser?.id)).map((user) => ({
        value: user.email || String(user.id), label: user.fullName, sublabel: user.email, user, aliases: [user.email, user.username, String(user.id)]
      }))
    ];
  };
  const sprintNames = [...new Map(meta.sprints.map((sprint) => [sprint.name, sprint])).values()];
  return {
    project: meta.projects.map((project) => ({ value: project.code, label: project.name, sublabel: project.code, shortLabel: project.code, aliases: [project.id, project.name] })),
    priority: meta.priorities.map((name) => ({ value: name, label: name, icon: <PriorityIcon priority={name} size={15} /> })),
    assignee: people(true),
    creator: people(false),
    type: meta.types.map((name) => ({ value: name, label: name, icon: <span className={`slv-type-icon type-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`}><Icon name={iconForType(name)} size={13} /></span> })),
    status: meta.statuses.map((name) => ({ value: name, label: name })),
    sprint: [emptyOption('No sprint'), ...sprintNames.map((sprint) => ({ value: sprint.name, label: sprint.name, sublabel: sprint.project }))],
    labels: [emptyOption('No labels'), ...meta.labels.map((name) => ({ value: name, label: name }))]
  };
}

/**
 * Values parsed from TQL ("alice nguyen", "prj-01") -> the matching option values, so the
 * dropdowns show them as selected. Unknown values are kept as they are.
 */
export function matchConfigValues(config, options) {
  const next = { ...config };
  for (const name of LIST_FIELDS) {
    const list = options[name] || [];
    next[name] = (config[name] || []).map((value) => {
      if (value === EMPTY_VALUE) return value;
      const key = norm(value);
      const match = list.find((option) => norm(option.value) === key || norm(option.label) === key || (option.aliases || []).some((alias) => norm(alias) === key));
      return match ? match.value : value;
    });
  }
  return next;
}
