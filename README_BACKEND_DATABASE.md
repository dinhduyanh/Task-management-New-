# TASKFLOW – Backend & Database (SQLite)

This patch adds persistent storage for Spaces and Work Items, replacing the in-memory-only state previously used by `App.jsx`.

## 1. Requirements

- Node.js 20 or newer (recommended: Node.js 22 LTS)
- npm

## 2. Install and start the Backend

Open a terminal in the project root:

```powershell
cd backend
npm install
npm run dev
```

The API starts at `http://localhost:4000`.
Check it at `http://localhost:4000/api/health` – expected response:

```json
{"status":"ok","database":"connected"}
```

The database file is created automatically at:

```text
backend/data/taskflow.sqlite
```

Do not delete this file unless you intentionally want to reset local data. Back it up by stopping the backend and copying the file.

## 3. Start the React Frontend

Open a second terminal at the project root (not inside `backend`):

```powershell
npm run dev
```

Frontend API base URL defaults to `http://localhost:4000/api`. To override it, create a `.env` file in the project root:

```env
VITE_API_BASE_URL=http://localhost:4000/api
```

Restart Vite after changing `.env`.

## 4. APIs currently connected to the Frontend

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/spaces` | Load all Spaces |
| POST | `/api/spaces` | Create Space |
| PATCH | `/api/spaces/:spaceId` | Update Space |
| DELETE | `/api/spaces/:spaceId` | Delete Space and its Work Items |
| POST | `/api/spaces/:spaceId/members` | Add/update Space member |
| GET | `/api/work-items` | Load Work Items across the system |
| GET | `/api/work-items?spaceId=...` | Load Work Items in one Space |
| GET | `/api/work-items/search?key=...` | Exact Key search across Spaces |
| POST | `/api/work-items` | Create Work Item and generate Key |
| PATCH | `/api/work-items/:id` | Update Work Item |
| DELETE | `/api/work-items/:id` | Delete Work Item |
| DELETE | `/api/work-items/bulk` | Bulk delete |
| POST | `/api/work-items/bulk-move` | Move Work Items to another Space |

The API also includes initial endpoints for Work Item comments and a database schema for users, teams, releases, links, attachments metadata, activity logs and status history. These supporting modules are not all connected to the UI yet.

## 5. Database structure

`backend/src/schema.sql` creates these tables:

- `users`
- `spaces`
- `space_members`
- `teams`
- `releases`
- `work_items`
- `work_item_links`
- `comments`
- `attachments`
- `activity_logs`
- `work_item_status_history`

The `data_json` columns preserve additional front-end fields while core searchable and relational fields remain normalized in columns. This supports incremental expansion without losing current UI data.

## 6. Global Create change

Global Create now saves the Work Item and closes the modal while keeping the user on the screen they were already viewing. It no longer navigates automatically to the newly created Task Detail.

## 7. Important current limitations

- The existing Login screen is still a Frontend demo. Authentication, password hashing, access tokens and role-based API authorization are not implemented yet.
- A current user named `You` is still supplied by the existing Frontend flow; the `users` table is prepared but no real user directory is connected.
- Attachment metadata is part of the schema, but binary upload/storage is a separate step and is not yet connected.
- Comments, history, work logs, teams and releases have database structures or starter APIs, but not every Task Detail interaction has been migrated from local component state to the API.
- Workflow transition validation is still performed in the Frontend. It must also be enforced in Backend before production use.
- Data created before this patch existed only in React memory and is not automatically migrated into SQLite. Create the Spaces/Work Items again or export them before replacing the running app if you need to preserve existing session-only data.

This is a local development backend, not a production-ready deployment. Before real multi-user deployment, add authentication, authorization, server-side workflow enforcement, validation, upload handling, backups and production configuration.

## 8. Connect the My Tasks list to the loaded database records

Your current `src/pages/MyTasks/MyTasks.jsx` already receives `allTasks` from `App.jsx`, but it still initializes an internal empty array:

```jsx
const [tasks] = useState([]);
```

Replace only that line with:

```jsx
const tasks = Array.isArray(allTasks) ? allTasks : [];
```

Do not change the filters or the rest of the component. This makes My Tasks use the Work Items loaded by the Backend instead of always showing an empty list.

## 9. Sign up and Google sign-in

The sign-in page offers email/password sign-in, an email **Sign up** form and **Continue with Google**.

**Google setup (once):**

1. In Google Cloud Console open *APIs & Services → OAuth consent screen* and configure it (External, add your email as a test user while the app is in testing).
2. Open *APIs & Services → Credentials → Create credentials → OAuth client ID*, type **Web application**.
3. Under **Authorized redirect URIs** add `http://localhost:4000/api/auth/google/callback` (in production: `https://<your-api-host>/api/auth/google/callback`).
4. Put the values in `backend/.env` and restart the backend:

```
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxxxxx
# Optional: GOOGLE_REDIRECT_URI (must match step 3), APP_URL (default: first FRONTEND_ORIGIN or http://localhost:5173)
```

The start-up log shows `Google sign-in: on (...)` when it is configured.

**How it works:** the button sends the browser to `GET /api/auth/google/start`, which redirects to Google (authorization-code flow with PKCE, `state` bound to the browser by an HttpOnly cookie, and a `nonce`). Google returns to `/api/auth/google/callback`; the server exchanges the code, checks the ID token (issuer, audience, expiry, nonce, verified email) and then:

- signs in the user already linked to that Google account, or
- links the Google account to the existing user with the same email (password sign-in keeps working), or
- creates a new user (role **user**, name, email and photo from Google, no password).

It then sets the usual HttpOnly session cookie and redirects to the app (`APP_URL/?auth=google`), which loads the user and opens the home screen. Set `ALLOW_SIGNUP=false` to stop new accounts (email sign-up and unknown Google emails); existing users can still sign in with Google.

Database: `users.google_sub` (unique) stores the linked Google account; `oauth_states` holds short-lived sign-in attempts.
