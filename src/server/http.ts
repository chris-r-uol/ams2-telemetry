/**
 * REST API + static file serving (or the Vite dev middleware in --dev).
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { createGzip } from 'node:zlib';
import type { ViteDevServer } from 'vite';
import type { SourceStatus } from '../shared/model/types.ts';
import type { AnalysisService } from './analysis-service.ts';
import type { RecordingManager } from './recordings.ts';
import type { SessionManager } from './session-manager.ts';
import type { SessionStore } from './storage.ts';

export interface HttpDeps {
  store: SessionStore;
  analysis: AnalysisService;
  manager: SessionManager;
  recordings: RecordingManager;
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

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Trim float noise from JSON payloads (traces are large). */
export function roundNumbers(_key: string, value: unknown): unknown {
  return typeof value === 'number' && !Number.isInteger(value) ? Math.round(value * 10000) / 10000 : value;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body, roundNumbers));
}

function sendDownload(res: ServerResponse, file: string, downloadName: string): void {
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-length': statSync(file).size,
    'content-disposition': `attachment; filename="${downloadName}"`,
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(res);
}

export function createRequestHandler(deps: HttpDeps): (req: IncomingMessage, res: ServerResponse) => void {
  const staticRoot = resolve(deps.staticDir);
  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      handleApi(deps, req, res, url).catch((error: unknown) => {
        if (res.headersSent) {
          res.destroy();
          return;
        }
        if (error instanceof HttpError) {
          sendJson(res, error.status, { error: error.message });
          return;
        }
        console.error(error);
        sendJson(res, 500, { error: 'Something went wrong on the server.' });
      });
      return;
    }
    if (deps.vite) {
      deps.vite.middlewares(req, res);
      return;
    }
    serveStatic(staticRoot, url.pathname, res);
  };
}

/**
 * Changes must be JSON from the dashboard's own origin. Browsers preflight
 * JSON requests and this server never grants CORS, so other websites open in
 * the same browser can't start recordings or delete data.
 */
function assertCanChange(req: IncomingMessage): void {
  if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new HttpError(415, 'Changes must be sent as JSON.');
  }
  const origin = req.headers.origin;
  if (origin) {
    let host = '';
    try {
      host = new URL(origin).host;
    } catch {
      // unparseable origin: rejected below
    }
    if (host !== req.headers.host) throw new HttpError(403, 'Changes from other websites are not allowed.');
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = '';
  for await (const chunk of req) {
    body += String(chunk);
    if (body.length > 64_000) throw new HttpError(413, 'Request too large.');
  }
  if (!body) return {};
  try {
    const value: unknown = JSON.parse(body);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    throw new HttpError(400, 'Invalid JSON.');
  }
}

async function handleApi(deps: HttpDeps, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? 'GET';
  const path = url.pathname;
  if (method !== 'GET' && method !== 'HEAD') assertCanChange(req);
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
      if (deps.manager.session?.id === id) throw new HttpError(409, 'That session is still live.');
      deps.store.delete(id);
      deps.analysis.forget(id);
      return sendJson(res, 200, { ok: true });
    }
    const session = deps.analysis.session(id);
    return session ? sendJson(res, 200, session) : sendJson(res, 404, { error: 'Session not found.' });
  }

  if ((match = path.match(/^\/api\/sessions\/([\w-]+)\/export$/))) {
    return exportSession(deps, res, match[1]);
  }

  if ((match = path.match(/^\/api\/sessions\/([\w-]+)\/laps\/(\d+)$/))) {
    const lap = deps.analysis.lap(match[1], Number(match[2]));
    return lap ? sendJson(res, 200, lap) : sendJson(res, 404, { error: 'Lap not found.' });
  }

  if ((match = path.match(/^\/api\/sessions\/([\w-]+)\/insights$/))) {
    const result = deps.analysis.insights(match[1]);
    return result ? sendJson(res, 200, result) : sendJson(res, 404, { error: 'Session not found.' });
  }

  if ((match = path.match(/^\/api\/sessions\/([\w-]+)\/chassis$/))) {
    const result = deps.analysis.chassis(match[1]);
    return result ? sendJson(res, 200, result) : sendJson(res, 404, { error: 'Session not found.' });
  }

  if ((match = path.match(/^\/api\/sessions\/([\w-]+)\/chassis\/laps\/(\d+)$/))) {
    const series = deps.analysis.chassisLap(match[1], Number(match[2]));
    return series ? sendJson(res, 200, series) : sendJson(res, 404, { error: 'Lap not found.' });
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

  if (path === '/api/recordings' && method === 'GET') {
    const { recordings } = deps;
    return sendJson(res, 200, { active: recordings.status, autoRecord: recordings.autoRecord, recordings: recordings.list() });
  }

  if (path === '/api/recordings/start' && method === 'POST') {
    return sendJson(res, 200, deps.recordings.start());
  }

  if (path === '/api/recordings/stop' && method === 'POST') {
    return sendJson(res, 200, await deps.recordings.stop());
  }

  if (path === '/api/recordings/settings' && method === 'PUT') {
    const body = await readJson(req);
    await deps.recordings.setAutoRecord(body.autoRecord === true);
    return sendJson(res, 200, { autoRecord: deps.recordings.autoRecord });
  }

  if ((match = path.match(/^\/api\/recordings\/([A-Za-z0-9_.-]+\.ams2rec)$/))) {
    const name = match[1];
    const isActive = deps.recordings.status?.name === name;
    if (method === 'DELETE') {
      if (isActive) throw new HttpError(409, 'Stop the recording before deleting it.');
      if (!deps.recordings.delete(name)) throw new HttpError(404, 'Recording not found.');
      return sendJson(res, 200, { ok: true });
    }
    const file = deps.recordings.path(name);
    if (!file) throw new HttpError(404, 'Recording not found.');
    if (isActive) throw new HttpError(409, 'Stop the recording before downloading it.');
    return sendDownload(res, file, name);
  }

  sendJson(res, 404, { error: 'Not found.' });
}

/** Every lap of a session as one gzipped JSON file: summaries plus full traces. */
function exportSession(deps: HttpDeps, res: ServerResponse, id: string): void {
  const session = deps.analysis.session(id);
  if (!session) throw new HttpError(404, 'Session not found.');
  res.writeHead(200, {
    'content-type': 'application/gzip',
    'content-disposition': `attachment; filename="${id}.json.gz"`,
    'cache-control': 'no-store',
  });
  const gzip = createGzip();
  gzip.pipe(res);
  gzip.write(
    `{"format":"ams2-coach-session","formatVersion":1,"appVersion":${JSON.stringify(deps.version)},"session":${JSON.stringify(session)},"laps":[`,
  );
  let first = true;
  for (const summary of session.laps) {
    const lap = deps.store.loadLap(id, summary.lap);
    if (!lap) continue;
    gzip.write(`${first ? '' : ','}${JSON.stringify(lap)}`);
    first = false;
  }
  gzip.end(']}');
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
