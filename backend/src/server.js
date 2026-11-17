import { describeAiConfiguration } from './env.js'; // must stay first: loads backend/.env before other modules read it
import express from 'express';
import cors from 'cors';
import spacesRouter from './routes/spaces.js';
import workItemsRouter from './routes/workItems.js';
import authRouter from './routes/auth.js';
import usersRouter from './routes/users.js';
import sprintsRouter from './routes/sprints.js';
import teamsRouter from './routes/teams.js';
import attachmentsRouter from './routes/attachments.js';
import adminRouter from './routes/admin.js';
import catalogRouter from './routes/catalog.js';
import dashboardsRouter from './routes/dashboards.js';
import aiRouter from './routes/ai.js';
import { requireAdmin, requireAuth } from './middleware/auth.js';
import { db } from './db.js';
import { googleConfig, googleEnabled } from './googleAuth.js';

const app = express();
const port = Number(process.env.PORT || 4000);
const allowedOrigins = process.env.FRONTEND_ORIGIN
  ? process.env.FRONTEND_ORIGIN.split(',').map(value => value.trim())
  : true;

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '4mb' }));

// Public endpoints.
app.get('/api/health', (_req, res) => res.json({ status: 'ok', database: 'connected' }));
app.use('/api/auth', authRouter);

// Everything below requires a signed-in user. Project-level access (which Spaces a user
// may see) is checked inside each router with the helpers in access.js.
app.use('/api', requireAuth);
app.use('/api/users', usersRouter);
app.use('/api/admin', requireAdmin, adminRouter);
app.use('/api/spaces', spacesRouter);
app.use('/api/work-items', workItemsRouter);
app.use('/api', sprintsRouter);
app.use('/api', teamsRouter);
app.use('/api', attachmentsRouter);
app.use('/api', catalogRouter);
app.use('/api/dashboards', dashboardsRouter);
app.use('/api/ai', aiRouter);

app.use((error, _req, res, _next) => {
  if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'This Code or Key already exists.' });
  if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'The upload is too large (files up to 10 MB).' });
  console.error(error);
  res.status(500).json({ error: 'Internal server error.' });
});

const server = app.listen(port, () => {
  console.log(`TASKFLOW API is running at http://localhost:${port}`);
  console.log('SQLite database: backend/data/taskflow.sqlite');
  describeAiConfiguration().forEach((line) => console.log(line));
  const google = googleConfig();
  console.log(googleEnabled(google)
    ? `Google sign-in: on (redirect URI ${google.redirectUri}, app ${google.appUrl})`
    : 'Google sign-in: off (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to turn it on)');
});
function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
