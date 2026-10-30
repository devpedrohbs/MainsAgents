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
    // Unknown or retired hashes (e.g. an old #flow link) are rewritten to the page that actually opens.
    const normalize = () => {
      if (window.location.hash && pageFromLocation() === window.location.hash.slice(1)) return;
      try { window.history.replaceState(null, '', `#${pageFromLocation()}`); }
      catch (error) { if (!(error instanceof DOMException) || error.name !== 'SecurityError') throw error; }
    };
    normalize();

    const syncRoute = () => { normalize(); setPage(pageFromLocation()); };
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
