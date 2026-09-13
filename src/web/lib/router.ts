/**
 * Hash routes, so links and bookmarks work without any server routing:
 *
 *   #/live
 *   #/sessions
 *   #/sessions/<id>
 *   #/compare/<session>/<lap>/<refSession>/<refLap>
 *   #/coach/<session>
 *   #/settings
 */
import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'live' }
  | { name: 'sessions' }
  | { name: 'session'; id: string }
  | { name: 'compare'; session: string | null; lap: number | null; refSession: string | null; refLap: number | null }
  | { name: 'coach'; id: string | null }
  | { name: 'settings' };

const num = (value: string | undefined) => (value && /^\d+$/.test(value) ? Number(value) : null);

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  switch (parts[0]) {
    case 'sessions':
      return parts[1] ? { name: 'session', id: parts[1] } : { name: 'sessions' };
    case 'compare':
      return {
        name: 'compare',
        session: parts[1] || null,
        lap: num(parts[2]),
        refSession: parts[3] || null,
        refLap: num(parts[4]),
      };
    case 'coach':
      return { name: 'coach', id: parts[1] || null };
    case 'settings':
      return { name: 'settings' };
    default:
      return { name: 'live' };
  }
}

export function href(route: Route): string {
  const e = encodeURIComponent;
  switch (route.name) {
    case 'live':
      return '#/live';
    case 'sessions':
      return '#/sessions';
    case 'session':
      return `#/sessions/${e(route.id)}`;
    case 'compare': {
      const parts = [route.session, route.lap, route.refSession, route.refLap];
      const filled = parts.slice(0, parts.findLastIndex((p) => p !== null) + 1);
      return `#/compare${filled.map((p) => `/${e(String(p ?? ''))}`).join('')}`;
    }
    case 'coach':
      return route.id ? `#/coach/${e(route.id)}` : '#/coach';
    case 'settings':
      return '#/settings';
  }
}

export function navigate(route: Route): void {
  location.hash = href(route);
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

let cachedHash = '';
let cachedRoute: Route = { name: 'live' };

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => {
    if (location.hash !== cachedHash) {
      cachedHash = location.hash;
      cachedRoute = parseHash(location.hash);
    }
    return cachedRoute;
  });
}
