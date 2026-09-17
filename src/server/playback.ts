/**
 * Where live telemetry comes from, and the dashboard's control over it: speed and
 * pause for the demo and replays, and replaying a recording from the dashboard.
 *
 * A dashboard replay takes over from the startup source (the game, the demo or a
 * command-line replay) until it's stopped. Its sessions are kept in the store's
 * scratch folder, so a replay never saves a session twice, and it isn't recorded.
 */
import type { ReplayStatus, SourceKind, SourceStatus } from '../shared/model/types.ts';
import { PLAYBACK_SPEEDS } from '../shared/model/types.ts';
import type { AnalysisService } from './analysis-service.ts';
import { linkRecordings, type RecordingManager } from './recordings.ts';
import type { SessionManager } from './session-manager.ts';
import { startReplay, type ReplayControl } from './sources/replay.ts';
import type { SessionStore } from './storage.ts';
import type { TelemetryHub } from './telemetry/hub.ts';

/** The startup source, as far as the dashboard can control it. */
export interface Feed {
  detail(): string;
  setSpeed?(speed: number): void;
  setPaused?(paused: boolean): void;
  close(): void;
}

export interface PlaybackOptions {
  source: SourceKind;
  speed: number;
  hub: TelemetryHub;
  manager: SessionManager;
  store: SessionStore;
  analysis: AnalysisService;
  recordings: RecordingManager;
}

interface DashboardReplay extends ReplayStatus {
  control: ReplayControl;
  paused: boolean;
  /** What the hub knew before the replay, fed back in when it hands back so the game's track is known at once. */
  priming: Uint8Array[];
}

export class PlaybackError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class Playback {
  private readonly options: PlaybackOptions;
  private base: Feed = { detail: () => '', close: () => {} };
  private basePaused = false;
  private replay: DashboardReplay | null = null;
  /** A replay is starting: the startup source is already shut out. */
  private starting = false;
  private speed: number;
  private readonly changeListeners = new Set<() => void>();

  constructor(options: PlaybackOptions) {
    this.options = options;
    this.speed = options.speed;
  }

  setBase(feed: Feed): void {
    this.base = feed;
  }

  /** Called when a replay starts or stops, so browsers can start afresh. */
  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  get replaying(): boolean {
    return this.replay !== null;
  }

  /** Packets from the startup source: recorded and analysed, unless a replay has taken over. */
  ingest(bytes: Uint8Array, at: number = Date.now()): void {
    if (this.replay || this.starting) return;
    this.options.recordings.write(bytes, at);
    this.options.hub.ingest(bytes, at);
  }

  status(): Pick<SourceStatus, 'source' | 'detail' | 'playbackSpeed' | 'paused' | 'replay'> {
    const r = this.replay;
    if (r) {
      return {
        source: 'replay',
        detail: `Replaying ${r.recording} (${this.speed}× speed${r.finished ? ', finished' : ''})`,
        playbackSpeed: this.speed,
        paused: r.paused,
        replay: { recording: r.recording, track: r.track, sessionId: r.sessionId, finished: r.finished },
      };
    }
    return {
      source: this.options.source,
      detail: this.base.detail(),
      playbackSpeed: this.base.setSpeed ? this.speed : null,
      paused: this.basePaused,
      replay: null,
    };
  }

  get currentSpeed(): number {
    return this.speed;
  }

  /** False when the speed isn't offered; throws when nothing can change speed. */
  setSpeed(speed: number): boolean {
    const target = this.replay?.control ?? this.base;
    if (!target.setSpeed) throw new PlaybackError(409, 'Only the demo and recording replays can change speed.');
    if (!(PLAYBACK_SPEEDS as readonly number[]).includes(speed)) return false;
    this.speed = speed;
    target.setSpeed(speed);
    return true;
  }

  setPaused(paused: boolean): void {
    if (this.replay) {
      this.replay.paused = paused;
      this.replay.control.setPaused(paused);
      return;
    }
    if (!this.base.setPaused) throw new PlaybackError(409, "The game can't be paused from here.");
    this.basePaused = paused;
    this.base.setPaused(paused);
  }

  /** Replay a recording from the recordings folder, taking over until `stopReplay`. */
  async startReplay(name: string): Promise<void> {
    const { recordings, store, hub } = this.options;
    const file = recordings.path(name);
    if (!file) throw new PlaybackError(404, 'Recording not found.');
    if (recordings.status?.name === name) throw new PlaybackError(409, 'Stop the recording before replaying it.');
    if (this.starting) throw new PlaybackError(409, 'A replay is already starting.');
    const recorded = recordings.info(name);
    const saved = store.list().filter((s) => !store.isScratch(s.id));
    const info = recorded ? linkRecordings([recorded], saved)[0] : null;

    this.starting = true;
    const priming = this.replay?.priming ?? hub.primingPackets();
    if (!this.replay) this.base.setPaused?.(true);
    try {
      // A replay mustn't end up inside the recording of whatever was running.
      await recordings.stop();
    } finally {
      this.starting = false;
    }
    this.endReplay();

    store.beginScratch(info?.sessionId ? [info.sessionId] : []);
    this.switchFeed('replay');
    const replay: DashboardReplay = {
      recording: name,
      track: info?.track ?? null,
      sessionId: info?.sessionId ?? null,
      finished: false,
      paused: false,
      priming,
      control: startReplay({
        file,
        speed: this.speed,
        loop: false,
        onPacket: (bytes, at) => hub.ingest(bytes, at),
        onEnd: () => {
          replay.finished = true;
        },
        onError: (error) => {
          console.error('Replay error:', error.message);
          replay.finished = true;
        },
      }),
    };
    this.replay = replay;
    this.emitChange();
  }

  /** Stop a dashboard replay and hand back to the startup source. */
  stopReplay(): void {
    const replay = this.replay;
    if (!replay) return;
    this.endReplay();
    this.switchFeed(this.options.source);
    for (const bytes of replay.priming) this.options.hub.ingest(bytes);
    if (!this.basePaused) this.base.setPaused?.(false);
    this.base.setSpeed?.(this.speed);
    this.emitChange();
  }

  close(): void {
    this.endReplay();
    this.base.close();
  }

  private endReplay(): void {
    const replay = this.replay;
    if (!replay) return;
    this.replay = null;
    replay.control.close();
    for (const id of this.options.store.endScratch()) this.options.analysis.forget(id);
  }

  private switchFeed(source: SourceKind): void {
    this.options.hub.reset();
    this.options.manager.resetFeed(source);
  }

  private emitChange(): void {
    for (const listener of this.changeListeners) listener();
  }
}
