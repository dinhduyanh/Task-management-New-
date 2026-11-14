
const API_ORIGIN = (
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'
).replace(/\/$/, '');

const API_BASE_URL = `${API_ORIGIN}/api`;

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body instanceof FormData
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

    throw new Error(message);
  }

  return payload;
}

const json = (method, body) => ({
  method,
  body: JSON.stringify(body)
});

export const api = {
  health: () => request('/health'),

  // Authentication
  login: (username, password) => request(
    '/auth/login',
    json('POST', { username, password })
  ),

  logout: () => request('/auth/logout', {
    method: 'POST'
  }),

  // User Profile
  getCurrentUser: () => request('/users/me'),

  updateProfile: (data) => request(
    '/users/me',
    json('PATCH', data)
  ),

  changePassword: (data) => request(
    '/users/change-password',
    json('POST', data)
  ),

  updateAvatar: (data) => request(
    '/users/me/avatar',
    json('POST', data)
  ),

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

  getComments: (workItemId) => request(
    `/work-items/${encodeURIComponent(workItemId)}/comments`
  ),

  createComment: (workItemId, data) => request(
    `/work-items/${encodeURIComponent(workItemId)}/comments`,
    json('POST', data)
  )
};
