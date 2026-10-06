import { useEffect, useState, type FormEvent } from 'react';
import { BrandMark } from '../common/BrandMark';
import { useLanguage } from '../../app/LanguageProvider';

type AccountMode = 'login' | 'register';

function GoogleMark() {
  return <svg aria-hidden="true" viewBox="0 0 48 48" width="18" height="18"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15Z"/><path fill="#34A853" d="M24 44c5.5 0 10.2-1.8 13.5-4.9l-6.6-5.1c-1.8 1.2-4.1 2-6.9 2-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20 20 0 0 0 24 44Z"/><path fill="#FBBC05" d="M12.6 27.6a12 12 0 0 1 0-7.2v-5.3H5.8a20 20 0 0 0 0 17.8l6.8-5.3Z"/><path fill="#EA4335" d="M24 12c3 0 5.7 1 7.8 3.1l5.9-5.9C34.2 6 29.5 4 24 4A20 20 0 0 0 5.8 15.1l6.8 5.3C14.2 15.6 18.7 12 24 12Z"/></svg>;
}

export function AccountGate({ onSignedIn }: { onSignedIn: () => void }) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<AccountMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [recovery, setRecovery] = useState('');

  useEffect(() => {
    void window.mainsAgentsDesktop?.account.googleConfigured().then(setGoogleConfigured).catch(() => setGoogleConfigured(false));
  }, []);

  const run = async (action: AccountMode) => {
    setBusy(true);
    setStatus('');
    try {
      const api = window.mainsAgentsDesktop?.account;
      if (!api) throw new Error(t('Open MainsAgents Desktop to sign in.'));
      const result: { email: string; userId: string; recoveryCode?: string } = action === 'login' ? await api.login(email, password) : await api.register(email, password);
      localStorage.setItem('mainsagents-profile', result.userId);
      if (action === 'login') onSignedIn();
      else {
        setRecovery(result.recoveryCode ?? '');
        setStatus(t('Account created. Save your recovery code before continuing.'));
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const googleSignIn = async () => {
    setBusy(true);
    setStatus('');
    try {
      const api = window.mainsAgentsDesktop?.account;
      if (!api?.googleSignIn || !googleConfigured) throw new Error(t('Google sign-in needs to be configured by the app developer.'));
      const result = await api.googleSignIn();
      localStorage.setItem('mainsagents-profile', result.userId);
      if (result.recoveryCode) {
        setRecovery(result.recoveryCode);
        setStatus(t('Account created. Save your recovery code before continuing.'));
      } else onSignedIn();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!busy && !recovery) void run(mode);
  };

  return (
    <main className="account-gate">
      <section className="account-gate-card" aria-labelledby="account-title">
        <div className="account-brand"><span className="account-brand-mark" aria-hidden="true"><BrandMark body="#f3f4f6" eye="#121317"/></span><span>Mains<span className="brand-light">Agents</span></span></div>
        <header className="account-intro">
          <h1 id="account-title">{t(mode === 'login' ? 'Welcome back' : 'Create your account')}</h1>
          <p>{t('Sign in to use MainsAgents. Your agents, sessions and history stay on this computer and are never synced to other devices.')}</p>
        </header>

        {!recovery && <>
          <button className="google-sign-in" type="button" disabled={busy || !googleConfigured} onClick={() => void googleSignIn()}>
            <GoogleMark />
            <span>{t('Continue with Google')}</span>
          </button>
          {!googleConfigured && <p className="google-config-note">{t('Google sign-in needs to be configured by the app developer.')}</p>}
          <div className="account-divider"><span>{t('or continue with email')}</span></div>
        </>}

        <form className="account-form" onSubmit={submit}>
          {!recovery && <>
            <label>{t('Email')}<input className="text-input" type="email" name="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
            <label>{t('Password')}<input className="text-input" type="password" name="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={128} required /><span className="account-field-hint">{t('Use at least 12 characters.')}</span></label>
          </>}
          {recovery && <div className="account-recovery"><b>{t('Save this one-time recovery code somewhere safe:')}</b><code>{recovery}</code><p>{t('This code is shown only once and can restore access to your account.')}</p></div>}
          <div className="account-actions">
            {recovery
              ? <button className="primary-button" type="button" onClick={onSignedIn}>{t('Continue to MainsAgents')}</button>
              : <button className="primary-button" type="submit" disabled={busy || !email || password.length < 12}>{busy ? t('Please wait…') : t(mode === 'login' ? 'Sign in' : 'Create account')}</button>}
          </div>
        </form>

        {!recovery && <p className="account-mode-switch">{t(mode === 'login' ? 'New to MainsAgents?' : 'Already have an account?')} <button type="button" disabled={busy} onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setStatus(''); }}>{t(mode === 'login' ? 'Create account' : 'Sign in')}</button></p>}
        {status && <p className="account-feedback" role={recovery ? 'alert' : 'status'}>{status}</p>}
        <p className="account-local-note"><span aria-hidden="true">◉</span>{t('Your work stays on this computer. Google is used only to verify your account.')}</p>
      </section>
    </main>
  );
}
