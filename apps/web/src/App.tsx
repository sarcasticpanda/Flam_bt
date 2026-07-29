import { useCallback, useEffect, useState } from 'react';
import { Landing } from './routes/Landing';
import { Board } from './routes/Board';

/**
 * Router.
 *
 * Two routes do not justify a routing library — this is ~30 lines against ~15KB of dependency,
 * and the History API is exactly the right tool. `/b/:code` is a real URL, so an invite link is
 * shareable, bookmarkable, and survives a reload.
 */
function parseRoute(pathname: string): { name: 'landing' } | { name: 'board'; code: string } {
  const match = /^\/b\/([A-Za-z0-9]+)\/?$/.exec(pathname);
  if (match?.[1]) return { name: 'board', code: match[1].toUpperCase() };
  return { name: 'landing' };
}

export default function App() {
  const [route, setRoute] = useState(() => parseRoute(location.pathname));

  // Back/forward must work. Without this, leaving a board and hitting back leaves the URL and
  // the view disagreeing.
  useEffect(() => {
    const onPop = () => setRoute(parseRoute(location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((path: string) => {
    history.pushState({}, '', path);
    setRoute(parseRoute(path));
  }, []);

  if (route.name === 'board') {
    return (
      <Board
        // Remount on code change so the session, document, and engine are all rebuilt cleanly
        // rather than trying to migrate a live board in place.
        key={route.code}
        code={route.code}
        onLeave={() => navigate('/')}
      />
    );
  }

  return <Landing onOpen={(code) => navigate(`/b/${code}`)} />;
}
