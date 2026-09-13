/**
 * Pushes live frames, lap events, coaching insights and source status to
 * browsers over /ws.
 */
import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { LiveFrame, ServerMessage, SourceStatus } from '../shared/model/types.ts';
import { roundNumbers } from './http.ts';
import type { LiveCoach } from './live-coach.ts';
import type { SessionManager } from './session-manager.ts';
import type { TelemetryHub } from './telemetry/hub.ts';

export interface LiveSocketDeps {
  manager: SessionManager;
  hub: TelemetryHub;
  coach: LiveCoach;
  status: () => SourceStatus;
  version: string;
  /** Live frames per second. */
  frameRate: number;
}

const RECEIVING_WINDOW_MS = 2000;

export function attachLiveSocket(server: Server, deps: LiveSocketDeps): { close(): void } {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    // Leave other upgrades (Vite's HMR socket in dev) alone.
    if (pathname !== '/ws') return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  const encode = (message: ServerMessage) => JSON.stringify(message, roundNumbers);
  const broadcast = (message: ServerMessage) => {
    if (wss.clients.size === 0) return;
    const data = encode(message);
    for (const client of wss.clients) {
      // Skip slow clients rather than queueing stale frames.
      if (client.readyState === WebSocket.OPEN && client.bufferedAmount < 512_000) client.send(data);
    }
  };

  const receiving = () =>
    deps.hub.lastPacketAt !== null && Date.now() - deps.hub.lastPacketAt < RECEIVING_WINDOW_MS;
  const frame = (): LiveFrame => ({ ...deps.manager.frame(receiving()), coach: deps.coach.frame() });

  wss.on('connection', (ws) => {
    ws.send(
      encode({
        type: 'hello',
        version: deps.version,
        status: deps.status(),
        session: deps.manager.session,
        feedback: deps.manager.lastFeedback,
        insights: deps.coach.insights(),
      }),
    );
    ws.send(encode({ type: 'frame', frame: frame() }));
  });

  let lastBroadcastPacketAt: number | null = null;
  let lastIdleFrameAt = 0;
  const frameTimer = setInterval(() => {
    const now = Date.now();
    const fresh = deps.hub.lastPacketAt !== lastBroadcastPacketAt;
    // When nothing is arriving, send a heartbeat frame once a second instead of 20.
    if (!fresh && now - lastIdleFrameAt < 1000) return;
    lastBroadcastPacketAt = deps.hub.lastPacketAt;
    lastIdleFrameAt = now;
    broadcast({ type: 'frame', frame: frame() });
  }, 1000 / deps.frameRate);

  const statusTimer = setInterval(() => broadcast({ type: 'status', status: deps.status() }), 1000);

  const offSession = deps.manager.onSession((session) => broadcast({ type: 'session', session }));
  const offLap = deps.manager.onLap((summary, feedback) =>
    broadcast({ type: 'lap', sessionId: feedback.sessionId, summary, feedback }),
  );
  const offInsights = deps.coach.onInsights((insights) => broadcast({ type: 'insights', insights }));

  return {
    close() {
      clearInterval(frameTimer);
      clearInterval(statusTimer);
      offSession();
      offLap();
      offInsights();
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}
