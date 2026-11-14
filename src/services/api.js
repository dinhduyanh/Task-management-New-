// Accept VITE_API_BASE_URL either as the server origin (http://localhost:4000)
// or including the /api prefix (http://localhost:4000/api).
const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000')
  .replace(/\/+$/, '')
  .replace(/\/api$/, '');

export const API_BASE_URL = `${API_ORIGIN}/api`;

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

export async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body instanceof FormData || !options.body
        ? {}
        : { 'Content-Type': 'application/json' }),
      ...(options.headers || {})
    }
  });

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get('content-type') || '';

  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message = typeof payload === 'object' && payload?.error
      ? payload.error
      : `API request failed (${response.status}).`;

    throw new ApiError(message, response.status, payload);
  }

  return payload;
}

export const json = (method, body) => ({
  method,
  body: JSON.stringify(body)
});

export const api = {
  health: () => request('/health'),

  // Spaces
  getSpaces: () => request('/spaces'),

  createSpace: (data) => request(
    '/spaces',
    json('POST', data)
  ),

  updateSpace: (id, updates) => request(
    `/spaces/${encodeURIComponent(id)}`,
    json('PATCH', updates)
  ),

  deleteSpace: (id) => request(
    `/spaces/${encodeURIComponent(id)}`,
    { method: 'DELETE' }
  ),

  addSpaceMember: (id, payload) => request(
    `/spaces/${encodeURIComponent(id)}/members`,
    json('POST', payload)
  ),

  // Work Items
  getWorkItems: (spaceId) => request(
    `/work-items${spaceId ? `?spaceId=${encodeURIComponent(spaceId)}` : ''}`
  ),

  searchWorkItems: (key) => request(
    `/work-items/search?key=${encodeURIComponent(key)}`
  ),

  createWorkItem: (data) => request(
    '/work-items',
    json('POST', data)
  ),

  updateWorkItem: (id, updates) => request(
    `/work-items/${encodeURIComponent(id)}`,
    json('PATCH', updates)
  ),

  deleteWorkItems: (ids) => request(
    '/work-items/bulk',
    json('DELETE', { ids })
  ),

  moveWorkItems: (ids, targetSpaceId) => request(
    '/work-items/bulk-move',
    json('POST', { ids, targetSpaceId })
  ),

  /** Moves work items into a sprint (null = backlog); `ids` is that list's complete new order. */
  rankWorkItems: (ids, sprintId) => request(
    '/work-items/rank',
    json('POST', { ids, sprintId: sprintId || null })
  ),

  // Sprints
  getSprints: (spaceId) => request(`/spaces/${encodeURIComponent(spaceId)}/sprints`),

  createSprint: (spaceId, data = {}) => request(
    `/spaces/${encodeURIComponent(spaceId)}/sprints`,
    json('POST', data)
  ),

  updateSprint: (id, data) => request(
    `/sprints/${encodeURIComponent(id)}`,
    json('PATCH', data)
  ),

  startSprint: (id, data) => request(
    `/sprints/${encodeURIComponent(id)}/start`,
    json('POST', data)
  ),

  /** moveTo: 'backlog' | 'new' | a future sprint id, for the work items that are not done. */
  completeSprint: (id, moveTo) => request(
    `/sprints/${encodeURIComponent(id)}/complete`,
    json('POST', { moveTo })
  ),

  deleteSprint: (id) => request(
    `/sprints/${encodeURIComponent(id)}`,
    { method: 'DELETE' }
  ),

  getComments: (workItemId) => request(
    `/work-items/${encodeURIComponent(workItemId)}/comments`
  ),

  createComment: (workItemId, data) => request(
    `/work-items/${encodeURIComponent(workItemId)}/comments`,
    json('POST', data)
  )
};
