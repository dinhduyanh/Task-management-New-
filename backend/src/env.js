// Loads backend/.env into process.env (values already set in the environment win).
// Imported first by server.js so every module sees the values.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// TASKFLOW_ENV_FILE points to another file (e.g. for tests); default backend/.env.
const envPath = process.env.TASKFLOW_ENV_FILE || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');

if (fs.existsSync(envPath)) {
  // Tolerates a UTF-8 BOM, Windows line endings, spaces around "=" and quotes.
  for (const line of fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^(['"])(.*)\1$/, '$2').trim();
  }
}

const KNOWN_KEYS = ['GEMINI_API_KEY', 'OPENAI_API_KEY'];

/** Start-up line saying which AI engine is active, with a hint for mistyped key names. */
export function describeAiConfiguration() {
  const lines = [];
  if (process.env.GEMINI_API_KEY) lines.push(`AI assistant: Gemini (${process.env.GEMINI_MODEL || 'gemini-2.5-flash'})`);
  else if (process.env.OPENAI_API_KEY) lines.push(`AI assistant: OpenAI (${process.env.OPENAI_MODEL || 'gpt-4o-mini'})`);
  else lines.push('AI assistant: rules engine (no GEMINI_API_KEY or OPENAI_API_KEY found)');
  const unknown = Object.keys(process.env).filter((key) => /API_?KEY$/i.test(key) && !KNOWN_KEYS.includes(key) && /(gemini|openai|penai|open_ai|gpt)/i.test(key));
  unknown.forEach((key) => lines.push(`  ! ${key} is not a recognised name - did you mean ${/gem/i.test(key) ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY'}?`));
  return lines;
}
