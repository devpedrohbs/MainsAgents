import { createElement, useEffect, useRef, useState, type FormEvent } from 'react';
import { useLanguage } from '../../../app/LanguageProvider';
import { browserDestination, browserHome } from '../browserNavigation';

interface BrowserElement extends HTMLElement {
  loadURL(url: string): Promise<void>;
  reload(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
}

export function CanvasBrowser({ url, onNavigate }: { url: string; onNavigate(url: string): void }) {
  const { t, locale } = useLanguage();
  const pt = locale === 'pt-BR';
  const desktop = Boolean(window.mainsAgentsDesktop?.canvasBrowser);
  const browserRef = useRef<BrowserElement>(null);
  const ready = useRef(false);
  const requestedUrl = useRef(url);
  const navigatedUrl = useRef(url);
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const [draft, setDraft] = useState(url);
  const [loading, setLoading] = useState(desktop);
  const [failed, setFailed] = useState(false);
  const [history, setHistory] = useState({ back: false, forward: false });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const browser = browserRef.current;
    if (!browser) return;
    const historyChanged = () => {
      if (ready.current) setHistory({ back: browser.canGoBack(), forward: browser.canGoForward() });
    };
    const start = () => { setLoading(true); setFailed(false); };
    const stop = () => { setLoading(false); historyChanged(); };
    const fail = (event: Event) => {
      const failure = event as Event & { errorCode: number; isMainFrame: boolean };
      if (failure.isMainFrame && failure.errorCode !== -3) { setFailed(true); setLoading(false); }
    };
    const navigate = (event: Event) => {
      const destination = event as Event & { url: string; isMainFrame?: boolean };
      if (destination.isMainFrame === false || !/^https?:\/\//i.test(destination.url)) return;
      navigatedUrl.current = destination.url;
      requestedUrl.current = destination.url;
      setDraft(destination.url);
      onNavigateRef.current(destination.url);
      historyChanged();
    };
    const domReady = () => {
      ready.current = true;
      historyChanged();
      if (requestedUrl.current !== navigatedUrl.current) {
        const destination = requestedUrl.current;
        navigatedUrl.current = destination;
        void browser.loadURL(destination).catch(() => { setFailed(true); setLoading(false); });
      }
    };
    browser.addEventListener('dom-ready', domReady);
    browser.addEventListener('did-start-loading', start);
    browser.addEventListener('did-stop-loading', stop);
    browser.addEventListener('did-fail-load', fail);
    browser.addEventListener('did-navigate', navigate);
    browser.addEventListener('did-navigate-in-page', navigate);
    // Observe failures before starting the first load.
    browser.setAttribute('src', requestedUrl.current);
    return () => {
      ready.current = false;
      browser.removeEventListener('dom-ready', domReady);
      browser.removeEventListener('did-start-loading', start);
      browser.removeEventListener('did-stop-loading', stop);
      browser.removeEventListener('did-fail-load', fail);
      browser.removeEventListener('did-navigate', navigate);
      browser.removeEventListener('did-navigate-in-page', navigate);
    };
  }, [reloadKey]);

  useEffect(() => {
    setDraft(url);
    requestedUrl.current = url;
    const browser = browserRef.current;
    if (!browser || navigatedUrl.current === url || !ready.current) return;
    navigatedUrl.current = url;
    setFailed(false);
    setLoading(true);
    void browser.loadURL(url).catch(() => { setFailed(true); setLoading(false); });
  }, [url]);

  const reload = () => {
    setFailed(false);
    if (desktop && ready.current) { setLoading(true); browserRef.current?.reload(); }
    else { setLoading(desktop); setReloadKey(key => key + 1); }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const destination = browserDestination(draft);
    if (destination) { if (destination === url) reload(); else onNavigate(destination); }
  };
  const go = (direction: 'back' | 'forward') => {
    if (!ready.current) return;
    if (direction === 'back') browserRef.current?.goBack();
    else browserRef.current?.goForward();
  };

  return <>
    <div className="browser-navigation nodrag nowheel">
      <div className="browser-history">
        <button type="button" disabled={!history.back} onClick={() => go('back')} aria-label={pt ? 'Voltar' : 'Back'} title={pt ? 'Voltar' : 'Back'}>←</button>
        <button type="button" disabled={!history.forward} onClick={() => go('forward')} aria-label={pt ? 'Avançar' : 'Forward'} title={pt ? 'Avançar' : 'Forward'}>→</button>
        <button type="button" onClick={reload} aria-label={t('Reload')} title={t('Reload')}>↻</button>
        <button type="button" onClick={() => url === browserHome ? reload() : onNavigate(browserHome)} aria-label={pt ? 'Abrir Google' : 'Open Google'} title={pt ? 'Abrir Google' : 'Open Google'}>⌂</button>
      </div>
      <form className="browser-address" onSubmit={submit}>
        <input aria-label={pt ? 'Pesquisar no Google ou digitar endereço' : 'Search Google or enter an address'} value={draft} onChange={event => setDraft(event.target.value)} placeholder={pt ? 'Pesquisar no Google ou digitar endereço' : 'Search Google or enter an address'} onFocus={event => event.currentTarget.select()} />
        <button className="browser-go" type="submit">{t('Go')}</button>
      </form>
    </div>
    <div className="canvas-browser-surface nodrag nowheel">
      {desktop ? createElement('webview', {
        key: reloadKey, ref: browserRef, partition: 'persist:mainsagents-canvas-browser',
        className: 'browser-frame nodrag nowheel', title: t('Canvas browser'),
      }) : <iframe key={reloadKey} className="browser-frame nodrag nowheel" title={t('Canvas browser')} src={url} sandbox="allow-forms allow-scripts allow-popups" referrerPolicy="no-referrer" />}
      {failed && <div className="canvas-browser-error" role="alert"><strong>{t('Could not load this website.')}</strong><span>{t('Check the address and your connection, then try again.')}</span><button type="button" onClick={reload}>{t('Try again')}</button></div>}
    </div>
    <div className="browser-foot"><span role="status">{desktop ? t(loading ? 'Loading website…' : failed ? 'Website unavailable' : 'Desktop browser') : t('For sites that block previews, use the desktop app or open a new window.')}</span><a href={url} target="_blank" rel="noreferrer" className="nodrag" onClick={event => event.stopPropagation()}>{t('Open website in a new window')}</a></div>
  </>;
}
