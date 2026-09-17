/**
 * Loads stored laps, resamples them onto a distance grid and runs the coaching
 * analysis, with small caches so the UI can click around freely.
 */
import {
  analyseChassis,
  chassisLapSeries,
  incidentMask,
  incidentRanges,
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
import type { SessionMeta, StoredLap, TrackInfo } from '../shared/model/types.ts';
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
  private readonly insightCache = new Map<string, { updatedAt: number; lapCount: number; result: InsightsResult }>();
  private readonly chassisCache = new Map<string, { updatedAt: number; lapCount: number; result: ChassisResult }>();
  private readonly gearingCache = new Map<string, { updatedAt: number; lapCount: number; result: GearingAnalysis }>();
  private readonly trackUseCache = new Map<string, { updatedAt: number; lapCount: number; result: TrackUseAnalysis }>();
  private readonly gripCache = new Map<
    string,
    { updatedAt: number; lapCount: number; result: GripResult; incidents: Map<number, [number, number][]> }
  >();
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
    this.insightCache.delete(sessionId);
    this.chassisCache.delete(sessionId);
    this.gripCache.delete(sessionId);
    this.gearingCache.delete(sessionId);
    this.trackUseCache.delete(sessionId);
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

  insights(sessionId: string): InsightsResult | null {
    const session = this.session(sessionId);
    if (!session) return null;
    const cached = this.insightCache.get(sessionId);
    if (cached && cached.updatedAt === session.updatedAt && cached.lapCount === session.laps.length) return cached.result;
    const laps = session.laps
      .map((summary) => this.lap(sessionId, summary.lap))
      .filter((lap): lap is AnalysedLap => lap !== null);
    const insights = analyseSession(laps);
    const result = { insights, corners: insights.corners.map((c) => c.corner) };
    this.insightCache.set(sessionId, { updatedAt: session.updatedAt, lapCount: session.laps.length, result });
    return result;
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

  /** Balance, suspension and damper analysis over every lap of a session (uses the raw, time-based traces). */
  chassis(sessionId: string): ChassisResult | null {
    const session = this.session(sessionId);
    if (!session) return null;
    const cached = this.chassisCache.get(sessionId);
    if (cached && cached.updatedAt === session.updatedAt && cached.lapCount === session.laps.length) return cached.result;
    const laps = session.laps
      .map((summary) => this.store.loadLap(sessionId, summary.lap))
      .filter((lap): lap is StoredLap => lap !== null);
    const corners = this.insights(sessionId)?.corners ?? [];
    const result = { analysis: analyseChassis(laps, corners), corners };
    this.chassisCache.set(sessionId, { updatedAt: session.updatedAt, lapCount: session.laps.length, result });
    return result;
  }

  /**
   * Grip used in every corner across a session's clean laps, against the most grip
   * shown at each speed in the whole session. Spins and contact are left out.
   */
  grip(sessionId: string): GripResult | null {
    return this.gripData(sessionId)?.result ?? null;
  }

  gripLap(sessionId: string, lapNumber: number): GripLapResult | null {
    const data = this.gripData(sessionId);
    const lap = this.lap(sessionId, lapNumber);
    if (!data || !lap) return null;
    const envelope = data.result.envelope;
    // Nothing to measure yet, or not a whole lap: no corners rather than an error.
    if (!envelope || lap.summary.kind === 'partial') return { lap: lapNumber, corners: [] };
    const corners = this.insights(sessionId)?.insights.corners ?? [];
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

  private gripData(sessionId: string) {
    const session = this.session(sessionId);
    if (!session) return null;
    const cached = this.gripCache.get(sessionId);
    if (cached && cached.updatedAt === session.updatedAt && cached.lapCount === session.laps.length) return cached;

    const calibration = this.chassis(sessionId)?.analysis.calibration ?? null;
    const stored = session.laps
      .filter((summary) => summary.kind !== 'partial')
      .map((summary) => this.store.loadLap(sessionId, summary.lap))
      .filter((lap): lap is StoredLap => lap !== null);
    const masks = stored.map((l) =>
      calibration ? incidentMask(l.trace, calibration.impactG, calibration.velocityAxesSwapped) : null,
    );
    const incidents = new Map(
      stored.map((l) => [
        l.summary.lap,
        calibration ? incidentRanges(l.trace, calibration.impactG, calibration.velocityAxesSwapped) : [],
      ]),
    );
    const envelope = gripEnvelope(
      stored.map((l) => l.trace),
      masks,
    );

    const clean = coachableLaps(
      session.laps.map((s) => this.lap(sessionId, s.lap)).filter((lap): lap is AnalysedLap => lap !== null),
    );
    const cornerInsights = this.insights(sessionId)?.insights.corners ?? [];
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
    const entry = {
      updatedAt: session.updatedAt,
      lapCount: session.laps.length,
      result: { envelope, lapsAnalysed: clean.length, corners },
      incidents,
    };
    this.gripCache.set(sessionId, entry);
    return entry;
  }

  /** Gear ratios, shift points, the rev limiter, downshifts and the gear used in each corner. */
  gearing(sessionId: string): GearingAnalysis | null {
    return this.cached(this.gearingCache, sessionId, (session) => {
      const insights = this.insights(sessionId);
      const events = this.chassis(sessionId)?.analysis.events ?? [];
      return analyseGearing(this.storedLaps(session), insights?.corners ?? [], events, this.cornerBestLaps(insights));
    });
  }

  /** How close to the track edges each corner is driven, from kerb contact. */
  trackUse(sessionId: string): TrackUseAnalysis | null {
    return this.cached(this.trackUseCache, sessionId, (session) => {
      const insights = this.insights(sessionId);
      return analyseTrackUse(
        this.storedLaps(session),
        insights?.corners ?? [],
        insights?.insights.bestLap?.lap ?? null,
        this.cornerBestLaps(insights),
        session.track.length || undefined,
      );
    });
  }

  private storedLaps(session: SessionMeta): StoredLap[] {
    return session.laps
      .map((summary) => this.store.loadLap(session.id, summary.lap))
      .filter((lap): lap is StoredLap => lap !== null);
  }

  private cornerBestLaps(insights: InsightsResult | null): Map<number, number> {
    return new Map((insights?.insights.corners ?? []).map((c) => [c.corner.id, c.bestLap]));
  }

  private cached<T>(
    cache: Map<string, { updatedAt: number; lapCount: number; result: T }>,
    sessionId: string,
    compute: (session: SessionMeta) => T,
  ): T | null {
    const session = this.session(sessionId);
    if (!session) return null;
    const hit = cache.get(sessionId);
    if (hit && hit.updatedAt === session.updatedAt && hit.lapCount === session.laps.length) return hit.result;
    const result = compute(session);
    cache.set(sessionId, { updatedAt: session.updatedAt, lapCount: session.laps.length, result });
    return result;
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
