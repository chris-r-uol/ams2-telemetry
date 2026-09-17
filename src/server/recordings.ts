/**
 * Raw telemetry recordings (.ams2rec): start and stop from the dashboard,
 * optionally record every session automatically, list, download and delete.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { RecordingInfo, RecordingStatus, SessionMeta } from '../shared/model/types.ts';
import { PacketRecorder } from './sources/recorder.ts';

export const RECORDING_FILE = /^[A-Za-z0-9_.-]+\.ams2rec$/;
const IDLE_STOP_MS = 30_000;

export interface RecordingContext {
  track: string | null;
  car: string | null;
  sessionId: string | null;
}

export interface RecordingManagerOptions {
  dir: string;
  settingsFile: string;
  appVersion: string;
  /** Latest slow-changing packets (track, names, game state), written first so the file stands alone. */
  priming: () => Uint8Array[];
  context: () => RecordingContext;
}

interface Sidecar {
  startedAt: number;
  endedAt: number;
  packets: number;
  bytes: number;
  track: string | null;
  car: string | null;
  sessionId: string | null;
  appVersion: string;
}

interface ActiveRecording {
  recorder: PacketRecorder;
  name: string;
  startedAt: number;
  packets: number;
  bytes: number;
  lastPacketAt: number | null;
  auto: boolean;
  sessionId: string | null;
  track: string | null;
  car: string | null;
}

/** Letters and digits only, for comparing track names written different ways. */
const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Fill in which saved session each recording captured. Recordings name their session;
 * older ones without that are matched by track and by the session starting while
 * the recording ran (or within two minutes of it starting, when its length isn't known).
 */
export function linkRecordings(recordings: RecordingInfo[], sessions: SessionMeta[]): RecordingInfo[] {
  const known = new Set(sessions.map((s) => s.id));
  return recordings.map((recording) => {
    if (recording.sessionId && known.has(recording.sessionId)) return recording;
    const margin = 120_000;
    const end = recording.startedAt + (recording.durationMs ?? margin);
    const match = sessions.find(
      (s) =>
        s.startedAt >= recording.startedAt - margin &&
        s.startedAt <= end &&
        (!recording.track || plain(recording.track) === plain(`${s.track.location}${s.track.variation}`)),
    );
    return { ...recording, sessionId: match?.id ?? null };
  });
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'ams2';

export class RecordingManager {
  readonly dir: string;
  private readonly options: RecordingManagerOptions;
  private auto = false;
  private active: ActiveRecording | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: RecordingManagerOptions) {
    this.options = options;
    this.dir = options.dir;
    mkdirSync(this.dir, { recursive: true });
    this.auto = this.readSettings().autoRecord === true;
  }

  get autoRecord(): boolean {
    return this.auto;
  }

  get status(): RecordingStatus | null {
    const a = this.active;
    return a ? { name: a.name, startedAt: a.startedAt, packets: a.packets, bytes: a.bytes, auto: a.auto } : null;
  }

  /** Start recording now. Does nothing if a recording is already running. */
  start(auto = false): RecordingStatus {
    if (!this.active) {
      const now = Date.now();
      const ctx = this.options.context();
      const stamp = new Date(now).toISOString().slice(0, 19).replace(/[:T]/g, '-');
      let name = `${stamp}_${slug(ctx.track ?? 'ams2')}.ams2rec`;
      for (let n = 2; existsSync(join(this.dir, name)); n++) name = `${stamp}_${slug(ctx.track ?? 'ams2')}-${n}.ams2rec`;
      this.active = {
        recorder: new PacketRecorder(join(this.dir, name)),
        name,
        startedAt: now,
        packets: 0,
        bytes: 0,
        lastPacketAt: null,
        auto,
        sessionId: ctx.sessionId,
        track: ctx.track,
        car: ctx.car,
      };
      for (const bytes of this.options.priming()) this.write(bytes, now);
    }
    return this.status!;
  }

  write(bytes: Uint8Array, at: number): void {
    const a = this.active;
    if (!a) return;
    a.recorder.write(bytes, at);
    a.packets++;
    a.bytes += bytes.byteLength;
    a.lastPacketAt = at;
  }

  stop(): Promise<RecordingInfo | null> {
    return this.serial(() => this.stopNow());
  }

  /** With auto-record on, each new session gets its own file. Manual recordings keep running. */
  sessionChanged(sessionId: string): Promise<void> {
    return this.serial(async () => {
      const a = this.active;
      if (a && !a.auto) {
        a.sessionId ??= sessionId;
        return;
      }
      if (!this.auto || a?.sessionId === sessionId) return;
      await this.stopNow();
      this.start(true);
      this.active!.sessionId = sessionId;
    });
  }

  setAutoRecord(on: boolean): Promise<void> {
    return this.serial(async () => {
      this.auto = on;
      mkdirSync(dirname(this.options.settingsFile), { recursive: true });
      writeFileSync(this.options.settingsFile, JSON.stringify({ ...this.readSettings(), autoRecord: on }, null, 2));
      const sessionId = this.options.context().sessionId;
      if (on && !this.active && sessionId) {
        this.start(true);
        this.active!.sessionId = sessionId;
      }
      if (!on && this.active?.auto) await this.stopNow();
    });
  }

  /** Call every few seconds: keeps track/car names fresh and ends idle automatic recordings. */
  idleCheck(now = Date.now()): void {
    const a = this.active;
    if (!a) return;
    const ctx = this.options.context();
    if (ctx.sessionId && (a.sessionId === null || a.sessionId === ctx.sessionId)) {
      a.sessionId = ctx.sessionId;
      a.track = ctx.track ?? a.track;
      a.car = ctx.car ?? a.car;
    }
    if (a.auto && a.lastPacketAt !== null && now - a.lastPacketAt > IDLE_STOP_MS) void this.stop();
  }

  list(): RecordingInfo[] {
    return readdirSync(this.dir)
      .filter((name) => RECORDING_FILE.test(name))
      .map((name) => this.info(name))
      .filter((info): info is RecordingInfo => info !== null)
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  info(name: string): RecordingInfo | null {
    const file = this.path(name);
    if (!file) return null;
    const stat = statSync(file);
    let sidecar: Partial<Sidecar> = {};
    try {
      sidecar = JSON.parse(readFileSync(`${file}.json`, 'utf8')) as Partial<Sidecar>;
    } catch {
      // older or interrupted recording: fall back to file dates
    }
    const a = this.active?.name === name ? this.active : null;
    // Names start with the UTC time recording began, which survives copying the file to another computer.
    const stamp = name.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})_/);
    const named = stamp ? Date.UTC(+stamp[1], +stamp[2] - 1, +stamp[3], +stamp[4], +stamp[5], +stamp[6]) : null;
    return {
      name,
      sizeBytes: stat.size,
      startedAt: a?.startedAt ?? sidecar.startedAt ?? named ?? (stat.birthtimeMs || stat.mtimeMs),
      durationMs: a
        ? Date.now() - a.startedAt
        : sidecar.startedAt && sidecar.endedAt
          ? sidecar.endedAt - sidecar.startedAt
          : null,
      packets: a?.packets ?? sidecar.packets ?? null,
      track: a?.track ?? sidecar.track ?? null,
      car: a?.car ?? sidecar.car ?? null,
      active: a !== null,
      sessionId: a?.sessionId ?? sidecar.sessionId ?? null,
    };
  }

  /** Absolute path for a recording name, or null if it isn't a valid existing recording. */
  path(name: string): string | null {
    if (!RECORDING_FILE.test(name)) return null;
    const file = join(this.dir, name);
    return existsSync(file) ? file : null;
  }

  delete(name: string): boolean {
    if (this.active?.name === name) return false;
    const file = this.path(name);
    if (!file) return false;
    rmSync(file, { force: true });
    rmSync(`${file}.json`, { force: true });
    return true;
  }

  private async stopNow(): Promise<RecordingInfo | null> {
    const a = this.active;
    if (!a) return null;
    this.active = null;
    await a.recorder.close();
    const sidecar: Sidecar = {
      startedAt: a.startedAt,
      endedAt: a.lastPacketAt ?? Date.now(),
      packets: a.packets,
      bytes: a.bytes,
      track: a.track,
      car: a.car,
      sessionId: a.sessionId,
      appVersion: this.options.appVersion,
    };
    writeFileSync(join(this.dir, `${a.name}.json`), JSON.stringify(sidecar, null, 2));
    return this.info(a.name);
  }

  private readSettings(): Record<string, unknown> {
    try {
      return JSON.parse(readFileSync(this.options.settingsFile, 'utf8')) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private serial<T>(task: () => Promise<T> | T): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
