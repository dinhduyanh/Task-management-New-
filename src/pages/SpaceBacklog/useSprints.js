import { useEffect, useState } from 'react';
import { api } from '../../services/api';

/**
 * Sprints of a Space, fetched from the backend when the view mounts (and on reload()).
 * Backlog and Active sprints both use it, so each tab always shows the server's
 * current sprint state, e.g. right after a sprint is started or completed.
 */
export default function useSprints(spaceId) {
  const [sprints, setSprints] = useState(null); // null while loading
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!spaceId) return undefined;
    let active = true;
    api.getSprints(spaceId)
      .then((rows) => { if (active) { setSprints(rows); setError(''); } })
      .catch((reason) => { if (active) setError(reason.message || 'Unable to load sprints.'); });
    return () => { active = false; };
  }, [spaceId, reloadKey]);

  return { sprints, setSprints, error, reload: () => setReloadKey((value) => value + 1) };
}
