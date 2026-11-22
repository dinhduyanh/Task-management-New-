// Diagnoses Google sign-in setup:  npm run check:google   (run inside the backend folder)
// Prints only variable NAMES and lengths, never secret values.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const backendDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = process.env.TASKFLOW_ENV_FILE || path.join(backendDir, '.env');
const port = Number(process.env.PORT || 4000);
const say = (mark, text) => console.log(`${mark} ${text}`);
let problems = 0;
const bad = (text) => { problems += 1; say('✗', text); };

console.log(`\nGoogle sign-in check\n  backend folder: ${backendDir}\n  env file:       ${envPath}\n`);

// 1. The .env file itself
const lookalikes = fs.readdirSync(backendDir).filter((name) => /^\.?env/i.test(name) && name !== '.env' && name !== '.env.example');
if (!fs.existsSync(envPath)) {
  bad('backend/.env does not exist.');
  if (lookalikes.length) say(' ', `  Found ${lookalikes.join(', ')} instead - rename it to exactly ".env" (Windows Notepad often saves ".env.txt"; turn on "File name extensions" in Explorer to see it).`);
} else {
  say('✓', 'backend/.env exists');
  if (lookalikes.length) say('!', `Also found ${lookalikes.join(', ')} - only ".env" is read.`);
  const values = {};
  for (const line of fs.readFileSync(envPath, 'utf8').replace(/^ /, '').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2').trim();
  }
  const id = values.GOOGLE_CLIENT_ID || '';
  const secret = values.GOOGLE_CLIENT_SECRET || '';
  if (!id) bad('GOOGLE_CLIENT_ID is missing or empty in backend/.env');
  else if (!/\.apps\.googleusercontent\.com$/.test(id)) bad(`GOOGLE_CLIENT_ID does not look like a Google client id (it should end with .apps.googleusercontent.com; got ${id.length} characters)`);
  else say('✓', 'GOOGLE_CLIENT_ID looks right');
  if (!secret) bad('GOOGLE_CLIENT_SECRET is missing or empty in backend/.env');
  else say('✓', `GOOGLE_CLIENT_SECRET is set (${secret.length} characters${/^GOCSPX-/.test(secret) ? ', starts with GOCSPX-' : ''})`);
  Object.keys(values).filter((key) => /google/i.test(key) && !['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'].includes(key))
    .forEach((key) => bad(`${key} is not a recognised name - use GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET`));
  const commented = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).filter((line) => /^\s*#\s*GOOGLE_CLIENT_(ID|SECRET)\s*=\s*\S/.test(line));
  if (commented.length && (!id || !secret)) say(' ', '  A GOOGLE_CLIENT_... line starts with "#" (a comment) - remove the "#".');
  say(' ', `  Authorized redirect URI to add in Google Cloud: ${values.GOOGLE_REDIRECT_URI || `http://localhost:${port}/api/auth/google/callback`}`);
}

// 2. What the running backend says
try {
  const response = await fetch(`http://localhost:${port}/api/auth/providers`, { signal: AbortSignal.timeout(3000) });
  if (response.status === 404) bad(`The backend on port ${port} is an old version (no /api/auth/providers). Stop it and start the updated backend.`);
  else {
    const providers = await response.json();
    if (providers.google) say('✓', `The running backend on port ${port} has Google sign-in ON`);
    else if (!problems) bad(`The running backend on port ${port} still has Google sign-in OFF although backend/.env is correct: it was started before you edited .env. Stop it (Ctrl+C, or end the old "node" process) and start it again - "npm run dev" does not reload .env.`);
    else bad(`The running backend on port ${port} has Google sign-in OFF (fix the items above, then restart it).`);
  }
} catch {
  say('!', `No backend is answering on port ${port} right now (start it with "npm start").`);
}

console.log(problems ? `\n${problems} problem(s) found.\n` : '\nEverything looks right. Reload the sign-in page and click "Continue with Google".\n');
process.exitCode = problems ? 1 : 0;
