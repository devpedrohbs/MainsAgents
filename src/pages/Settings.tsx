import { useEffect, useRef, useState } from 'react';
import { useWorkspaces } from '../app/WorkspaceProvider';
import { useLanguage } from '../app/LanguageProvider';
import {
  describeBackup,
  exportBackup,
  importBackup,
  parseBackup,
  type BackupFile,
  type ImportMode,
} from '../data/backup';
import { usePersistentState } from '../data/localPersistence';
import { SelectMenu } from '../components/common/SelectMenu';
import {backupFileReferences} from '../data/backupFormat';
import {RuntimeDiagnostics} from '../components/chat/RuntimeDiagnostics';

export type SettingsSection = 'interface' | 'providers' | 'data' | 'account' | 'help';
export function Settings({ initialSection = 'interface' }: { initialSection?: SettingsSection }) {
  const [backupLinks,setBackupLinks]=useState<Array<{path:string;available:boolean}>|null>(null);
  const { currentWorkspace } = useWorkspaces();
  const {
    locale,
    setLocale,
    appearance,
    setAppearance,
    focusMode,
    setFocusMode,
    textScale,
    setTextScale,
    reducedMotion,
    setReducedMotion,
    t,
  } = useLanguage();
  const [section, setSection] = useState<SettingsSection>(initialSection);
  useEffect(() => setSection(initialSection), [initialSection]);
  const sections: { id: SettingsSection; label: string; detail: string }[] = [
    {
      id: 'interface',
      label: locale === 'pt-BR' ? 'Interface' : 'Interface',
      detail:
        locale === 'pt-BR'
          ? 'Tema, idioma e leitura do seu jeito.'
          : 'Your theme, language, and reading preferences.',
    },
    {
      id: 'providers',
      label: locale === 'pt-BR' ? 'Conexões de IA' : 'AI connections',
      detail:
        locale === 'pt-BR'
          ? 'Conecte os CLIs e escolha o modelo padrão para novas conversas.'
          : 'Connect your CLIs and choose a default model for new conversations.',
    },
    {
      id: 'data',
      label: locale === 'pt-BR' ? 'Dados e backup' : 'Data and backup',
      detail:
        locale === 'pt-BR'
          ? 'Seu histórico fica neste computador. Exporte uma cópia quando precisar.'
          : 'Your history stays on this computer. Export a copy when needed.',
    },
    {
      id: 'account',
      label: locale === 'pt-BR' ? 'Conta local' : 'Local account',
      detail:
        locale === 'pt-BR'
          ? 'Opcional. Separe perfis neste computador.'
          : 'Optional. Keep separate profiles on this computer.',
    },
    {
      id: 'help',
      label: locale === 'pt-BR' ? 'Ajuda' : 'Help',
      detail:
        locale === 'pt-BR'
          ? 'Diagnóstico e contato com o projeto.'
          : 'Diagnostics and contact with the project.',
    },
  ];
  const currentSection = sections.find((item) => item.id === section)!;
  const [selectedBackup, setSelectedBackup] = useState<BackupFile | null>(null);
  const [feedback, setFeedback] = useState('');
  const [working, setWorking] = useState(false);
  const [codexStatus, setCodexStatus] = useState<'checking' | 'connected' | 'login-required' | 'unavailable'>(
    'checking',
  );
  const [codexMessage, setCodexMessage] = useState('');
  const [claudeStatus, setClaudeStatus] = useState<
    'checking' | 'connected' | 'login-required' | 'not-installed' | 'error'
  >('checking');
  const [claudeMessage, setClaudeMessage] = useState('');
  const [claudeInstallCommand, setClaudeInstallCommand] = useState('');
  const [claudeLoginCommand, setClaudeLoginCommand] = useState('claude auth login');
  const [appVersion, setAppVersion] = useState('');
  const [models, setModels] = useState<readonly { id: string; name: string }[]>([]);
  const [defaultCodexModelId, setDefaultCodexModelId] = usePersistentState<string>('default-codex-model', '');
  const [account, setAccount] = useState<{
    configured: boolean;
    signedIn: boolean;
    serverUrl?: string;
    email?: string;
    userId?: string;
  }>({ configured: false, signedIn: false });
  const [accountEmail, setAccountEmail] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [accountMessage, setAccountMessage] = useState('');
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [googleRecoveryCode, setGoogleRecoveryCode] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const checkCodex = async () => {
    try {
      const response = await fetch('/api/codex/health');
      const data = await response.json();
      setCodexStatus(
        data.ready ? 'connected' : data.status === 'login-required' ? 'login-required' : 'unavailable',
      );
      setCodexMessage(data.error ?? '');
    } catch {
      setCodexStatus('unavailable');
    }
  };
  const checkClaude = async () => {
    try {
      const response = await fetch('/api/providers/claude/status');
      const data = await response.json();
      setClaudeStatus(data.state ?? 'error');
      setClaudeMessage(data.message ?? '');
      setClaudeInstallCommand(data.installCommand ?? '');
      setClaudeLoginCommand(data.loginCommand ?? 'claude auth login');
    } catch {
      setClaudeStatus('error');
      setClaudeMessage(t('Could not check Claude Code CLI.'));
    }
  };
  useEffect(() => {
    void checkCodex();
    void checkClaude();
    void fetch('/api/app/version')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data?.version) setAppVersion(data.version);
      })
      .catch(() => {});
    const timer = window.setInterval(() => {
      void checkCodex();
      void checkClaude();
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (codexStatus !== 'connected') return;
    let active = true;
    void fetch('/api/codex/models')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (active && Array.isArray(data?.models)) setModels(data.models);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [codexStatus]);
  const refreshAccount = async () => {
    if (!window.mainsAgentsDesktop) {
      setAccountMessage(t('Accounts are available in the desktop app.'));
      return;
    }
    try {
      const [state, googleReady] = await Promise.all([
        window.mainsAgentsDesktop.account.status(),
        window.mainsAgentsDesktop.account.googleConfigured(),
      ]);
      setAccount(state);
      setGoogleConfigured(googleReady);
      if (state.signedIn && state.userId && localStorage.getItem('mainsagents-profile') !== state.userId) {
        localStorage.setItem('mainsagents-profile', state.userId);
        window.location.reload();
      }
      if (state.email) setAccountEmail(state.email);
    } catch (error) {
      setAccountMessage(error instanceof Error ? error.message : String(error));
    }
  };
  useEffect(() => {
    void refreshAccount();
  }, []);
  const accountAction = async (action: 'login' | 'register') => {
    try {
      if (!window.mainsAgentsDesktop) throw new Error(t('Accounts are available in the desktop app.'));
      if (action === 'login') {
        const result = await window.mainsAgentsDesktop.account.login(accountEmail, accountPassword);
        localStorage.setItem('mainsagents-profile', result.userId);
        setAccountMessage(t('Signed in. Opening your local workspace…'));
        window.setTimeout(() => window.location.reload(), 500);
      } else {
        const result = await window.mainsAgentsDesktop.account.register(accountEmail, accountPassword);
        localStorage.setItem('mainsagents-profile', result.userId);
        setAccountMessage(
          t('Account created. Save your recovery code: {{code}}', { code: result.recoveryCode }),
        );
        window.setTimeout(() => window.location.reload(), 2500);
      }
      setAccountPassword('');
    } catch (error) {
      setAccountMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const accountGoogleAction = async () => {
    try {
      if (!window.mainsAgentsDesktop) throw new Error(t('Accounts are available in the desktop app.'));
      const result = await window.mainsAgentsDesktop.account.googleSignIn();
      localStorage.setItem('mainsagents-profile', result.userId);
      if (result.recoveryCode) {
        setGoogleRecoveryCode(result.recoveryCode);
        setAccountMessage(t('Save this one-time recovery code somewhere safe:'));
      } else {
        setAccountMessage(t('Signed in. Opening your local workspace…'));
        window.setTimeout(() => window.location.reload(), 500);
      }
    } catch (error) {
      setAccountMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const logoutAccount = async () => {
    try {
      await window.mainsAgentsDesktop?.account.logout();
      localStorage.removeItem('mainsagents-profile');
      setAccount({ configured: account.configured, signedIn: false, serverUrl: account.serverUrl });
      window.location.reload();
    } catch (error) {
      setAccountMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const reconnectCodex = async () => {
    setCodexStatus('checking');
    try {
      const response = await fetch('/api/codex/reconnect', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Codex is unavailable');
      await checkCodex();
    } catch (error) {
      setCodexStatus('unavailable');
      setCodexMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const loginCodex = async () => {
    try {
      const response = await fetch('/api/codex/login', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not start login');
      if (typeof data.authUrl === 'string' && data.authUrl.startsWith('https://'))
        window.open(data.authUrl, '_blank', 'noopener,noreferrer');
      setCodexMessage(t('Complete sign-in in the browser, then check again.'));
    } catch (error) {
      setCodexMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const copyClaudeCommand = async (command: string) => {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      setClaudeMessage(t('Command copied. Run it in your terminal, then check the connection again.'));
    } catch {
      setClaudeMessage(`${t('Run this command in PowerShell or your terminal:')} ${command}`);
    }
  };
  const downloadDiagnostics = () => {
    const report = {
      app: 'MainsAgents',
      version: appVersion || 'development',
      date: new Date().toISOString(),
      locale,
      codexStatus,
      storage: 'IndexedDB',
      note: 'This report does not include prompts, messages, files, account data, or credentials.',
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'mainsagents-diagnostics.json';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const download = async () => {
    setWorking(true);
    try {
      const backup = await exportBackup();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `mainsagents-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setFeedback(t('Backup exported'));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setWorking(false);
    }
  };
  const selectBackup = async (file?: File) => {
    setSelectedBackup(null);
    setBackupLinks(null);
    setFeedback('');
    if (!file) return;
    try {
      const parsed=parseBackup(await file.text());
      const paths=backupFileReferences(parsed);
      if(window.mainsAgentsDesktop?.backup?.inspectFiles)setBackupLinks(await window.mainsAgentsDesktop.backup.inspectFiles(paths));
      setSelectedBackup(parsed);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    }
  };
  const restore = async (mode: ImportMode) => {
    if (!selectedBackup) return;
    setWorking(true);
    try {
      await importBackup(selectedBackup, mode);
      setFeedback(t('Backup imported. Reloading…'));
      window.location.reload();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
      setWorking(false);
    }
  };

  return (
    <div className="page settings-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">{currentWorkspace.name} / {t('Settings')}</p>
          <h1>{locale === 'pt-BR' ? 'Seu espaço, do seu jeito' : 'Your space, your way'}</h1>
          <p>{t('General preferences for {{name}} and its agents.', { name: currentWorkspace.name })}</p>
        </div>
      </div>
      <div className="settings-grid">
        <nav className="settings-nav" aria-label={t('Settings')}>
          {sections.map((item) => (
            <button
              key={item.id}
              type="button"
              className={section === item.id ? 'active' : ''}
              aria-pressed={section === item.id}
              aria-controls={`settings-${item.id}`}
              onClick={() => setSection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <section className="settings-panel">
          <header className="settings-section-head">
            <h2>{currentSection.label}</h2>
            <p>{currentSection.detail}</p>
          </header>
          <div id="settings-account" className="settings-group" hidden={section !== 'account'}>
            <div className="setting-row">
              <div className="setting-copy">
                <b>{t('MainsAgents account')}</b>
                <p>
                  {t(
                    'Optional local account. The app works without signing in, and data is never synced to another device.',
                  )}
                </p>
                <p>{account.signedIn ? `${t('Signed in as')} ${account.email}` : t('Not signed in')}</p>
              </div>
              <div className="settings-data-actions">
                {account.signedIn ? (
                  <button className="soft-button" type="button" onClick={logoutAccount}>
                    {t('Sign out')}
                  </button>
                ) : null}
              </div>
            </div>
            {!account.signedIn && (
              <div className="account-form">
                <p>{t('Use an optional local account to keep a separate profile on this computer.')}</p>
                {!googleRecoveryCode && (
                  <>
                    <label>
                      {t('Email')}
                      <input
                        className="text-input"
                        type="email"
                        autoComplete="username"
                        value={accountEmail}
                        onChange={(event) => setAccountEmail(event.target.value)}
                      />
                    </label>
                    <label>
                      {t('Password')}
                      <input
                        className="text-input"
                        type="password"
                        autoComplete="current-password"
                        value={accountPassword}
                        onChange={(event) => setAccountPassword(event.target.value)}
                      />
                    </label>
                    <div className="settings-data-actions">
                      <button
                        className="soft-button"
                        type="button"
                        onClick={() => void accountAction('login')}
                      >
                        {t('Sign in')}
                      </button>
                      <button
                        className="soft-button"
                        type="button"
                        onClick={() => void accountAction('register')}
                      >
                        {t('Create account')}
                      </button>
                      {googleConfigured && (
                        <button
                          className="soft-button"
                          type="button"
                          onClick={() => void accountGoogleAction()}
                        >
                          {t('Continue with Google')}
                        </button>
                      )}
                    </div>
                  </>
                )}
                {googleRecoveryCode && (
                  <div className="account-recovery">
                    <code>{googleRecoveryCode}</code>
                    <button className="primary-button" type="button" onClick={() => window.location.reload()}>
                      {t('Continue to MainsAgents')}
                    </button>
                  </div>
                )}
                {accountMessage && (
                  <p className="settings-feedback" role="status">
                    {accountMessage}
                  </p>
                )}
              </div>
            )}
          </div>
          <div id="settings-interface" className="settings-group" hidden={section !== 'interface'}>
            <div className="setting-row appearance-setting">
              <div className="setting-copy">
                <b>{t('Appearance')}</b>
                <p>{locale === 'pt-BR' ? 'Escolha o contraste do seu espaço de trabalho.' : 'Choose the contrast of your workspace.'}</p>
              </div>
              <div className="appearance-options" role="group" aria-label={t('Appearance')}>
                <button
                  className={`appearance-option light ${appearance === 'light' ? 'selected' : ''}`}
                  type="button"
                  aria-pressed={appearance === 'light'}
                  onClick={() => setAppearance('light')}
                >
                  <span className="appearance-preview" aria-hidden="true" />
                  <span className="appearance-label">
                    <b>{t('Light')}</b>
                    <small>{locale === 'pt-BR' ? 'Superfícies claras e conteúdo em destaque' : 'Light surfaces, content in focus'}</small>
                  </span>
                  <span className="appearance-check" aria-hidden="true">
                    {appearance === 'light' ? '✓' : ''}
                  </span>
                </button>
                <button
                  className={`appearance-option dark ${appearance === 'dark' ? 'selected' : ''}`}
                  type="button"
                  aria-pressed={appearance === 'dark'}
                  onClick={() => setAppearance('dark')}
                >
                  <span className="appearance-preview" aria-hidden="true" />
                  <span className="appearance-label">
                    <b>{t('Dark')}</b>
                    <small>{locale === 'pt-BR' ? 'Contraste suave para ambientes escuros' : 'Soft contrast for darker environments'}</small>
                  </span>
                  <span className="appearance-check" aria-hidden="true">
                    {appearance === 'dark' ? '✓' : ''}
                  </span>
                </button>
              </div>
            </div>
            <div className="setting-row">
              <div className="setting-copy">
                <b>{t('Interface language')}</b>
                <p>{t('Choose the language used throughout MainsAgents.')}</p>
              </div>
              <SelectMenu
                className="settings-select"
                value={locale}
                onChange={(value) => setLocale(value as 'en-US' | 'pt-BR')}
                ariaLabel={t('Language')}
                options={[
                  { value: 'en-US', label: 'English (US)' },
                  { value: 'pt-BR', label: 'Português (Brasil)' },
                ]}
              />
            </div>
            <div className="setting-row">
              <div className="setting-copy">
                <b>{t('Text size')}</b>
                <p>{t('Adjust the entire interface for easier reading.')}</p>
              </div>
              <SelectMenu
                className="settings-select"
                value={String(textScale)}
                onChange={(value) => setTextScale(Number(value))}
                ariaLabel={t('Text size')}
                options={[100, 125, 150, 200].map((size) => ({ value: String(size), label: `${size}%` }))}
              />
            </div>
            <div className="setting-row">
              <div className="setting-copy">
                <b>{t('Focus writing mode')}</b>
                <p>
                  {t('Give writing fields more space and improve readability while creating or editing.')}
                </p>
              </div>
              <button
                className={`toggle ${focusMode ? 'on' : ''}`}
                aria-label={t('Focus writing mode')}
                aria-pressed={focusMode}
                onClick={() => setFocusMode(!focusMode)}
              />
            </div>
            <div className="setting-row">
              <div className="setting-copy">
                <b>{t('Reduced motion')}</b>
                <p>{t('Minimize zoom and transition effects.')}</p>
              </div>
              <button
                className={`toggle ${reducedMotion ? 'on' : ''}`}
                aria-label={t('Reduced motion')}
                aria-pressed={reducedMotion}
                onClick={() => setReducedMotion(!reducedMotion)}
              />
            </div>
            <div className="setting-row">
              <div className="setting-copy">
                <b>{t('Welcome guide')}</b>
                <p>{t('Reopen the first-use steps and agent templates.')}</p>
              </div>
              <button
                className="soft-button"
                type="button"
                onClick={() => window.dispatchEvent(new Event('mainsagents:show-welcome'))}
              >
                {t('Open guide')}
              </button>
            </div>
          </div>
          <div id="settings-providers" className="settings-group" hidden={section !== 'providers'}>
            {section==='providers'&&<RuntimeDiagnostics/>}
            <div className="setting-row">
              <div className="setting-copy">
                <b>{t('Codex CLI connection')}</b>
                <p>
                  {t(
                    codexStatus === 'connected'
                      ? 'Connected and ready to chat.'
                      : codexStatus === 'login-required'
                        ? 'Sign in to Codex to send messages.'
                        : codexStatus === 'unavailable'
                          ? 'Codex is unavailable. Install the CLI and reconnect.'
                          : 'Checking connection…',
                  )}
                </p>
                {codexMessage && (
                  <p className="settings-feedback" role="status">
                    {codexMessage}
                  </p>
                )}
              </div>
              <div className="settings-data-actions">
                {codexStatus === 'login-required' && (
                  <button className="soft-button" type="button" onClick={loginCodex}>
                    {t('Sign in')}
                  </button>
                )}
                {codexStatus === 'unavailable' && (
                  <button className="soft-button" type="button" onClick={reconnectCodex}>
                    {t('Reconnect')}
                  </button>
                )}
                <button className="soft-button" type="button" onClick={checkCodex}>
                  {t('Check again')}
                </button>
              </div>
            </div>
            {models.length > 0 && (
              <div className="setting-row">
                <div className="setting-copy">
                  <b>{t('Default Codex model')}</b>
                  <p>{t('Applies to new sessions. Existing sessions keep their model.')}</p>
                </div>
                <SelectMenu
                  className="settings-select model-settings-select"
                  value={defaultCodexModelId}
                  onChange={setDefaultCodexModelId}
                  ariaLabel={t('Default Codex model')}
                  options={[
                    { value: '', label: t('Provider default') },
                    ...models.map((model) => ({ value: model.id, label: model.name })),
                  ]}
                />
              </div>
            )}
            <div className="setting-row">
              <div className="setting-copy">
                <b>{t('Claude Code CLI connection')}</b>
                <p>
                  {t(
                    claudeStatus === 'connected'
                      ? 'Connected with Claude Code CLI.'
                      : claudeStatus === 'login-required'
                        ? 'Claude Code CLI is installed. Sign in through its own CLI flow.'
                        : claudeStatus === 'not-installed'
                          ? 'Claude Code CLI is not installed on this computer.'
                          : claudeStatus === 'checking'
                            ? 'Checking connection…'
                            : 'Claude Code CLI connection needs attention.',
                  )}
                </p>
                {claudeStatus === 'not-installed' && claudeInstallCommand && (
                  <p>
                    <code>{claudeInstallCommand}</code>
                  </p>
                )}
                {claudeStatus === 'login-required' && (
                  <p>
                    <code>{claudeLoginCommand}</code>
                  </p>
                )}
                {claudeMessage && (
                  <p className="settings-feedback" role="status">
                    {claudeMessage}
                  </p>
                )}
                <p>
                  {t(
                    'MainsAgents does not read Claude credentials. Check Anthropic terms before distributing an app that runs Claude Code.',
                  )}
                </p>
              </div>
              <div className="settings-data-actions">
                {claudeStatus === 'not-installed' && claudeInstallCommand && (
                  <button
                    className="soft-button"
                    type="button"
                    onClick={() => void copyClaudeCommand(claudeInstallCommand)}
                  >
                    {t('Copy install command')}
                  </button>
                )}
                {claudeStatus === 'login-required' && (
                  <button
                    className="soft-button"
                    type="button"
                    onClick={() => void copyClaudeCommand(claudeLoginCommand)}
                  >
                    {t('Copy sign-in command')}
                  </button>
                )}
                <button className="soft-button" type="button" onClick={() => void checkClaude()}>
                  {t('Check again')}
                </button>
              </div>
            </div>
          </div>
          <div id="settings-data" className="settings-group" hidden={section !== 'data'}>
            <div className="setting-row settings-data-row">
              <div className="setting-copy">
                <b>{t('Your data')}</b>
                <p>{t('Save a local copy of your work or restore it on another computer.')}</p>
              </div>
              <div className="settings-data-actions">
                <button className="soft-button" type="button" disabled={working} onClick={download}>
                  {t('Export backup')}
                </button>
                <button
                  className="soft-button"
                  type="button"
                  disabled={working}
                  onClick={() => fileRef.current?.click()}
                >
                  {t('Import backup')}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  hidden
                  aria-label={t('Open a MainsAgents backup file.')}
                  onChange={(event) => {
                    void selectBackup(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
              </div>
            </div>
            {selectedBackup && (
              <div className="backup-preview" role="region" aria-label={t('Import backup')}>
                <b>{describeBackup(selectedBackup)}</b>
                <p>{t('Review the backup before importing. Replacing keeps only the selected backup.')}</p>
                {selectedBackup.recovery&&<p>{locale==='pt-BR'?'Este é um backup de recuperação com alterações ainda não confirmadas em disco.':'This recovery backup includes changes not yet confirmed on disk.'}</p>}
                {backupLinks&&backupLinks.some(link=>!link.available)&&<details open><summary>{locale==='pt-BR'?'Arquivos e pastas a religar':'Files and folders to relink'} · {backupLinks.filter(link=>!link.available).length}</summary><p>{locale==='pt-BR'?'Após importar, religue skills nas configurações do agente e arquivos na biblioteca do conteúdo. Estes arquivos externos não estão incluídos no JSON.':'After importing, relink skills in agent settings and files in the content library. These external files are not included in the JSON.'}</p><ul>{backupLinks.filter(link=>!link.available).map(link=><li key={link.path}><code>{link.path}</code></li>)}</ul></details>}
                {!backupLinks&&backupFileReferences(selectedBackup).length>0&&<p>{locale==='pt-BR'?'Confira as pastas de skills e os arquivos dos conteúdos após importar; o navegador não verifica arquivos locais.':'Check skill folders and content files after importing; the browser cannot inspect local files.'}</p>}
                <div>
                  <button
                    className="soft-button"
                    type="button"
                    disabled={working}
                    onClick={() => restore('merge')}
                  >
                    {t('Merge with local data')}
                  </button>
                  <button
                    className="soft-button"
                    type="button"
                    disabled={working}
                    onClick={() => restore('replace')}
                  >
                    {t('Replace local data')}
                  </button>
                  <button className="soft-button" type="button" onClick={() => setSelectedBackup(null)}>
                    {t('Cancel')}
                  </button>
                </div>
              </div>
            )}
            {feedback && (
              <p className="settings-feedback" role="status">
                {feedback}
              </p>
            )}
          </div>
          <div id="settings-help" className="settings-group" hidden={section !== 'help'}>
            <div className="setting-row">
              <div className="setting-copy">
                <b>{t('Help and feedback')}</b>
                <p>{t('Download a diagnostic report without private content or open an issue.')}</p>
              </div>
              <div className="settings-data-actions">
                <button className="soft-button" onClick={downloadDiagnostics}>
                  {t('Download diagnostics')}
                </button>
                <button
                  className="soft-button"
                  onClick={() =>
                    window.open(
                      'https://github.com/devpedrohbs/MainsAgents/issues/new',
                      '_blank',
                      'noopener,noreferrer',
                    )
                  }
                >
                  {t('Send feedback')}
                </button>
              </div>
            </div>
            {appVersion && <p className="settings-version">MainsAgents {appVersion}</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
