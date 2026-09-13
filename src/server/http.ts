/**
 * REST API + static file serving (or the Vite dev middleware in --dev).
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { ViteDevServer } from 'vite';
import type { SourceStatus } from '../shared/model/types.ts';
import type { AnalysisService } from './analysis-service.ts';
import type { SessionManager } from './session-manager.ts';
import type { SessionStore } from './storage.ts';

export interface HttpDeps {
  store: SessionStore;
  analysis: AnalysisService;
  manager: SessionManager;
  status: () => SourceStatus;
  version: string;
  staticDir: string;
  vite?: ViteDevServer;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** Trim float noise from JSON payloads (traces are large). */
export function roundNumbers(_key: string, value: unknown): unknown {
  return typeof value === 'number' && !Number.isInteger(value) ? Math.round(value * 10000) / 10000 : value;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body, roundNumbers));
}

export function createRequestHandler(deps: HttpDeps): (req: IncomingMessage, res: ServerResponse) => void {
  const staticRoot = resolve(deps.staticDir);
  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      try {
        handleApi(deps, req, res, url);
      } catch (error) {
        console.error(error);
        sendJson(res, 500, { error: 'Something went wrong on the server.' });
      }
      return;
    }
    if (deps.vite) {
      deps.vite.middlewares(req, res);
      return;
    }
    serveStatic(staticRoot, url.pathname, res);
  };
}

function handleApi(deps: HttpDeps, req: IncomingMessage, res: ServerResponse, url: URL): void {
  const method = req.method ?? 'GET';
  const path = url.pathname;
  let match: RegExpMatchArray | null;

  if (path === '/api/status') {
    return sendJson(res, 200, { version: deps.version, status: deps.status() });
  }

  if (path === '/api/sessions') {
    return sendJson(res, 200, deps.store.list());
  }

  if ((match = path.match(/^\/api\/sessions\/([\w-]+)$/))) {
    const id = match[1];
    if (method === 'DELETE') {
      if (deps.manager.session?.id === id) return sendJson(res, 409, { error: 'That session is still live.' });
      deps.store.delete(id);
      deps.analysis.forget(id);
      return sendJson(res, 200, { ok: true });
    }
    const session = deps.analysis.session(id);
    return session ? sendJson(res, 200, session) : sendJson(res, 404, { error: 'Session not found.' });
  }

  if ((match = path.match(/^\/api\/sessions\/([\w-]+)\/laps\/(\d+)$/))) {
    const lap = deps.analysis.lap(match[1], Number(match[2]));
    return lap ? sendJson(res, 200, lap) : sendJson(res, 404, { error: 'Lap not found.' });
  }

  if ((match = path.match(/^\/api\/sessions\/([\w-]+)\/insights$/))) {
    const result = deps.analysis.insights(match[1]);
    return result ? sendJson(res, 200, result) : sendJson(res, 404, { error: 'Session not found.' });
  }

  if (path === '/api/compare') {
    const q = url.searchParams;
    const session = q.get('session') ?? '';
    const refSession = q.get('refSession') ?? session;
    const result = deps.analysis.compare(session, Number(q.get('lap')), refSession, Number(q.get('refLap')));
    return result ? sendJson(res, 200, result) : sendJson(res, 404, { error: 'Lap not found.' });
  }

  if (path === '/api/live/reference') {
    const ref = deps.manager.reference;
    return sendJson(
      res,
      200,
      ref
        ? {
            source: ref.source,
            sessionId: ref.sessionId,
            lap: ref.lap,
            lapTime: ref.lapTime,
            resampled: ref.resampled,
            corners: deps.manager.corners,
          }
        : null,
    );
  }

  sendJson(res, 404, { error: 'Not found.' });
}

function serveStatic(root: string, pathname: string, res: ServerResponse): void {
  let relative = '/';
  try {
    relative = decodeURIComponent(pathname);
  } catch {
    // fall through to index.html
  }
  let file = normalize(join(root, relative));
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) file = join(root, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('The dashboard has not been built yet. Run: npm run build');
    return;
  }
  const immutable = file.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}
