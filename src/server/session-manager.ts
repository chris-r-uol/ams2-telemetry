/**
 * Owns the live session: starts/stops sessions, builds and stores laps, keeps
 * the reference lap for the live delta, and produces post-lap coaching.
 */
import { tipsForCorner, type CoachTip } from '../shared/analysis/coach.ts';
import { detectCorners, type Corner } from '../shared/analysis/corners.ts';
import { liveDelta } from '../shared/analysis/delta.ts';
import { cornerMetrics, type CornerMetrics } from '../shared/analysis/metrics.ts';
import { DEFAULT_STEP_METRES, resampleByDistance } from '../shared/analysis/resample.ts';
import { coachableLaps, mean, type AnalysedLap } from '../shared/analysis/session.ts';
import type {
  FuelState,
  LapFeedback,
  LapSummary,
  LapTrace,
  LiveFrame,
  SessionMeta,
  SourceKind,
} from '../shared/model/types.ts';
import type { AnalysisService, Reference } from './analysis-service.ts';
import type { SessionStore } from './storage.ts';
import type { SessionContext, TelemetryHub, Tick } from './telemetry/hub.ts';
import { LapBuilder, type CompletedLap } from './telemetry/lap-builder.ts';

const RECORDING_STATES = new Set<string>(['playing', 'menuTimeTicking']);

type SessionListener = (session: SessionMeta) => void;
type LapListener = (summary: LapSummary, feedback: LapFeedback, trace: LapTrace) => void;

export function makeSessionId(now: number, location: string, variation: string): string {
  const stamp = new Date(now).toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const slug = `${location} ${variation}`
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `${stamp}_${slug || 'track'}_${Math.random().toString(36).slice(2, 6)}`;
}

export class SessionManager {
  session: SessionMeta | null = null;
  reference: Reference | null = null;
  corners: Corner[] = [];
  lastFeedback: LapFeedback | null = null;

  private readonly hub: TelemetryHub;
  private readonly store: SessionStore;
  private readonly analysis: AnalysisService;
  private readonly source: SourceKind;
  private readonly builder = new LapBuilder();
  private laps: AnalysedLap[] = [];
  private readonly metricsCache = new Map<AnalysedLap, CornerMetrics[]>();
  private lastTick: Tick | null = null;
  private lookedForAllTimeBest = false;
  private readonly sessionListeners = new Set<SessionListener>();
  private readonly lapListeners = new Set<LapListener>();
  private readonly tickListeners = new Set<(tick: Tick) => void>();

  constructor(hub: TelemetryHub, store: SessionStore, analysis: AnalysisService, source: SourceKind) {
    this.hub = hub;
    this.store = store;
    this.analysis = analysis;
    this.source = source;
    analysis.setLiveSessionProvider(() => this.session);
    hub.onTick((tick) => this.handleTick(tick));
    hub.onOfficialLapTime((time) => this.builder.officialLapTime(time));
  }

  onSession(listener: SessionListener): () => void {
    this.sessionListeners.add(listener);
    return () => this.sessionListeners.delete(listener);
  }

  onLap(listener: LapListener): () => void {
    this.lapListeners.add(listener);
    return () => this.lapListeners.delete(listener);
  }

  /** Called after each on-track tick has been added to the current lap. */
  onTickProcessed(listener: (tick: Tick) => void): () => void {
    this.tickListeners.add(listener);
    return () => this.tickListeners.delete(listener);
  }

  get lapDistance(): number {
    return this.builder.distance;
  }

  get timedLap(): boolean {
    return this.builder.isTimedLap;
  }

  get currentTrace(): LapTrace | null {
    return this.builder.currentTrace;
  }

  get analysedLaps(): readonly AnalysedLap[] {
    return this.laps;
  }

  frame(receiving: boolean): Omit<LiveFrame, 'coach'> {
    const tick = this.lastTick;
    const ctx = this.hub.context;
    const ref = this.reference;
    const timed = tick !== null && this.builder.isTimedLap && tick.pitMode === 'none';
    const delta = ref && tick && timed ? liveDelta(ref.resampled, this.builder.distance, tick.lapTime) : null;
    const lastLap = this.session?.laps.at(-1) ?? null;

    return {
      at: Date.now(),
      source: this.source,
      receiving,
      gameState: ctx.gameState,
      sessionState: ctx.sessionState,
      sessionId: this.session?.id ?? null,
      track: ctx.track,
      car: ctx.car,
      lap: tick?.lap ?? 0,
      lapTime: tick?.lapTime ?? 0,
      lapDistance: this.builder.distance,
      sector: this.builder.sectorNumber,
      lapInvalid: this.builder.currentInvalid || (tick?.lapInvalidated ?? false),
      pitMode: tick?.pitMode ?? 'none',
      position: tick?.position ?? 0,
      numParticipants: ctx.numParticipants,
      flag: tick?.flag ?? 'none',
      delta,
      predictedLapTime: delta !== null && ref ? ref.lapTime + delta : null,
      referenceLap: ref?.lap ?? null,
      referenceLapTime: ref?.lapTime ?? null,
      referenceSource: ref?.source ?? null,
      lastLapTime: lastLap?.lapTime ?? null,
      bestLapTime: this.sessionBest()?.summary.lapTime ?? null,
      speed: tick?.speed ?? 0,
      rpm: tick?.rpm ?? 0,
      maxRpm: tick?.maxRpm ?? 0,
      gear: tick?.gear ?? 0,
      throttle: tick?.throttle ?? 0,
      brake: tick?.brake ?? 0,
      clutch: tick?.clutch ?? 0,
      steering: tick?.steering ?? 0,
      x: tick?.x ?? 0,
      z: tick?.z ?? 0,
      fuel: this.fuelState(tick),
      tyres: {
        tempC: tick?.tyreTempC ?? [0, 0, 0, 0],
        pressureKPa: tick?.tyrePressureKPa ?? [0, 0, 0, 0],
        wear: tick?.tyreWear ?? [0, 0, 0, 0],
        brakeTempC: tick?.brakeTempC ?? [0, 0, 0, 0],
        compound: tick?.compound ?? '',
      },
      weather: { ambientC: ctx.ambientC, trackC: ctx.trackC, rain: ctx.rain },
    };
  }

  private handleTick(tick: Tick): void {
    const ctx = this.hub.context;
    if (!ctx.track || !RECORDING_STATES.has(ctx.gameState)) {
      this.lastTick = tick;
      return;
    }
    if (this.isNewSession(ctx, tick)) this.startSession(ctx);
    else if (this.lastTick && tick.viewedIndex !== this.lastTick.viewedIndex) this.builder.reset();

    this.fillSessionDetails(this.session!, ctx);
    this.builder.trackLength = ctx.track.length;
    const completed = this.builder.push(tick);
    this.lastTick = tick;
    if (completed) this.completeLap(completed);
    for (const listener of this.tickListeners) listener(tick);
  }

  private isNewSession(ctx: SessionContext, tick: Tick): boolean {
    const s = this.session;
    if (!s || !ctx.track) return true;
    if (s.track.location !== ctx.track.location || s.track.variation !== ctx.track.variation) return true;
    if (ctx.sessionState !== 'invalid' && s.sessionType !== 'invalid' && ctx.sessionState !== s.sessionType) return true;
    if (ctx.car && s.car && ctx.car !== s.car) return true;
    const last = this.lastTick;
    return last !== null && tick.lap < last.lap && tick.lap <= 1;
  }

  private startSession(ctx: SessionContext): void {
    const now = Date.now();
    const track = ctx.track!;
    this.builder.reset();
    this.laps = [];
    this.metricsCache.clear();
    this.reference = null;
    this.corners = [];
    this.lastFeedback = null;
    this.lookedForAllTimeBest = false;
    this.session = {
      id: makeSessionId(now, track.location, track.variation),
      startedAt: now,
      updatedAt: now,
      source: this.source,
      track: { ...track },
      car: ctx.car,
      carClass: ctx.carClass,
      driver: ctx.driver,
      sessionType: ctx.sessionState,
      laps: [],
    };
    this.emitSession();
  }

  private fillSessionDetails(session: SessionMeta, ctx: SessionContext): void {
    let changed = false;
    if (!session.car && ctx.car) [session.car, changed] = [ctx.car, true];
    if (!session.carClass && ctx.carClass) [session.carClass, changed] = [ctx.carClass, true];
    if (!session.driver && ctx.driver) [session.driver, changed] = [ctx.driver, true];
    if (session.sessionType === 'invalid' && ctx.sessionState !== 'invalid') {
      [session.sessionType, changed] = [ctx.sessionState, true];
    }
    if (changed) this.emitSession();

    if (!this.lookedForAllTimeBest && session.car && !this.reference) {
      this.lookedForAllTimeBest = true;
      const best = this.analysis.bestReference(session.track, session.car, session.id);
      if (best) {
        this.reference = best;
        this.setCorners(detectCorners(best.resampled));
      }
    }
  }

  private completeLap({ summary, trace }: CompletedLap): void {
    const session = this.session!;
    session.laps.push(summary);
    session.updatedAt = Date.now();
    this.store.saveLap({ sessionId: session.id, summary, trace });
    this.store.saveSession(session);

    const complete = summary.kind !== 'partial' && summary.lapTime !== null;
    const lap: AnalysedLap = {
      summary,
      resampled: resampleByDistance(trace, DEFAULT_STEP_METRES, complete ? session.track.length : undefined),
    };
    this.laps.push(lap);
    this.analysis.remember(session.id, lap);

    const coachable = coachableLaps([lap]).length === 1;
    const previousReference = this.reference;
    const previousSessionBest = previousReference?.source === 'session' ? previousReference : null;
    const personalBest =
      coachable && (previousSessionBest === null || summary.lapTime! < previousSessionBest.lapTime);
    if (personalBest) {
      this.reference = {
        source: 'session',
        sessionId: session.id,
        lap: summary.lap,
        lapTime: summary.lapTime!,
        resampled: lap.resampled,
      };
      this.setCorners(detectCorners(lap.resampled));
    }

    const compareTo = personalBest ? previousReference : this.reference;
    const feedback: LapFeedback = {
      sessionId: session.id,
      lap: summary.lap,
      lapTime: summary.lapTime,
      valid: summary.valid,
      personalBest,
      referenceLap: compareTo?.lap ?? null,
      referenceLapTime: compareTo?.lapTime ?? null,
      referenceSource: compareTo?.source ?? null,
      deltaToReference: compareTo && summary.lapTime !== null ? summary.lapTime - compareTo.lapTime : null,
      tips: coachable ? this.tipsFor(lap, compareTo) : [],
    };
    this.lastFeedback = feedback;
    this.emitSession();
    for (const listener of this.lapListeners) listener(summary, feedback, trace);
  }

  /**
   * Tips against your best run through each corner this session, so every
   * suggestion is something you've already shown you can do.
   */
  private tipsFor(lap: AnalysedLap, fallback: Reference | null): CoachTip[] {
    if (this.corners.length === 0) return [];
    const pool = coachableLaps(this.laps).filter((other) => other !== lap);
    const lapMetrics = this.metricsFor(lap);
    const tips: CoachTip[] = [];

    this.corners.forEach((corner, ci) => {
      let best: { metrics: CornerMetrics; lap: number | null } | null = null;
      for (const other of pool) {
        const metrics = this.metricsFor(other)[ci];
        if (!best || metrics.segmentTime < best.metrics.segmentTime) best = { metrics, lap: other.summary.lap };
      }
      if (!best && fallback) best = { metrics: cornerMetrics(fallback.resampled, corner), lap: null };
      if (!best) return;
      const timeLost = lapMetrics[ci].segmentTime - best.metrics.segmentTime;
      const [tip] = tipsForCorner(corner, lapMetrics[ci], best.metrics, timeLost, best.lap);
      if (tip) tips.push(tip);
    });

    return tips.sort((a, b) => b.timeLost - a.timeLost).slice(0, 3);
  }

  private metricsFor(lap: AnalysedLap): CornerMetrics[] {
    let metrics = this.metricsCache.get(lap);
    if (!metrics) {
      metrics = this.corners.map((corner) => cornerMetrics(lap.resampled, corner));
      this.metricsCache.set(lap, metrics);
    }
    return metrics;
  }

  private setCorners(corners: Corner[]): void {
    this.corners = corners;
    this.metricsCache.clear();
  }

  private sessionBest(): AnalysedLap | null {
    let best: AnalysedLap | null = null;
    for (const lap of coachableLaps(this.laps)) {
      if (!best || lap.summary.lapTime! < best.summary.lapTime!) best = lap;
    }
    return best;
  }

  private fuelState(tick: Tick | null): FuelState {
    const used = (this.session?.laps ?? [])
      .filter((l) => l.kind === 'flying' && l.fuelUsed !== null && l.fuelUsed > 0)
      .slice(-3)
      .map((l) => l.fuelUsed!);
    const perLap = used.length ? mean(used) : null;
    return {
      litres: tick?.fuelLitres ?? 0,
      capacity: tick?.fuelCapacity ?? 0,
      perLap,
      lapsRemaining: perLap && tick ? tick.fuelLitres / perLap : null,
    };
  }

  private emitSession(): void {
    if (!this.session) return;
    for (const listener of this.sessionListeners) listener(this.session);
  }
}
