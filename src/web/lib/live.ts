/**
 * Live connection to the server over WebSocket, exposed as a tiny external
 * store. Components read it with `useLive(selector)`; charts that redraw at
 * frame rate subscribe directly with `subscribeLive` to stay out of React's
 * render loop.
 */
import { useSyncExternalStore } from 'react';
import type { LapFeedback, LiveFrame, ServerMessage, SessionMeta, SourceStatus } from '../../shared/model/types.ts';

export type ConnectionState = 'connecting' | 'open' | 'closed';

export interface LiveState {
  connection: ConnectionState;
  version: string | null;
  frame: LiveFrame | null;
  status: SourceStatus | null;
  session: SessionMeta | null;
  feedback: LapFeedback | null;
  /** Increments whenever a lap completes, so views know to refetch. */
  lapSerial: number;
}

/** The current lap as seen through live frames, for the "this lap vs reference" chart. */
export interface LiveTrail {
  lap: number;
  d: number[];
  speed: number[];
  throttle: number[];
  brake: number[];
}

let state: LiveState = {
  connection: 'connecting',
  version: null,
  frame: null,
  status: null,
  session: null,
  feedback: null,
  lapSerial: 0,
};

const trail: LiveTrail = { lap: -1, d: [], speed: [], throttle: [], brake: [] };
const listeners = new Set<() => void>();
let socket: WebSocket | null = null;
let retryDelay = 1000;

function set(patch: Partial<LiveState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function extendTrail(frame: LiveFrame): void {
  const lastD = trail.d.length ? trail.d[trail.d.length - 1] : -1;
  if (frame.lap !== trail.lap || frame.lapDistance < lastD - 50) {
    trail.lap = frame.lap;
    trail.d.length = 0;
    trail.speed.length = 0;
    trail.throttle.length = 0;
    trail.brake.length = 0;
  }
  if (frame.lapDistance > lastD) {
    trail.d.push(frame.lapDistance);
    trail.speed.push(frame.speed);
    trail.throttle.push(frame.throttle);
    trail.brake.push(frame.brake);
  }
}

function handle(message: ServerMessage): void {
  switch (message.type) {
    case 'hello':
      set({ version: message.version, status: message.status, session: message.session, feedback: message.feedback });
      break;
    case 'frame':
      extendTrail(message.frame);
      set({ frame: message.frame });
      break;
    case 'status':
      set({ status: message.status });
      break;
    case 'session':
      set({ session: message.session });
      break;
    case 'lap':
      set({ feedback: message.feedback, lapSerial: state.lapSerial + 1 });
      break;
  }
}

export function connectLive(): void {
  if (socket) return;
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const ws = new WebSocket(url);
  socket = ws;
  set({ connection: 'connecting' });
  ws.addEventListener('open', () => {
    retryDelay = 1000;
    set({ connection: 'open' });
  });
  ws.addEventListener('message', (event) => {
    try {
      handle(JSON.parse(String(event.data)) as ServerMessage);
    } catch (error) {
      console.warn('Bad live message', error);
    }
  });
  ws.addEventListener('close', () => {
    socket = null;
    set({ connection: 'closed' });
    setTimeout(connectLive, retryDelay);
    retryDelay = Math.min(retryDelay * 1.6, 8000);
  });
}

export function subscribeLive(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLive(): LiveState {
  return state;
}

export function getTrail(): LiveTrail {
  return trail;
}

/** Selectors must return existing references or primitives (not new objects). */
export function useLive<T>(selector: (s: LiveState) => T): T {
  return useSyncExternalStore(subscribeLive, () => selector(state));
}
