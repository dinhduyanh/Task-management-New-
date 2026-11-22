import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/common/Icon';
import { GOOGLE_ERROR_MESSAGES, authService } from '../../services/authService';
import './Login.css';

const PASSWORD_CHECKS = [
  ['6+ characters', (value) => value.length >= 6],
  ['Upper & lower case', (value) => /[a-z]/.test(value) && /[A-Z]/.test(value)],
  ['A number', (value) => /\d/.test(value)],
  ['A special character', (value) => /[^A-Za-z0-9]/.test(value)]
];

/** Google's multi-colour "G" (brand colours as published in Google's sign-in branding guidelines). */
function GoogleLogo() {
  return (
    <svg className="login-google-logo" width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** Reads and removes ?auth=google / ?auth_error=... left by the Google redirect. */
function takeGoogleResult() {
  const params = new URLSearchParams(window.location.search);
  const result = { success: params.get('auth') === 'google', isNew: params.get('new') === '1', error: params.get('auth_error') };
  if (result.success || result.error) {
    ['auth', 'auth_error', 'new'].forEach((key) => params.delete(key));
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  }
  return result;
}

export default function Login({ onLogin, notice = '' }) {
  const [googleResult] = useState(takeGoogleResult);
  const [mode, setMode] = useState('signin'); // signin | signup
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(googleResult.error ? (GOOGLE_ERROR_MESSAGES[googleResult.error] || GOOGLE_ERROR_MESSAGES.google_failed) : '');
  const [busy, setBusy] = useState(googleResult.success ? 'google' : '');
  const [providers, setProviders] = useState({ google: true, signup: true });
  const onLoginRef = useRef(onLogin);
  useEffect(() => { onLoginRef.current = onLogin; });

  useEffect(() => {
    let active = true;
    authService.providers().then((value) => { if (active && value) setProviders(value); }).catch(() => {});
    return () => { active = false; };
  }, []);

  // Back from Google with a session cookie: load the user and enter the app.
  useEffect(() => {
    if (!googleResult.success) return undefined;
    let active = true;
    authService.completeGoogleSignIn()
      .then((user) => { if (active) onLoginRef.current?.(user, { isNew: googleResult.isNew, method: 'google' }); })
      .catch(() => { if (active) { setBusy(''); setError(GOOGLE_ERROR_MESSAGES.google_failed); } });
    return () => { active = false; };
  }, [googleResult]);

  function switchMode(next) {
    setMode(next);
    setError('');
    setPassword('');
    setConfirm('');
    setShowPassword(false);
  }

  async function handleSignIn(event) {
    event.preventDefault();
    setError('');
    if (!username.trim() || !password) return setError('Vui lòng nhập Username/Email và Password.');
    setBusy('password');
    try {
      const user = await authService.login(username.trim(), password);
      onLogin?.(user, { method: 'password' });
    } catch (err) { setError(err.message); setBusy(''); }
  }

  async function handleSignUp(event) {
    event.preventDefault();
    setError('');
    if (!fullName.trim() || !email.trim() || !password) return setError('Please fill in your name, email and password.');
    if (!PASSWORD_CHECKS.every(([, test]) => test(password))) return setError('Your password does not meet all the requirements below.');
    if (password !== confirm) return setError('The two passwords do not match.');
    setBusy('password');
    try {
      const user = await authService.register({ fullName, email, password });
      onLogin?.(user, { isNew: true, method: 'password' });
    } catch (err) { setError(err.message); setBusy(''); }
  }

  function handleGoogle(event) {
    if (!providers.google) {
      event.preventDefault();
      setError(GOOGLE_ERROR_MESSAGES.google_not_configured);
      return;
    }
    setError('');
    setBusy('google'); // the browser now leaves for Google
  }

  const signingUp = mode === 'signup';
  const passwordField = (
    <div className="login-input-group">
      <span className="login-input-icon"><Icon name="lock" size={16} /></span>
      <input
        type={showPassword ? 'text' : 'password'}
        name="password"
        aria-label="Password"
        autoComplete={signingUp ? 'new-password' : 'current-password'}
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button type="button" className="password-toggle" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiển thị mật khẩu'}>
        <Icon name={showPassword ? 'eyeOff' : 'eye'} size={17} />
      </button>
    </div>
  );

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-logo" id="login-title">TASK<span>FLOW</span></div>
        <div className="login-heading">
          <h1>{signingUp ? 'Create your account' : 'Sign in to continue'}</h1>
          <p>{signingUp ? 'Start planning and tracking work with your team.' : 'Welcome back! Choose how you want to sign in.'}</p>
        </div>

        {busy === 'google' && googleResult.success ? (
          <div className="login-google-progress" role="status">
            <span className="login-spinner" aria-hidden="true" /> Signing you in with Google…
          </div>
        ) : (
          <>
            {signingUp ? (
              <form className="login-form" onSubmit={handleSignUp} onChange={() => error && setError('')} noValidate>
                <div className="login-input-group">
                  <span className="login-input-icon"><Icon name="user" size={16} /></span>
                  <input type="text" name="fullName" aria-label="Full name" autoComplete="name" placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </div>
                <div className="login-input-group">
                  <span className="login-input-icon"><Icon name="mail" size={16} /></span>
                  <input type="email" name="email" aria-label="Email" autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                {passwordField}
                <div className="login-input-group">
                  <span className="login-input-icon"><Icon name="lock" size={16} /></span>
                  <input type={showPassword ? 'text' : 'password'} name="confirmPassword" aria-label="Confirm password" autoComplete="new-password" placeholder="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                </div>
                <ul className="login-password-rules" aria-label="Password requirements">
                  {PASSWORD_CHECKS.map(([label, test]) => (
                    <li key={label} className={test(password) ? 'is-met' : ''}><Icon name={test(password) ? 'check' : 'close'} size={11} /> {label}</li>
                  ))}
                </ul>
                {error && <p className="login-feedback login-error" role="alert">{error}</p>}
                <button className="login-submit" type="submit" disabled={Boolean(busy)}>{busy === 'password' ? 'CREATING ACCOUNT...' : 'CREATE ACCOUNT'}</button>
              </form>
            ) : (
              <form className="login-form" onSubmit={handleSignIn} onChange={() => error && setError('')}>
                <div className="login-input-group">
                  <span className="login-input-icon"><Icon name="mail" size={16} /></span>
                  <input type="text" name="username" aria-label="Username or Email" autoComplete="username" placeholder="Username / Email" value={username} onChange={(e) => setUsername(e.target.value)} />
                </div>
                {passwordField}
                {notice && !error && <p className="login-feedback login-info" role="status">{notice}</p>}
                {error && <p className="login-feedback login-error" role="alert">{error}</p>}
                <button className="login-submit" type="submit" disabled={Boolean(busy)}>{busy === 'password' ? 'SIGNING IN...' : 'SIGN IN WITH EMAIL'}</button>
              </form>
            )}

            <div className="login-divider" role="separator"><span>Or continue with</span></div>

            <a
              className={`login-google ${busy === 'google' ? 'is-busy' : ''}`}
              href={authService.googleSignInUrl()}
              onClick={handleGoogle}
              aria-disabled={busy === 'google' || undefined}
            >
              {busy === 'google' ? <span className="login-spinner" aria-hidden="true" /> : <GoogleLogo />}
              <span>{busy === 'google' ? 'Redirecting to Google…' : signingUp ? 'Sign up with Google' : 'Continue with Google'}</span>
            </a>

            {(providers.signup || signingUp) && (
              <p className="login-switch">
                {signingUp ? 'Already have an account?' : "Don't have an account?"}{' '}
                <button type="button" onClick={() => switchMode(signingUp ? 'signin' : 'signup')}>{signingUp ? 'Sign in' : 'Sign up'}</button>
              </p>
            )}
          </>
        )}
        <p className="login-demo-note">By continuing you agree to use TASKFLOW responsibly. Google sign-in only shares your name, email and profile photo.</p>
      </section>
    </main>
  );
}
