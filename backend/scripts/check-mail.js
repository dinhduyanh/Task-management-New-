// Checks the email (SMTP) setup and sends one test email:
//   npm run check:mail -- you@example.com      (run inside the backend folder)
// Prints only variable NAMES and lengths, never the password.
import '../src/env.js';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';

const say = (mark, text) => console.log(`${mark} ${text}`);
const env = (key) => String(process.env[key] || '').trim();
const to = process.argv[2] || env('SMTP_USER');

console.log('\nEmail notification check\n');

// Common copy/paste mistakes in backend/.env (only the first of two equal keys is used).
const envFile = process.env.TASKFLOW_ENV_FILE || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
let fileProblems = 0;
if (fs.existsSync(envFile)) {
  const seen = new Map();
  fs.readFileSync(envFile, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).forEach((line, index) => {
    const match = line.match(/^\s*((?:SMTP|MAIL)_[A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (!match) return;
    const [, key, value] = match;
    const where = `backend/.env line ${index + 1}`;
    if (seen.has(key)) { fileProblems += 1; say('✗', `${key} appears twice (lines ${seen.get(key)} and ${index + 1}); only the FIRST one is used. Delete one.`); }
    else seen.set(key, index + 1);
    if (/<[^>]*(password|address|gmail|app)[^>]*>|example\.com|your\.address/i.test(value) && key !== 'MAIL_FROM') { fileProblems += 1; say('✗', `${where}: ${key} still has the example value - replace it with your own.`); }
    if (key === 'MAIL_FROM' && /example\.com|your\.address/i.test(value)) { fileProblems += 1; say('✗', `${where}: MAIL_FROM still has the example address.`); }
    if (/^(MAIL_TRANSPORT|SMTP_SECURE|SMTP_PORT)$/.test(key) && /\s\(/.test(value)) { fileProblems += 1; say('✗', `${where}: remove the note after the value of ${key} (keep only e.g. "${value.split(/\s/)[0]}").`); }
  });
}
const mode = (env('MAIL_TRANSPORT').toLowerCase().match(/^[a-z]+/) || [''])[0] || (env('SMTP_HOST') ? 'smtp' : 'log');
if (mode !== 'smtp') {
  say('✗', mode === 'log'
    ? 'SMTP_HOST is not set in backend/.env, so emails are only written to the server log.'
    : `MAIL_TRANSPORT=${mode}: emails are not sent.`);
  say(' ', '  Add to backend/.env (Gmail example), then restart the backend:');
  say(' ', '    SMTP_HOST=smtp.gmail.com');
  say(' ', '    SMTP_PORT=465');
  say(' ', '    SMTP_USER=your.address@gmail.com');
  say(' ', '    SMTP_PASS=<16-character App Password>');
  say(' ', '    MAIL_FROM="TASKFLOW <your.address@gmail.com>"');
  process.exit(1);
}
const port = Number(env('SMTP_PORT') || 587);
const secure = env('SMTP_SECURE') ? /^true\b/i.test(env('SMTP_SECURE')) : port === 465;
say('✓', `SMTP_HOST=${env('SMTP_HOST')}  SMTP_PORT=${port}  secure=${secure}`);
say(env('SMTP_USER') ? '✓' : '!', env('SMTP_USER') ? `SMTP_USER=${env('SMTP_USER')}` : 'SMTP_USER is empty (only works with servers that need no login)');
const pass = env('SMTP_PASS').replace(/\s+/g, '');
say(pass ? '✓' : '✗', pass ? `SMTP_PASS is set (${pass.length} characters)` : 'SMTP_PASS is empty');
if (/gmail\.com$/i.test(env('SMTP_HOST')) && pass && pass.length !== 16) {
  say('!', '  Gmail needs a 16-character App Password (Google Account > Security > 2-Step Verification > App passwords), not your normal password.');
}
if (fileProblems) say('!', `Fix the ${fileProblems} problem(s) above in backend/.env, save, restart the backend and run this again.`);
if (!to) { say('✗', 'No recipient: run  npm run check:mail -- you@example.com'); process.exit(1); }

const transport = nodemailer.createTransport({
  host: env('SMTP_HOST'), port, secure,
  auth: env('SMTP_USER') ? { user: env('SMTP_USER'), pass } : undefined,
  connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000
});
try {
  await transport.verify();
  say('✓', 'Connected and signed in to the SMTP server');
  const info = await transport.sendMail({
    from: env('MAIL_FROM') || env('SMTP_USER') || 'TASKFLOW <no-reply@taskflow.local>',
    to,
    subject: '[TASKFLOW] Email thử nghiệm',
    text: 'Cấu hình email của TASKFLOW đã hoạt động. Bạn sẽ nhận thông báo công việc qua email này.'
  });
  say('✓', `Test email sent to ${to} (${info.response || 'accepted'}). Check Inbox, Spam and the Updates/Promotions tabs.`);
} catch (error) {
  say('✗', `Could not send: ${error.message}`);
  if (/535|Username and Password not accepted|Invalid login|BadCredentials/i.test(error.message)) say(' ', '  The login was refused. For Gmail use an App Password (2-Step Verification must be on).');
  else if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ESOCKET|wrong version number/i.test(error.message)) say(' ', '  Cannot reach the server: check SMTP_HOST / SMTP_PORT (Gmail: 465 with SMTP_SECURE unset, or 587), firewall or antivirus.');
  process.exit(1);
}
