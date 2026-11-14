const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api').replace(/\/$/, '');

function readStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('taskflow.user') || 'null') || {};
  } catch {
    return {};
  }
}

function writeStoredUser(user) {
  localStorage.setItem('taskflow.user', JSON.stringify(user));
  return user;
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status}).`);
  return payload;
}

export const userProfileService = {
  async login(usernameOrEmail, password) {
    const identity = String(usernameOrEmail || '').trim();
    const payload = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: identity, password })
    });
    const user = payload?.user || payload?.data?.user;
    if (!user || typeof user !== 'object') {
      throw new Error('API /auth/login chưa trả về thông tin User hợp lệ.');
    }
    writeStoredUser(user);
    localStorage.setItem('taskflow.authenticated', 'true');
    return { ...payload, user };
  },

  async me() {
    try {
      return await request('/users/me');
    } catch (error) {
      // Current TASKFLOW backend has no user/auth routes; retain demo profile locally.
      if (error.message.includes('(404)')) return { user: readStoredUser() };
      throw error;
    }
  },

  async updateProfile(fullName) {
    try {
      return await request('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({ fullName })
      });
    } catch (error) {
      if (!error.message.includes('(404)')) throw error;
      const user = writeStoredUser({ ...readStoredUser(), fullName });
      return { user };
    }
  },

  async updateAvatar(avatarUrl) {
    try {
      return await request('/users/me/avatar', {
        method: 'PUT',
        body: JSON.stringify({ avatarUrl })
      });
    } catch (error) {
      if (!error.message.includes('(404)')) throw error;
      const user = writeStoredUser({ ...readStoredUser(), avatarUrl });
      return { user, avatarUrl };
    }
  },

  async changePassword(currentPassword, newPassword) {
    // Password changes require a real authenticated backend; never fake a success.
    return request('/users/me/password', {
      method: 'PATCH',
      body: JSON.stringify({ currentPassword, newPassword })
    });
  }
};
