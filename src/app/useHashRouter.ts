import { useCallback, useEffect, useState } from 'react';
import type { PageId } from './types';
import { pageFromLocation, routes } from './routes';
import { useLanguage } from './LanguageProvider';

export function useHashRouter() {
  const {t}=useLanguage();
  const [page, setPage] = useState<PageId>(pageFromLocation);

  const navigate = useCallback((nextPage: PageId) => {
    if (pageFromLocation() !== nextPage) {
      try { window.history.pushState(null, '', `#${nextPage}`); }
      catch (error) { if (!(error instanceof DOMException) || error.name !== 'SecurityError') throw error; }
    }
    setPage(nextPage);
  }, []);

  useEffect(() => {
    if (!window.location.hash || pageFromLocation() !== window.location.hash.slice(1)) {
      try { window.history.replaceState(null, '', '#home'); }
      catch (error) { if (!(error instanceof DOMException) || error.name !== 'SecurityError') throw error; }
    }

    const syncRoute = () => setPage(pageFromLocation());
    window.addEventListener('hashchange', syncRoute);
    window.addEventListener('popstate', syncRoute);
    return () => {
      window.removeEventListener('hashchange', syncRoute);
      window.removeEventListener('popstate', syncRoute);
    };
  }, []);

  useEffect(() => {
    document.title = `${t(routes[page].title)} · MainsAgents`;
  }, [page,t]);

  return { page, navigate };
}
