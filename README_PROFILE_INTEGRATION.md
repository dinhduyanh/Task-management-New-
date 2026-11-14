# TASKFLOW – Profile, Theme & Authentication

## Included
- React Profile page, avatar upload (PNG/JPG/WEBP/GIF, 2MB), editable Full name, read-only Username/Email.
- Password change with current-password verification and policy validation.
- Light/Dark theme helper and CSS variables.
- Express login/logout, HttpOnly cookie sessions, current-user APIs.
- SQLite session table created automatically by `db.js`; core `schema.sql` and existing Spaces/Work Items routes remain intact.
- Login screen updated to use the real API instead of demo display data.

## Backend installation
Backend package currently contains Express, CORS and better-sqlite3 only. This implementation uses Node.js built-in `crypto` (scrypt), so no additional dependency is required. Node >=20.

Copy:
- `backend/src/db.js` over existing `src/db.js`
- `backend/src/server.js` over existing `src/server.js`
- `backend/src/middleware/auth.js`
- `backend/src/routes/auth.js`
- `backend/src/routes/users.js`
- `backend/scripts/set-user-password.js`

Keep existing `src/routes/spaces.js`, `src/routes/workItems.js`, `src/workflows.js`, and `src/schema.sql`.

Set `FRONTEND_ORIGIN` to the exact frontend origin in production (comma-separated if needed). Set `NODE_ENV=production` when using HTTPS so the session cookie gets `Secure`. Frontend and backend must be same-site for the `SameSite=Lax` cookie approach; otherwise configure a deliberate cross-site cookie + CSRF strategy before deployment.

## Initialize a user password
The provided Login.jsx previously created display-only demo user data. It did not authenticate against the database. A matching user row must exist in SQLite first. Then run from backend directory:
`node scripts/set-user-password.js <username-or-email> "<StrongPassword1!>"`

Password policy: >=6 chars, uppercase, lowercase, digit, special character. The script writes a salted scrypt hash.

## Frontend integration
Copy the files under `frontend/src` into the matching paths in your React app. Import `theme.css` and initialize theme once near app bootstrap:

```jsx
import './theme.css';
import { applyTheme, getInitialTheme } from './theme/theme';

const initialTheme = getInitialTheme();
applyTheme(initialTheme);
```

Maintain theme state in the app shell and pass `theme` and `onThemeChange={setTheme}` to `UserProfileMenu`.
Example:
```jsx
<UserProfileMenu
  user={user}
  theme={theme}
  onThemeChange={setTheme}
  onNavigate={(page) => setCurrentPage(page)}
  onLogout={async () => {
    await userProfileService.logout();
    setUser(null);
    setCurrentPage('login');
  }}
/>
```
Render `<UserProfile user={user} onUserUpdated={setUser} onBack={() => setCurrentPage('home')} />` when the profile route/page is selected.

Update the app's login callback to accept `{ user }` from the new Login component. The existing `Icon` component and `Login.css` are reused.

## API
- POST `/api/auth/login` `{ username, password }`
- POST `/api/auth/logout`
- GET `/api/users/me`
- PATCH `/api/users/me` `{ fullName }`
- POST `/api/users/me/avatar` `{ dataUrl }`
- DELETE `/api/users/me/avatar`
- POST `/api/users/change-password` `{ currentPassword, newPassword }`

## Important notes
- The uploaded `Login.jsx` was explicitly demo-only. This package replaces that behavior; login now requires a real user row and initialized password hash.
- Avatar is stored as a data URL in `users.avatar_url`. For production at scale, move binary assets to object storage and store only a URL.
- Profile APIs are authenticated. Existing Spaces/Work Items routes are intentionally unchanged and remain unprotected, matching the existing backend behavior; add authorization to those APIs separately before production.
- No automatic registration or password-reset email flow is included.
- Run `npm run check` after copying backend files. Also run the frontend build and test login/profile flows against a test database before deployment.
