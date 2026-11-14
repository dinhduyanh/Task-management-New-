import express from 'express';
import cors from 'cors';
import spacesRouter from './routes/spaces.js';
import workItemsRouter from './routes/workItems.js';
import authRouter from './routes/auth.js';
import usersRouter from './routes/users.js';
import sprintsRouter from './routes/sprints.js';
import teamsRouter from './routes/teams.js';
import { db } from './db.js';

const app = express();
const port = Number(process.env.PORT || 4000);
const allowedOrigins = process.env.FRONTEND_ORIGIN
  ? process.env.FRONTEND_ORIGIN.split(',').map(value => value.trim())
  : true;

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '4mb' }));
app.get('/api/health', (_req, res) => res.json({ status: 'ok', database: 'connected' }));
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/spaces', spacesRouter);
app.use('/api/work-items', workItemsRouter);
app.use('/api', sprintsRouter);
app.use('/api', teamsRouter);

app.use((error, _req, res, _next) => {
  if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'This Code or Key already exists.' });
  if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large.' });
  console.error(error);
  res.status(500).json({ error: 'Internal server error.' });
});

const server = app.listen(port, () => {
  console.log(`TASKFLOW API is running at http://localhost:${port}`);
  console.log('SQLite database: backend/data/taskflow.sqlite');
});
function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
