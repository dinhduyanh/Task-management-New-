import { json, request } from './api';
import { getStoredUser, storeUser } from './authService';

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

// At least 6 characters with an uppercase letter, a lowercase letter, a digit
// and a special character. Mirrors the rule enforced by the backend.
export const PASSWORD_RULES = [
  { id: 'length', label: 'At least 6 characters', test: (value) => value.length >= 6 },
  { id: 'upper', label: 'An uppercase letter', test: (value) => /[A-Z]/.test(value) },
  { id: 'lower', label: 'A lowercase letter', test: (value) => /[a-z]/.test(value) },
  { id: 'digit', label: 'A number', test: (value) => /\d/.test(value) },
  { id: 'special', label: 'A special character', test: (value) => /[^A-Za-z0-9]/.test(value) }
];

export function isStrongPassword(value) {
  return PASSWORD_RULES.every((rule) => rule.test(String(value || '')));
}

/** Returns an error message, or '' when the file is an acceptable avatar. */
export function validateAvatarFile(file) {
  if (!file) return 'Please choose an image.';
  if (!AVATAR_MIME_TYPES.includes(file.type)) return 'Only PNG, JPG, WEBP or GIF images are allowed.';
  if (file.size > AVATAR_MAX_BYTES) return 'The image must not exceed 2 MB.';
  return '';
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Unable to read the selected image.'));
    reader.readAsDataURL(file);
  });
}

function remember(user) {
  storeUser(user);
  return user;
}

export const userProfileService = {
  async getMe() {
    const payload = await request('/users/me');
    return remember(payload.user);
  },

  async updateFullName(fullName) {
    const payload = await request('/users/me', json('PATCH', { fullName: String(fullName || '').trim() }));
    return remember(payload.user);
  },

  async uploadAvatar(file) {
    const error = validateAvatarFile(file);
    if (error) throw new Error(error);
    const dataUrl = await readAsDataUrl(file);
    const payload = await request('/users/me/avatar', json('POST', { dataUrl }));
    return remember({ ...(getStoredUser() || {}), avatarUrl: payload?.avatarUrl ?? dataUrl });
  },

  /** The backend revokes every session after a password change. */
  async changePassword(currentPassword, newPassword) {
    return request('/users/change-password', json('POST', { currentPassword, newPassword }));
  }
};
