# TASKFLOW – User menu, Profile, Theme & Sign out

## Where things live

| Concern | File |
| --- | --- |
| Avatar button + dropdown (Your profile, Theme, Sign out) | `src/components/layout/UserProfileMenu.jsx` (rendered by `Header.jsx`) |
| Avatar picture / initials | `src/components/common/UserAvatar.jsx` |
| Session-wide values for the layout (user, theme, navigate, signOut) | `src/context/appShellContext.js`, provided in `src/App.jsx` |
| Profile page (Profile picture / Account / Change password) | `src/pages/UserProfile/UserProfile.jsx` |
| Login / logout, local session storage | `src/services/authService.js` |
| Profile API calls + avatar & password validation rules | `src/services/userProfileService.js` |
| Shared fetch helper (`request`, `ApiError` with HTTP status) | `src/services/api.js` |
| Theme state (`taskflow.theme` in localStorage, `<html data-theme>`) | `src/theme/theme.js` |
| Semantic theme tokens (`--tf-surface`, `--tf-text`, …) | `src/theme.css` |
| Component colour tokens, light + dark (generated) | `src/theme/palette.css` |

The `Header` reads the user and theme from `AppShellContext`, so pages only pass
search/create props to it.

## Theme

- Light is the default (sun icon selected). Clicking the moon sets
  `<html data-theme="dark">`, which switches every CSS variable; the choice is
  saved in `localStorage['taskflow.theme']` and restored before first paint
  (`index.html`), so reloads keep it.
- Component CSS uses role-based colour tokens: `--tf-bg-<hex>`, `--tf-fg-<hex>`,
  `--tf-bd-<hex>`. Light values are the original design colours; dark values
  are derived by `scripts/theme-palette.mjs`.
- After adding hard-coded colours to any CSS file, run:

  ```bash
  npm run theme:palette
  ```

  It tokenizes the new colours and regenerates `src/theme/palette.css`.

## Profile page

- **Profile picture** – PNG, JPG, WEBP or GIF up to 2 MB, validated in the browser
  and again by the backend. Stored as a data URL in `users.avatar_url`.
- **Account** – Full name is editable (required, ≤120 chars); Username and Email are read-only.
- **Change password** – New password must have at least 6 characters, an uppercase
  letter, a lowercase letter, a number and a special character, and match the
  confirmation. The backend checks the current password, then revokes every
  session, so the app returns to Sign In with a notice.

## Sign out

`Sign out` calls `POST /api/auth/logout` (deletes the server session and the
HttpOnly cookie), clears every local session key (`taskflow.user`,
`taskflow.authenticated`, legacy token keys, sessionStorage) and shows the Sign
In page. The local session is cleared even if the server is unreachable. A 401
from `/api/users/me` on start-up also signs the user out.

## Backend API

- `POST /api/auth/login` `{ username, password }` · `POST /api/auth/logout`
- `GET /api/users/me` · `PATCH /api/users/me` `{ fullName }`
- `POST /api/users/me/avatar` `{ dataUrl }` · `DELETE /api/users/me/avatar`
- `POST /api/users/change-password` `{ currentPassword, newPassword }`

## Creating a user for local testing

Insert a row into `users`, then set its password from `backend/`:

```bash
node scripts/set-user-password.js <username-or-email> "StrongPass1!"
```

`VITE_API_BASE_URL` may be given with or without the `/api` suffix.
Frontend and backend must be same-site for the `SameSite=Lax` session cookie.
