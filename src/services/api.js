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

  /** payload: { userId, roles } (adds the member or changes their roles). */
  addSpaceMember: (id, payload) => request(
    `/spaces/${encodeURIComponent(id)}/members`,
    json('POST', payload)
  ),

  /** payload: { userIds, roles } (adds several people with the same roles). */
  addSpaceMembers: (id, payload) => request(
    `/spaces/${encodeURIComponent(id)}/members/bulk`,
    json('POST', payload)
  ),

  removeSpaceMember: (id, userId) => request(
    `/spaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE' }
  ),

  // Project roles (read: every user; manage: admins)
  getProjectRoles: () => request('/project-roles'),
  // Project permissions (read: members; change: project admins)
  getSpacePermissions: (id) => request(`/spaces/${encodeURIComponent(id)}/permissions`),
  updateSpacePermission: (id, key, rules) => request(
    `/spaces/${encodeURIComponent(id)}/permissions/${encodeURIComponent(key)}`,
    { method: 'PUT', body: JSON.stringify({ rules }) }
  ),
  resetSpacePermissions: (id) => request(`/spaces/${encodeURIComponent(id)}/permissions/reset`, { method: 'POST' }),

  // Dashboard widgets visible to the signed-in user
  getDashboardWidgets: () => request('/dashboard/widgets'),
  // AI Project Assistant
  aiStatus: () => request('/ai/status'),
  aiChat: (payload) => request('/ai/chat', json('POST', payload)),
  aiSuggestTask: (payload) => request('/ai/suggest-task', json('POST', payload)),
  aiApplyPriority: (changes) => request('/ai/apply-priority', json('POST', { changes })),

  // User dashboards (layouts of SQL widgets)
  getDashboards: () => request('/dashboards'),
  getDashboard: (id, { visit = true } = {}) => request(`/dashboards/${encodeURIComponent(id)}${visit ? '' : '?visit=0'}`),
  createDashboard: (values) => request('/dashboards', json('POST', values)),
  updateDashboard: (id, values) => request(`/dashboards/${encodeURIComponent(id)}`, json('PATCH', values)),
  deleteDashboard: (id) => request(`/dashboards/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  starDashboard: (id, starred) => request(`/dashboards/${encodeURIComponent(id)}/star`, json('PUT', { starred })),
  getDashboardWidgetData: (id) => request(`/dashboard/widgets/${encodeURIComponent(id)}/data`),

  // System administration (admins only)
  admin: {
    getUsers: () => request('/admin/users'),
    createUser: (data) => request('/admin/users', json('POST', data)),
    updateUser: (id, data) => request(`/admin/users/${encodeURIComponent(id)}`, json('PATCH', data)),
    resetPassword: (id, password) => request(`/admin/users/${encodeURIComponent(id)}/password`, json('POST', { password })),
    getProjectRoles: () => request('/admin/project-roles'),
    createProjectRole: (data) => request('/admin/project-roles', json('POST', data)),
    updateProjectRole: (id, data) => request(`/admin/project-roles/${encodeURIComponent(id)}`, json('PATCH', data)),
    deleteProjectRole: (id) => request(`/admin/project-roles/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    getWidgets: () => request('/admin/widgets'),
    createWidget: (data) => request('/admin/widgets', json('POST', data)),
    updateWidget: (id, data) => request(`/admin/widgets/${encodeURIComponent(id)}`, json('PATCH', data)),
    deleteWidget: (id) => request(`/admin/widgets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    previewWidget: (sql) => request('/admin/widgets/preview', json('POST', { sql }))
  },

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

  // Files attached to work items
  getAttachments: (spaceId) => request(`/attachments${spaceId ? `?spaceId=${encodeURIComponent(spaceId)}` : ''}`),

  /** Uploads one file to a work item. Resolves to { attachment, workItem }. */
  uploadAttachment: (workItemId, file, source = 'work_item') => request(
    `/work-items/${encodeURIComponent(workItemId)}/attachments`,
    {
      method: 'POST',
      body: file,
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name),
        ...(source === 'comment' ? { 'X-Attachment-Source': 'comment' } : {})
      }
    }
  ),

  /** Resolves to { workItem } with the updated attachment list. */
  deleteAttachment: (id) => request(`/attachments/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /** URL to show a file inline (images, PDF) or to download it. */
  attachmentUrl: (id, mode = 'content') => `${API_BASE_URL}/attachments/${encodeURIComponent(id)}/${mode === 'download' ? 'download' : 'content'}`,

  // Users directory (signed-in users only)
  getUsers: () => request('/users'),

  // Teams (scoped to one Space)
  getTeams: (spaceId) => request(`/spaces/${encodeURIComponent(spaceId)}/teams`),

  /** data: { code, name, unit, description, members: [{ userId, role: 'lead' | 'member' }] } */
  createTeam: (spaceId, data) => request(
    `/spaces/${encodeURIComponent(spaceId)}/teams`,
    json('POST', data)
  ),

  updateTeam: (id, data) => request(
    `/teams/${encodeURIComponent(id)}`,
    json('PATCH', data)
  ),

  deleteTeam: (id) => request(
    `/teams/${encodeURIComponent(id)}`,
    { method: 'DELETE' }
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
