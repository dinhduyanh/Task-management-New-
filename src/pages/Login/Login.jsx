import { useState } from 'react';
import Icon from '../../components/common/Icon';
import { authService } from '../../services/authService';
import './Login.css';

export default function Login({ onLogin, notice = '' }) {
  const [username,setUsername]=useState('');
  const [password,setPassword]=useState('');
  const [showPassword,setShowPassword]=useState(false);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);

  const handleSubmit=async(event)=>{
    event.preventDefault(); setError('');
    if(!username.trim() || !password) return setError('Vui lòng nhập Username/Email và Password.');
    setBusy(true);
    try {
      const user=await authService.login(username.trim(),password);
      onLogin?.(user);
    } catch(err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return <main className="login-page">
    <section className="login-card" aria-labelledby="login-title">
      <div className="login-logo" id="login-title">TASK<span>FLOW</span></div>
      <form className="login-form" onSubmit={handleSubmit}>
        <div className="login-input-group">
          <span className="login-input-icon"><Icon name="mail" size={16}/></span>
          <input type="text" name="username" aria-label="Username or Email" autoComplete="username" placeholder="Username / Email" value={username} onChange={e=>setUsername(e.target.value)}/>
        </div>
        <div className="login-input-group">
          <span className="login-input-icon"><Icon name="lock" size={16}/></span>
          <input type={showPassword?'text':'password'} name="password" aria-label="Password" autoComplete="current-password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)}/>
          <button type="button" className="password-toggle" onClick={()=>setShowPassword(v=>!v)} aria-label={showPassword?'Ẩn mật khẩu':'Hiển thị mật khẩu'}><Icon name={showPassword?'eyeOff':'eye'} size={17}/></button>
        </div>
        {notice && !error && <p className="login-feedback login-info" role="status">{notice}</p>}
        {error && <p className="login-feedback login-error" role="alert">{error}</p>}
        <button className="login-submit" type="submit" disabled={busy}>{busy?'SIGNING IN...':'SIGN IN WITH EMAIL'}</button>
      </form>
      <p className="login-demo-note">Authentication is connected to TASKFLOW Backend.</p>
    </section>
  </main>;
}
