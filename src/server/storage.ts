/**
 * Sessions on disk, one folder per session:
 *
 *   data/sessions/<id>/session.json      summary + lap list (human readable)
 *   data/sessions/<id>/lap-007.json.gz   full telemetry trace for lap 7
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { LapSummary, LapTrace, SessionMeta, StoredLap, TrackInfo, TraceChannel } from '../shared/model/types.ts';

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const DECIMALS: Record<TraceChannel, number> = {
  t: 3,
  d: 2,
  speed: 2,
  throttle: 3,
  brake: 3,
  steering: 3,
  gear: 0,
  rpm: 0,
  x: 2,
  z: 2,
  latG: 3,
  lonG: 3,
  off: 0,
  steerIn: 3,
  yawRate: 4,
  vLat: 3,
  vLon: 2,
  vertG: 3,
  pitch: 5,
  roll: 5,
  travelFL: 5,
  travelFR: 5,
  travelRL: 5,
  travelRR: 5,
  damperFL: 4,
  damperFR: 4,
  damperRL: 4,
  damperRR: 4,
  rideFL: 4,
  rideFR: 4,
  rideRL: 4,
  rideRR: 4,
  wheelFL: 2,
  wheelFR: 2,
  wheelRL: 2,
  wheelRR: 2,
  grounded: 0,
};

const lapFile = (lap: number) => `lap-${String(lap).padStart(3, '0')}.json.gz`;

function roundTrace(trace: LapTrace): LapTrace {
  const out = {} as LapTrace;
  for (const channel of Object.keys(trace) as TraceChannel[]) {
    const factor = 10 ** (DECIMALS[channel] ?? 3);
    out[channel] = trace[channel].map((v) => Math.round(v * factor) / factor);
  }
  return out;
}

function writeAtomic(file: string, data: string | Uint8Array): void {
  const temp = `${file}.tmp`;
  writeFileSync(temp, data);
  try {
    renameSync(temp, file);
  } catch {
    // Some Windows setups (antivirus, indexers) briefly lock files; fall back to a direct write.
    writeFileSync(file, data);
    rmSync(temp, { force: true });
  }
}

export class SessionStore {
  readonly root: string;
  private readonly sessions = new Map<string, SessionMeta>();

  constructor(root: string) {
    this.root = root;
    mkdirSync(this.sessionsDir, { recursive: true });
    this.loadIndex();
  }

  private get sessionsDir(): string {
    return join(this.root, 'sessions');
  }

  private loadIndex(): void {
    for (const entry of readdirSync(this.sessionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !ID_PATTERN.test(entry.name)) continue;
      const file = join(this.sessionsDir, entry.name, 'session.json');
      if (!existsSync(file)) continue;
      try {
        const meta = JSON.parse(readFileSync(file, 'utf8')) as SessionMeta;
        this.sessions.set(meta.id, meta);
      } catch (error) {
        console.warn(`Skipping unreadable session ${entry.name}:`, (error as Error).message);
      }
    }
  }

  list(): SessionMeta[] {
    return [...this.sessions.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  get(id: string): SessionMeta | null {
    return ID_PATTERN.test(id) ? (this.sessions.get(id) ?? null) : null;
  }

  saveSession(meta: SessionMeta): void {
    const dir = join(this.sessionsDir, meta.id);
    mkdirSync(dir, { recursive: true });
    writeAtomic(join(dir, 'session.json'), JSON.stringify(meta, null, 2));
    this.sessions.set(meta.id, structuredClone(meta));
  }

  saveLap(lap: StoredLap): void {
    const dir = join(this.sessionsDir, lap.sessionId);
    mkdirSync(dir, { recursive: true });
    const payload: StoredLap = { ...lap, trace: roundTrace(lap.trace) };
    writeAtomic(join(dir, lapFile(lap.summary.lap)), gzipSync(JSON.stringify(payload)));
  }

  loadLap(sessionId: string, lap: number): StoredLap | null {
    if (!ID_PATTERN.test(sessionId)) return null;
    const file = join(this.sessionsDir, sessionId, lapFile(lap));
    if (!existsSync(file)) return null;
    return JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as StoredLap;
  }

  delete(id: string): void {
    if (!ID_PATTERN.test(id)) return;
    rmSync(join(this.sessionsDir, id), { recursive: true, force: true });
    this.sessions.delete(id);
  }

  /** Fastest valid flying lap stored for this track layout and car. */
  bestLap(track: TrackInfo, car: string, excludeSessionId?: string): { session: SessionMeta; summary: LapSummary } | null {
    let best: { session: SessionMeta; summary: LapSummary } | null = null;
    for (const session of this.sessions.values()) {
      if (session.id === excludeSessionId) continue;
      if (session.track.location !== track.location || session.track.variation !== track.variation) continue;
      if (car && session.car !== car) continue;
      for (const summary of session.laps) {
        if (!summary.valid || summary.kind !== 'flying' || summary.lapTime === null) continue;
        if (!best || summary.lapTime < best.summary.lapTime!) best = { session, summary };
      }
    }
    return best;
  }
}
