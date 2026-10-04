/**
 * Loads stored laps, resamples them onto a distance grid and runs the coaching
 * analysis, with small caches so the UI can click around freely.
 *
 * Every analysis covers a whole session or one stint of it. A stint is measured
 * on the session's yardsticks (its corners, the steering the car usually needs,
 * the grip it has shown), so stints can be set against each other.
 */
import {
  analyseChassis,
  chassisLapSeries,
  incidentMask,
  incidentRanges,
  sessionIncidents,
  type ChassisAnalysis,
  type ChassisLapSeries,
} from '../shared/analysis/chassis.ts';
import { compareLaps, type LapComparison } from '../shared/analysis/coach.ts';
import { detectCorners, type Corner } from '../shared/analysis/corners.ts';
import { analyseGearing, type GearingAnalysis } from '../shared/analysis/gearing.ts';
import { analyseTrackUse, type TrackUseAnalysis } from '../shared/analysis/track-use.ts';
import {
  CORNER_STEP,
  cornerGripRun,
  cornerStart,
  gripEnvelope,
  summariseCornerGrip,
  type CornerGripSummary,
  type GripEnvelope,
  type GripRun,
} from '../shared/analysis/grip.ts';
import { DEFAULT_STEP_METRES, resampleByDistance, type ResampledLap } from '../shared/analysis/resample.ts';
import { analyseSession, coachableLaps, type AnalysedLap, type SessionInsights } from '../shared/analysis/session.ts';
import { detectStints, stintCorners, summariseStints, type StintCorner, type StintSummary } from '../shared/analysis/stints.ts';
import type { LapSummary, SessionMeta, StoredLap, TrackInfo } from '../shared/model/types.ts';
import type { SessionStore } from './storage.ts';

export interface Reference {
  source: 'session' | 'all-time';
  sessionId: string;
  lap: number;
  lapTime: number;
  resampled: ResampledLap;
}

export interface InsightsResult {
  insights: SessionInsights;
  corners: Corner[];
}

export interface ChassisResult {
  analysis: ChassisAnalysis;
  corners: Corner[];
}

export interface GripResult {
  /** The most grip shown at each speed over the whole session. Null until there's enough driving to tell. */
  envelope: GripEnvelope | null;
  lapsAnalysed: number;
  corners: CornerGripSummary[];
}

/** One lap's run through each corner, with your best run through it. Points every `step` metres from `from`. */
export interface GripLapCorner {
  cornerId: number;
  corner: string;
  apex: number;
  from: number;
  step: number;
  bestLap: number | null;
  run: GripRun;
  best: GripRun | null;
}

export interface GripLapResult {
  lap: number;
  corners: GripLapCorner[];
}

export interface ComparisonResult {
  lap: AnalysedLap;
  reference: AnalysedLap;
  corners: Corner[];
  comparison: LapComparison;
}

/** A stint's pace from its lap summaries, plus what its telemetry says about each corner. */
export interface StintAnalysis extends StintSummary {
  /** The stint's best run through every corner, combined. */
  idealLapTime: number | null;
  corners: StintCorner[];
}

export interface StintsResult {
  stints: StintAnalysis[];
  /** The session's corners: the same in every stint. */
  corners: Corner[];
}

/** The laps an analysis covers: a whole session, or one stint of it. */
interface Scope {
  session: SessionMeta;
  /** The laps covered that have their own telemetry on disk. */
  laps: LapSummary[];
  /** 1-based stint, or null for the whole session. */
  stint: number | null;
  /** Cache key. */
  key: string;
}

type Cache<T> = Map<string, { updatedAt: number; lapCount: number; result: T }>;
type Incidents = Map<number, [number, number][]>;

const LAP_CACHE_LIMIT = 150;

export function analyseStoredLap(stored: StoredLap, track: TrackInfo): AnalysedLap {
  const complete = stored.summary.kind !== 'partial' && stored.summary.lapTime !== null;
  return {
    summary: stored.summary,
    resampled: resampleByDistance(stored.trace, DEFAULT_STEP_METRES, complete ? track.length : undefined),
  };
}

export class AnalysisService {
  private readonly store: SessionStore;
  private readonly laps = new Map<string, AnalysedLap>();
  private readonly insightCache: Cache<InsightsResult> = new Map();
  private readonly incidentCache: Cache<Incidents> = new Map();
  private readonly chassisCache: Cache<ChassisResult> = new Map();
  private readonly gearingCache: Cache<GearingAnalysis> = new Map();
  private readonly trackUseCache: Cache<TrackUseAnalysis> = new Map();
  private readonly gripCache: Cache<{ result: GripResult; incidents: Incidents }> = new Map();
  private readonly stintsCache: Cache<StintsResult> = new Map();
  private liveSession: () => SessionMeta | null = () => null;

  constructor(store: SessionStore) {
    this.store = store;
  }

  setLiveSessionProvider(provider: () => SessionMeta | null): void {
    this.liveSession = provider;
  }

  session(id: string): SessionMeta | null {
    const live = this.liveSession();
    return live && live.id === id ? live : this.store.get(id);
  }

  remember(sessionId: string, lap: AnalysedLap): void {
    this.put(`${sessionId}:${lap.summary.lap}`, lap);
  }

  forget(sessionId: string): void {
    for (const key of [...this.laps.keys()]) if (key.startsWith(`${sessionId}:`)) this.laps.delete(key);
    const caches: Cache<unknown>[] = [
      this.insightCache,
      this.incidentCache,
      this.chassisCache,
      this.gripCache,
      this.gearingCache,
      this.trackUseCache,
      this.stintsCache,
    ];
    for (const cache of caches) {
      for (const key of [...cache.keys()]) if (key === sessionId || key.startsWith(`${sessionId}#`)) cache.delete(key);
    }
  }

  lap(sessionId: string, lapNumber: number): AnalysedLap | null {
    const key = `${sessionId}:${lapNumber}`;
    const cached = this.laps.get(key);
    if (cached) {
      this.put(key, cached);
      return cached;
    }
    const session = this.session(sessionId);
    const stored = session ? this.store.loadLap(sessionId, lapNumber) : null;
    if (!session || !stored) return null;
    const analysed = analyseStoredLap(stored, session.track);
    this.put(key, analysed);
    return analysed;
  }

  insights(sessionId: string, stint?: number): InsightsResult | null {
    const scope = this.scope(sessionId, stint);
    if (!scope) return null;
    return this.cached(this.insightCache, scope, () => {
      // A stint keeps the session's corners, so T4 is the same corner in every stint.
      const sessionCorners = scope.stint === null ? undefined : (this.insights(sessionId)?.corners ?? []);
      // Spins and contact come from the raw traces: they need the sideways velocity and the full rate of samples.
      const insights = analyseSession(this.analysedLaps(scope), sessionCorners, this.incidents(sessionId));
      return { insights, corners: sessionCorners ?? insights.corners.map((c) => c.corner) };
    });
  }

  /** Each stint of a session: its pace, and how every corner went over its pace laps. */
  stints(sessionId: string): StintsResult | null {
    const scope = this.scope(sessionId);
    if (!scope) return null;
    return this.cached(this.stintsCache, scope, () => {
      const corners = this.insights(sessionId)?.corners ?? [];
      const incidents = this.incidents(sessionId);
      return {
        corners,
        stints: summariseStints(scope.session.laps).map((summary) => {
          const own = this.scope(sessionId, summary.id);
          return {
            ...summary,
            idealLapTime: this.insights(sessionId, summary.id)?.insights.idealLapTime ?? null,
            corners: stintCorners(own ? this.analysedLaps(own) : [], corners, incidents),
          };
        }),
      };
    });
  }

  compare(sessionId: string, lapNumber: number, refSessionId: string, refLapNumber: number): ComparisonResult | null {
    const lap = this.lap(sessionId, lapNumber);
    const reference = this.lap(refSessionId, refLapNumber);
    if (!lap || !reference) return null;
    // Reuse the session's corner numbering so T4 means the same corner everywhere.
    const sessionCorners = this.insights(refSessionId)?.corners ?? [];
    const corners = sessionCorners.length ? sessionCorners : detectCorners(reference.resampled);
    return {
      lap,
      reference,
      corners,
      comparison: compareLaps(lap.resampled, reference.resampled, corners, refLapNumber),
    };
  }

  /** Balance, suspension and damper analysis over every lap of a session or stint (uses the raw, time-based traces). */
  chassis(sessionId: string, stint?: number): ChassisResult | null {
    const scope = this.scope(sessionId, stint);
    if (!scope) return null;
    return this.cached(this.chassisCache, scope, () => {
      const corners = this.insights(sessionId)?.corners ?? [];
      // A stint is measured on the whole session's calibration: one yardstick for every setup.
      const whole = scope.stint === null ? null : (this.chassis(sessionId)?.analysis ?? null);
      const calibrated = whole ? { availability: whole.availability, calibration: whole.calibration } : undefined;
      return { analysis: analyseChassis(this.storedLaps(scope), corners, calibrated), corners };
    });
  }

  /**
   * Grip used in every corner across a session's or stint's clean laps, against the most
   * grip shown at each speed in the whole session. Spins and contact are left out.
   */
  grip(sessionId: string, stint?: number): GripResult | null {
    return this.gripData(sessionId, stint)?.result ?? null;
  }

  gripLap(sessionId: string, lapNumber: number, stint?: number): GripLapResult | null {
    const data = this.gripData(sessionId, stint);
    const lap = this.lap(sessionId, lapNumber);
    if (!data || !lap) return null;
    const envelope = data.result.envelope;
    // Nothing to measure yet, or not a whole lap: no corners rather than an error.
    if (!envelope || lap.summary.kind === 'partial') return { lap: lapNumber, corners: [] };
    const corners = this.insights(sessionId, stint)?.insights.corners ?? [];
    return {
      lap: lapNumber,
      corners: corners.map(({ corner, bestLap }) => {
        const best = this.lap(sessionId, bestLap);
        return {
          cornerId: corner.id,
          corner: corner.name,
          apex: corner.apex,
          from: cornerStart(corner),
          step: CORNER_STEP,
          bestLap: best ? bestLap : null,
          run: cornerGripRun(envelope, corner, lap.resampled, data.incidents.get(lapNumber)),
          best: best ? cornerGripRun(envelope, corner, best.resampled, data.incidents.get(bestLap)) : null,
        };
      }),
    };
  }

  private gripData(sessionId: string, stint?: number): { result: GripResult; incidents: Incidents } | null {
    const scope = this.scope(sessionId, stint);
    if (!scope) return null;
    return this.cached(this.gripCache, scope, () => {
      // The grip the car has shown, and where each lap spun or was hit, come from the whole session.
      const { envelope, incidents } = scope.stint === null ? this.gripLimits(scope) : this.gripLimitsOf(sessionId);
      const clean = coachableLaps(this.analysedLaps(scope));
      const cornerInsights = this.insights(sessionId, stint)?.insights.corners ?? [];
      const corners = envelope
        ? cornerInsights.map(({ corner, bestLap }) =>
            summariseCornerGrip(
              corner,
              clean.map((lap) => ({
                lap: lap.summary.lap,
                run: cornerGripRun(envelope, corner, lap.resampled, incidents.get(lap.summary.lap)),
              })),
              bestLap,
            ),
          )
        : [];
      return { result: { envelope, lapsAnalysed: clean.length, corners }, incidents };
    });
  }

  private gripLimitsOf(sessionId: string): { envelope: GripEnvelope | null; incidents: Incidents } {
    const whole = this.gripData(sessionId);
    return { envelope: whole?.result.envelope ?? null, incidents: whole?.incidents ?? new Map() };
  }

  private gripLimits(scope: Scope): { envelope: GripEnvelope | null; incidents: Incidents } {
    const calibration = this.chassis(scope.session.id)?.analysis.calibration ?? null;
    const stored = this.storedLaps(scope).filter((lap) => lap.summary.kind !== 'partial');
    const masks = stored.map((l) =>
      calibration ? incidentMask(l.trace, calibration.impactG, calibration.velocityAxesSwapped) : null,
    );
    const incidents: Incidents = new Map(
      stored.map((l) => [
        l.summary.lap,
        calibration ? incidentRanges(l.trace, calibration.impactG, calibration.velocityAxesSwapped) : [],
      ]),
    );
    const envelope = gripEnvelope(
      stored.map((l) => l.trace),
      masks,
    );
    return { envelope, incidents };
  }

  /** Gear ratios, shift points, the rev limiter, downshifts and the gear used in each corner. */
  gearing(sessionId: string, stint?: number): GearingAnalysis | null {
    const scope = this.scope(sessionId, stint);
    if (!scope) return null;
    return this.cached(this.gearingCache, scope, () => {
      const insights = this.insights(sessionId, stint);
      const events = this.chassis(sessionId, stint)?.analysis.events ?? [];
      return analyseGearing(this.storedLaps(scope), insights?.corners ?? [], events, this.cornerBestLaps(insights));
    });
  }

  /** How close to the track edges each corner is driven, from kerb contact. */
  trackUse(sessionId: string, stint?: number): TrackUseAnalysis | null {
    const scope = this.scope(sessionId, stint);
    if (!scope) return null;
    return this.cached(this.trackUseCache, scope, () => {
      const insights = this.insights(sessionId, stint);
      return analyseTrackUse(
        this.storedLaps(scope),
        insights?.corners ?? [],
        insights?.insights.bestLap?.lap ?? null,
        this.cornerBestLaps(insights),
        scope.session.track.length || undefined,
      );
    });
  }

  chassisLap(sessionId: string, lapNumber: number): ChassisLapSeries | null {
    const chassis = this.chassis(sessionId);
    const stored = chassis ? this.store.loadLap(sessionId, lapNumber) : null;
    return chassis && stored ? chassisLapSeries(stored, chassis.analysis) : null;
  }

  bestReference(track: TrackInfo, car: string, excludeSessionId?: string): Reference | null {
    const best = this.store.bestLap(track, car, excludeSessionId);
    if (!best || best.summary.lapTime === null) return null;
    const lap = this.lap(best.session.id, best.summary.lap);
    if (!lap) return null;
    return {
      source: 'all-time',
      sessionId: best.session.id,
      lap: best.summary.lap,
      lapTime: best.summary.lapTime,
      resampled: lap.resampled,
    };
  }

  private scope(sessionId: string, stint?: number): Scope | null {
    const session = this.session(sessionId);
    if (!session) return null;
    // A lap number used twice (a restart that an older version kept in one session) has only its latest telemetry on disk.
    const hasOwnTelemetry = (lap: LapSummary, i: number) => session.laps.findLastIndex((l) => l.lap === lap.lap) === i;
    if (stint === undefined) return { session, laps: session.laps.filter(hasOwnTelemetry), stint: null, key: sessionId };
    const range = detectStints(session.laps)[stint - 1];
    if (!range) return null;
    return {
      session,
      laps: session.laps.filter((lap, i) => i >= range.first && i <= range.last && hasOwnTelemetry(lap, i)),
      stint,
      key: `${sessionId}#${stint}`,
    };
  }

  private analysedLaps(scope: Scope): AnalysedLap[] {
    return scope.laps
      .map((summary) => this.lap(scope.session.id, summary.lap))
      .filter((lap): lap is AnalysedLap => lap !== null);
  }

  private storedLaps(scope: Scope): StoredLap[] {
    return scope.laps
      .map((summary) => this.store.loadLap(scope.session.id, summary.lap))
      .filter((lap): lap is StoredLap => lap !== null);
  }

  /** Distance ranges of each lap near a spin or contact, by lap number, over the whole session. */
  private incidents(sessionId: string): Incidents {
    const scope = this.scope(sessionId);
    return scope ? this.cached(this.incidentCache, scope, () => sessionIncidents(this.storedLaps(scope))) : new Map();
  }

  private cornerBestLaps(insights: InsightsResult | null): Map<number, number> {
    return new Map((insights?.insights.corners ?? []).map((c) => [c.corner.id, c.bestLap]));
  }

  private cached<T>(cache: Cache<T>, scope: Scope, compute: () => T): T {
    const { session, key } = scope;
    const hit = cache.get(key);
    if (hit && hit.updatedAt === session.updatedAt && hit.lapCount === session.laps.length) return hit.result;
    const result = compute();
    cache.set(key, { updatedAt: session.updatedAt, lapCount: session.laps.length, result });
    return result;
  }

  private put(key: string, value: AnalysedLap): void {
    this.laps.delete(key);
    this.laps.set(key, value);
    while (this.laps.size > LAP_CACHE_LIMIT) {
      const oldest = this.laps.keys().next().value;
      if (oldest === undefined) break;
      this.laps.delete(oldest);
    }
  }
}
