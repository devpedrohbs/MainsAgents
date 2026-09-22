import { useCallback, useEffect, useState } from 'react';
import type { PageId } from './types';
import { pageFromLocation, routes } from './routes';

export function useHashRouter() {
  const [page, setPage] = useState<PageId>(pageFromLocation);

  const navigate = useCallback((nextPage: PageId) => {
    if (pageFromLocation() !== nextPage) {
      window.history.pushState(null, '', `#${nextPage}`);
    }
    setPage(nextPage);
  }, []);

  useEffect(() => {
    if (!window.location.hash || pageFromLocation() !== window.location.hash.slice(1)) {
      window.history.replaceState(null, '', '#home');
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
    document.title = `${routes[page].title} · MainsAgents`;
  }, [page]);

  return { page, navigate };
}
