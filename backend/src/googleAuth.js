// Google sign-in (OpenID Connect, authorization-code flow with PKCE).
//
// The browser is sent to Google; Google redirects back to /api/auth/google/callback with a
// one-time code. The server exchanges the code (with the client secret and PKCE verifier)
// directly with Google's token endpoint over TLS and reads the ID token from that response.
// Because the ID token comes straight from Google's token endpoint, its issuer is
// authenticated by TLS (OpenID Connect Core 3.1.3.7); the claims are still checked:
// issuer, audience, expiry, nonce and a verified email.
import { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';
import process from 'node:process';

const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

export function googleConfig() {
  const port = Number(process.env.PORT || 4000);
  const firstOrigin = String(process.env.FRONTEND_ORIGIN || '').split(',')[0].trim();
  return {
    clientId: String(process.env.GOOGLE_CLIENT_ID || '').trim(),
    clientSecret: String(process.env.GOOGLE_CLIENT_SECRET || '').trim(),
    redirectUri: String(process.env.GOOGLE_REDIRECT_URI || `http://localhost:${port}/api/auth/google/callback`).trim(),
    // Where the browser goes after signing in (the TASKFLOW web app).
    appUrl: String(process.env.APP_URL || firstOrigin || 'http://localhost:5173').trim().replace(/\/+$/, ''),
    // Google endpoints; only overridden by automated tests that use a local stand-in.
    authUrl: process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
    timeoutMs: Number(process.env.GOOGLE_TIMEOUT_MS || 10000)
  };
}

export function googleEnabled(config = googleConfig()) {
  return Boolean(config.clientId && config.clientSecret);
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const pkceChallenge = (verifier) => createHash('sha256').update(verifier).digest('base64url');

/** URL of Google's consent screen for one sign-in attempt. */
export function authorizationUrl(config, { state, codeVerifier, nonce }) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: pkceChallenge(codeVerifier),
    code_challenge_method: 'S256',
    prompt: 'select_account'
  });
  return `${config.authUrl}?${params}`;
}

function decodeJwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Google returned an invalid ID token.');
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

/**
 * Exchanges the authorization code and returns the verified Google profile:
 * { sub, email, name, picture }.
 */
export async function exchangeCodeForProfile(config, { code, codeVerifier, nonce }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  let response;
  try {
    response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier
      }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.id_token) throw new Error(`Google token exchange failed (${response.status}${body.error ? `: ${body.error}` : ''}).`);

  const claims = decodeJwtPayload(body.id_token);
  if (!GOOGLE_ISSUERS.has(claims.iss)) throw new Error('ID token issuer is not Google.');
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(config.clientId)) throw new Error('ID token was issued for another application.');
  if (!claims.exp || claims.exp * 1000 < Date.now()) throw new Error('ID token has expired.');
  if (claims.nonce !== nonce) throw new Error('ID token nonce does not match this sign-in.');
  if (!claims.sub) throw new Error('ID token has no subject.');
  if (!claims.email || !(claims.email_verified === true || claims.email_verified === 'true')) {
    throw new Error('Google account email is not verified.');
  }
  return {
    sub: String(claims.sub),
    email: String(claims.email).trim().toLowerCase(),
    name: String(claims.name || '').trim(),
    picture: /^https:\/\//.test(String(claims.picture || '')) ? String(claims.picture) : null
  };
}
